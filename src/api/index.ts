import { initializeEventPublisher } from "@/events";
import { initIORedisClient } from "@/utils/redis";
import { bootstrapGateway } from "@/websocket/websocket-server";
import dotenv from "dotenv";
import { Hono } from "hono";
import { and, asc, client, desc, eq, graphql, gt, gte, inArray, lte, or, sql } from "ponder";
import { db } from "ponder:api";
import schema, {
	balances,
	chainBalanceDeposits,
	currencies,
	dailyBuckets,
	fiveMinuteBuckets,
	hourBuckets,
	hyperlaneMessages,
	minuteBuckets,
	orderBookDepth,
	orderBookTrades,
	orders,
	pools,
	thirtyMinuteBuckets,
	tokenMappings,
} from "ponder:schema";
import { systemMonitor } from "../utils/systemMonitor";

dotenv.config();

const app = new Hono();

app.use("/sql/*", client({ db, schema }));

app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

type BinanceKlineData = [
	number, // Open time
	string, // Open price
	string, // High price
	string, // Low price
	string, // Close price
	string, // Volume (base asset)
	number, // Close time
	string, // Quote asset volume
	number, // Number of trades
	string, // Taker buy base asset volume
	string, // Taker buy quote asset volume
	string, // Unused field (ignored)
];

// Interface for our bucket data
interface BucketData {
	id: string;
	openTime: number;
	closeTime: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	quoteVolume: number;
	average: number;
	count: number;
	takerBuyBaseVolume: number;
	takerBuyQuoteVolume: number;
	poolId: string;
}

type IntervalType = "1m" | "5m" | "30m" | "1h" | "1d";

app.get("/api/kline", async c => {
	const symbol = c.req.query("symbol");
	const interval = c.req.query("interval") || "1m";
	const startTime = parseInt(c.req.query("startTime") || "0");
	const endTime = parseInt(c.req.query("endTime") || Date.now().toString());
	const limit = parseInt(c.req.query("limit") || "1000");

	if (!symbol) {
		return c.json({ error: "Symbol parameter is required" }, 400);
	}

	const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

	if (!queriedPools || queriedPools.length === 0) {
		return c.json({ error: "Pool not found" }, 404);
	}

	const intervalTableMap = {
		"1m": minuteBuckets,
		"5m": fiveMinuteBuckets,
		"30m": thirtyMinuteBuckets,
		"1h": hourBuckets,
		"1d": dailyBuckets,
	};

	const bucketTable = intervalTableMap[interval as IntervalType] || minuteBuckets;

	try {
		const poolId = queriedPools[0]!.orderBook;

		const klineData = await db
			.select()
			.from(bucketTable)
			.where(
				and(
					eq(bucketTable.poolId, poolId),
					gte(bucketTable.openTime, Math.floor(startTime / 1000)),
					lte(bucketTable.openTime, Math.floor(endTime / 1000))
				)
			)
			.orderBy(bucketTable.openTime)
			.limit(limit)
			.execute();

		const formattedData = klineData.map((bucket: BucketData) => formatKlineData(bucket));

		return c.json(formattedData);
	} catch (error) {
		return c.json({ error: `Failed to fetch kline data: ${error}` }, 500);
	}
});

app.get("/api/depth", async c => {
	const symbol = c.req.query("symbol");
	const limit = parseInt(c.req.query("limit") || "100");

	if (!symbol) {
		return c.json({ error: "Symbol parameter is required" }, 400);
	}

	try {
		const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

		if (!queriedPools || queriedPools.length === 0) {
			return c.json({ error: "Pool not found" }, 404);
		}

		const poolId = queriedPools[0]!.orderBook;

		if (!poolId) {
			return c.json({ error: "Pool order book address not found" }, 404);
		}

		// Use the new util common service for bids and asks
		// Bids: Buy, OPEN or PARTIALLY_FILLED, price desc
		const bids = await db
			.select({
				price: orders.price,
				quantity: sql`SUM(${orders.quantity})`.as("quantity"),
				filled: sql`SUM(${orders.filled})`.as("filled"),
			})
			.from(orders)
			.where(
				and(
					gt(orders.price, 0),
					eq(orders.poolId, poolId),
					eq(orders.side, "Buy"),
					or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED"))
				)
			)
			.groupBy(orders.price)
			.orderBy(asc(orders.price))
			.limit(limit)
			.execute();

		// Asks: Sell, OPEN or PARTIALLY_FILLED, price asc
		const asks = await db
			.select({
				price: orders.price,
				quantity: sql`SUM(${orders.quantity})`.as("quantity"),
				filled: sql`SUM(${orders.filled})`.as("filled"),
			})
			.from(orders)
			.where(
				and(
					gt(orders.price, 0),
					eq(orders.poolId, poolId),
					eq(orders.side, "Sell"),
					or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED"))
				)
			)
			.orderBy(asc(orders.price))
			.groupBy(orders.price)
			.limit(limit)
			.execute();

		const response = {
			lastUpdateId: Date.now(),
			bids: bids.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()]),
			asks: asks.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()])
		};

		return c.json(response);
	} catch (error) {
		return c.json({ error: `Failed to fetch depth data: ${error}` }, 500);
	}
});

app.get("/api/trades", async c => {
	const symbol = c.req.query("symbol");
	const limit = parseInt(c.req.query("limit") || "500");
	const user = c.req.query("user");
	const orderBy = c.req.query("orderBy") || "desc"; // "asc" for FIFO, "desc" for recent first

	if (!symbol) {
		return c.json({ error: "Symbol parameter is required" }, 400);
	}

	try {
		const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

		if (!queriedPools || queriedPools.length === 0) {
			return c.json({ error: "Pool not found" }, 404);
		}

		const poolId = queriedPools[0]!.orderBook;

		if (!poolId) {
			return c.json({ error: "Pool order book address not found" }, 404);
		}

		let recentTrades;

		if (user) {
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Query timeout')), 10000)
			);

			try {
				const userTradesPromise = db
					.select({
						trade: orderBookTrades,
						order: orders,
					})
					.from(orderBookTrades)
					.innerJoin(orders, eq(orderBookTrades.poolId, orders.poolId))
					.where(and(
						eq(orderBookTrades.poolId, poolId),
						eq(orders.user, user.toLowerCase())
					))
					.orderBy(desc(orderBookTrades.timestamp))
					.limit(Math.min(limit, 100))
					.execute();

				const userTrades = await Promise.race([userTradesPromise, timeoutPromise]);
				recentTrades = (userTrades as any).map((result: any) => result.trade);
			} catch (error: any) {
				if (error?.message === 'Query timeout') {
					return c.json({ error: "Query took too long, try reducing limit or use general trades endpoint" }, 408);
				}
				throw error;
			}
		} else {
			recentTrades = await db
				.select()
				.from(orderBookTrades)
				.where(eq(orderBookTrades.poolId, poolId))
				.orderBy(orderBy === "asc" ? asc(orderBookTrades.timestamp) : desc(orderBookTrades.timestamp))
				.limit(limit)
				.execute();
		}

		const formattedTrades = recentTrades.map((trade: any) => ({
			id: trade.id || "",
			price: trade.price ? trade.price.toString() : "0",
			qty: trade.quantity ? trade.quantity.toString() : "0",
			time: trade.timestamp ? trade.timestamp * 1000 : Date.now(),
			isBuyerMaker: trade.side === "Sell",
			isBestMatch: true,
		}));

		return c.json(formattedTrades);
	} catch (error) {
		return c.json({ error: `Failed to fetch trades data: ${error}` }, 500);
	}
});

app.get("/api/ticker/24hr", async c => {
	const symbol = c.req.query("symbol");

	if (!symbol) {
		return c.json({ error: "Symbol parameter is required" }, 400);
	}

	try {
		const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

		if (!queriedPools || queriedPools.length === 0) {
			return c.json({ error: "Pool not found" }, 404);
		}

		const poolId = queriedPools[0]!.orderBook;

		if (!poolId) {
			return c.json({ error: "Pool order book address not found" }, 404);
		}

		const now = Math.floor(Date.now() / 1000);
		const oneDayAgo = now - 86400;

		// Execute all queries in parallel for better performance
		const [dailyStats, latestTrade, bestBids, bestAsks] = await Promise.all([
			db
				.select()
				.from(dailyBuckets)
				.where(and(eq(dailyBuckets.poolId, poolId), gte(dailyBuckets.openTime, oneDayAgo)))
				.orderBy(desc(dailyBuckets.openTime))
				.limit(1)
				.execute(),

			db
				.select()
				.from(orderBookTrades)
				.where(eq(orderBookTrades.poolId, poolId))
				.orderBy(desc(orderBookTrades.timestamp))
				.limit(1)
				.execute(),

			db
				.select()
				.from(orderBookDepth)
				.where(and(eq(orderBookDepth.poolId, poolId), eq(orderBookDepth.side, "Buy")))
				.orderBy(desc(orderBookDepth.price))
				.limit(1)
				.execute(),

			db
				.select()
				.from(orderBookDepth)
				.where(and(eq(orderBookDepth.poolId, poolId), eq(orderBookDepth.side, "Sell")))
				.orderBy(asc(orderBookDepth.price))
				.limit(1)
				.execute()
		]);

		interface DailyStats {
			open?: bigint | null;
			high?: bigint | null;
			low?: bigint | null;
			volume?: bigint | null;
			quoteVolume?: bigint | null;
			openTime?: number | null;
			count?: number | null;
			average?: bigint | null;
		}

		const stats = (dailyStats[0] || {}) as DailyStats;
		const lastPrice = latestTrade[0]?.price?.toString() || "0";

		const openPrice = stats.open?.toString() ?? "0";
		const highPrice = stats.high?.toString() ?? "0";
		const lowPrice = stats.low?.toString() ?? "0";
		const volumeValue = stats.volume?.toString() ?? "0";
		const quoteVolumeValue = stats.quoteVolume?.toString() ?? "0";
		const openTimeValue = stats.openTime ? stats.openTime * 1000 : oneDayAgo * 1000;
		const countValue = stats.count ?? 0;
		const averageValue = stats.average?.toString() ?? "0";

		const prevClosePrice = openPrice || lastPrice;

		const priceChange = (parseFloat(lastPrice) - parseFloat(prevClosePrice)).toString();
		const priceChangePercent =
			parseFloat(prevClosePrice) > 0
				? (((parseFloat(lastPrice) - parseFloat(prevClosePrice)) / parseFloat(prevClosePrice)) * 100).toFixed(2)
				: "0.00";

		const response = {
			symbol: symbol,
			priceChange: priceChange,
			priceChangePercent: priceChangePercent,
			weightedAvgPrice: averageValue,
			prevClosePrice: prevClosePrice,
			lastPrice: lastPrice,
			lastQty: latestTrade[0]?.quantity?.toString() || "0",
			bidPrice: bestBids[0]?.price?.toString() || "0",
			askPrice: bestAsks[0]?.price?.toString() || "0",
			openPrice: openPrice,
			highPrice: highPrice,
			lowPrice: lowPrice,
			volume: volumeValue,
			quoteVolume: quoteVolumeValue,
			openTime: openTimeValue,
			closeTime: now * 1000,
			firstId: "0",
			lastId: latestTrade[0]?.id || "0",
			count: countValue,
		};

		return c.json(response);
	} catch (error) {
		return c.json({ error: `Failed to fetch 24hr ticker data: ${error}` }, 500);
	}
});

app.get("/api/ticker/price", async c => {
	const symbol = c.req.query("symbol");

	if (!symbol) {
		return c.json({ error: "Symbol parameter is required" }, 400);
	}

	try {
		const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

		if (!queriedPools || queriedPools.length === 0) {
			return c.json({ error: "Pool not found" }, 404);
		}

		const poolId = queriedPools[0]!.orderBook;

		if (!poolId) {
			return c.json({ error: "Pool order book address not found" }, 404);
		}

		const latestTrade = await db
			.select()
			.from(orderBookTrades)
			.where(eq(orderBookTrades.poolId, poolId))
			.orderBy(desc(orderBookTrades.timestamp))
			.limit(1)
			.execute();

		let price = "0";
		if (latestTrade.length > 0 && latestTrade[0]?.price) {
			price = latestTrade[0].price.toString();
		} else if (queriedPools[0]?.price) {
			price = queriedPools[0].price.toString();
		}

		const response = {
			symbol: symbol,
			price: price,
		};

		return c.json(response);
	} catch (error) {
		return c.json({ error: `Failed to fetch price data: ${error}` }, 500);
	}
});
app.get("/api/allOrders", async c => {
	const symbol = c.req.query("symbol");
	const limit = parseInt(c.req.query("limit") || "500");
	const address = c.req.query("address");

	if (!address) {
		return c.json({ error: "Address parameter is required" }, 400);
	}

	try {
		const baseQuery = db.select().from(orders);
		let query = baseQuery.where(eq(orders.user, address as `0x${string}`));

		if (symbol) {
			const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

			if (!queriedPools || queriedPools.length === 0) {
				return c.json({ error: "Pool not found" }, 404);
			}

			const poolId = queriedPools[0]!.orderBook;
			if (poolId) {
				query = baseQuery.where(and(eq(orders.user, address as `0x${string}`), eq(orders.poolId, poolId)));
			}
		}

		const effectiveLimit = Math.min(limit, 1000);
		const userOrders = await query.orderBy(desc(orders.timestamp)).limit(effectiveLimit).execute();

		// Collect all unique poolIds to avoid N+1 queries
		const uniquePoolIds = [...new Set(userOrders.map(order => order.poolId).filter(Boolean))];

		// Fetch all pool data in a single query
		const poolsData = await db
			.select()
			.from(pools)
			.where(inArray(pools.orderBook, uniquePoolIds as `0x${string}`[]))
			.execute();

		// Create a map for quick lookup
		const poolsMap = new Map(poolsData.map(pool => [pool.orderBook, pool]));

		const formattedOrders = userOrders.map(order => {
			let decimals = 18;
			let orderSymbol = "UNKNOWN";

			if (order.poolId && poolsMap.has(order.poolId as `0x${string}`)) {
				const pool = poolsMap.get(order.poolId as `0x${string}`);
				if (pool?.quoteDecimals) {
					decimals = Number(pool.quoteDecimals);
				}
				if (pool?.coin) {
					orderSymbol = pool.coin;
				}
			}

			// Use the symbol from query parameter if provided and no pool symbol was found
			if (orderSymbol === "UNKNOWN" && symbol) {
				orderSymbol = symbol;
			}

			return {
				symbol: orderSymbol,
				orderId: order.orderId.toString(),
				orderListId: -1,
				clientOrderId: order.id,
				price: order.price.toString(),
				origQty: order.quantity.toString(),
				executedQty: order.filled.toString(),
				cumulativeQuoteQty:
					order.filled && order.price
						? ((BigInt(order.filled) * BigInt(order.price)) / BigInt(10 ** decimals)).toString()
						: "0",
				status: order.status,
				timeInForce: "GTC",
				type: order.type,
				side: order.side.toUpperCase(),
				stopPrice: "0",
				icebergQty: "0",
				time: Number(order.timestamp) * 1000,
				updateTime: Number(order.timestamp) * 1000,
				isWorking: order.status === "NEW" || order.status === "PARTIALLY_FILLED",
				origQuoteOrderQty: "0",
			};
		});

		return c.json(formattedOrders);
	} catch (error) {
		return c.json({ error: `Failed to fetch orders: ${error}` }, 500);
	}
});

app.get("/api/openOrders", async c => {
	const symbol = c.req.query("symbol");
	const address = c.req.query("address");

	if (!address) {
		return c.json({ error: "Address parameter is required" }, 400);
	}

	try {
		const baseQuery = db.select().from(orders);
		let query = baseQuery.where(
			and(
				eq(orders.user, address as `0x${string}`),
				or(eq(orders.status, "NEW"), eq(orders.status, "PARTIALLY_FILLED"), eq(orders.status, "OPEN"))
			)
		);

		if (symbol) {
			const queriedPools = await db.select().from(pools).where(eq(pools.coin, symbol)).orderBy(desc(pools.timestamp));

			if (!queriedPools || queriedPools.length === 0) {
				return c.json({ error: "Pool not found" }, 404);
			}

			const poolId = queriedPools[0]!.orderBook;
			if (poolId) {
				query = baseQuery.where(
					and(
						eq(orders.user, address as `0x${string}`),
						or(eq(orders.status, "NEW"), eq(orders.status, "PARTIALLY_FILLED"), eq(orders.status, "OPEN")),
						eq(orders.poolId, poolId)
					)
				);
			}
		}

		const openOrders = await query.orderBy(desc(orders.timestamp)).limit(500).execute();

		// Collect all unique poolIds to avoid N+1 queries
		const uniquePoolIds = [...new Set(openOrders.map(order => order.poolId).filter(Boolean))];

		// Fetch all pool data in a single query
		const poolsData = await db
			.select()
			.from(pools)
			.where(inArray(pools.orderBook, uniquePoolIds as `0x${string}`[]))
			.execute();

		// Create a map for quick lookup
		const poolsMap = new Map(poolsData.map(pool => [pool.orderBook, pool]));

		const formattedOrders = openOrders.map(order => {
			let orderSymbol = symbol;
			let decimals = 18;

			if (order.poolId && poolsMap.has(order.poolId as `0x${string}`)) {
				const pool = poolsMap.get(order.poolId as `0x${string}`);
				orderSymbol = pool?.coin || "UNKNOWN";
				if (pool?.quoteDecimals) {
					decimals = Number(pool.quoteDecimals);
				}
			}

			return {
				symbol: orderSymbol,
				orderId: order.orderId.toString(),
				orderListId: -1,
				clientOrderId: order.id,
				price: order.price.toString(),
				origQty: order.quantity.toString(),
				executedQty: order.filled.toString(),
				cumulativeQuoteQty:
					order.filled && order.price
						? ((BigInt(order.filled) * BigInt(order.price)) / BigInt(10 ** decimals)).toString()
						: "0",
				status: order.status,
				timeInForce: "GTC",
				type: order.type,
				side: order.side.toUpperCase(),
				stopPrice: "0",
				icebergQty: "0",
				time: Number(order.timestamp) * 1000,
				updateTime: Number(order.timestamp) * 1000,
				isWorking: true,
				origQuoteOrderQty: "0",
			};
		});

		return c.json(formattedOrders);
	} catch (error) {
		return c.json({ error: `Failed to fetch open orders: ${error}` }, 500);
	}
});

app.get("/api/pairs", async c => {
	try {
		const allPools = await db.select().from(pools).execute();

		const pairs = allPools.map(pool => {
			const symbol = pool.coin || "";
			const symbolParts = symbol.split("/");

			return {
				symbol: symbol.replace("/", ""),
				baseAsset: symbolParts[0] || symbol,
				quoteAsset: symbolParts[1] || "USDT",
				poolId: pool.id,
				baseDecimals: pool.baseDecimals,
				quoteDecimals: pool.quoteDecimals,
			};
		});

		return c.json(pairs);
	} catch (error) {
		return c.json({ error: `Failed to fetch pairs data: ${error}` }, 500);
	}
});


app.get("/api/pairs", async c => {
	try {
		const allPools = await db.select().from(pools).execute();

		const pairs = allPools.map(pool => {
			const symbol = pool.coin || "";
			const symbolParts = symbol.split("/");

			return {
				symbol: symbol.replace("/", ""),
				baseAsset: symbolParts[0] || symbol,
				quoteAsset: symbolParts[1] || "USDT",
				poolId: pool.id,
				baseDecimals: pool.baseDecimals,
				quoteDecimals: pool.quoteDecimals,
			};
		});

		return c.json(pairs);
	} catch (error) {
		return c.json({ error: `Failed to fetch pairs data: ${error}` }, 500);
	}
});

app.get("/api/markets", async c => {
	try {
		const allPools = await db.select().from(pools).execute();

		const pairs = await Promise.all(allPools.map(async pool => {
			const symbol = pool.coin || "";
			const symbolParts = symbol.split("/");

			// Calculate market age in seconds
			const currentTime = Math.floor(Date.now() / 1000);
			const marketAge = pool.timestamp ? currentTime - pool.timestamp : 0;

			// Calculate liquidity from order book depth (separate buy and sell sides)
			let bidLiquidity = "0";
			let askLiquidity = "0";
			let totalLiquidityInQuote = "0";

			if (pool.orderBook) {
				// Get bid side liquidity (Buy orders - in base asset)
				const bidData = await db
					.select({
						totalQuantity: sql`SUM(${orderBookDepth.quantity})`.as("totalQuantity")
					})
					.from(orderBookDepth)
					.where(and(
						eq(orderBookDepth.poolId, pool.orderBook as `0x${string}`),
						eq(orderBookDepth.side, "Buy")
					))
					.execute();

				bidLiquidity = bidData[0]?.totalQuantity?.toString() || "0";

				// Get ask side liquidity (Sell orders - in base asset)
				const askData = await db
					.select({
						totalQuantity: sql`SUM(${orderBookDepth.quantity})`.as("totalQuantity")
					})
					.from(orderBookDepth)
					.where(and(
						eq(orderBookDepth.poolId, pool.orderBook as `0x${string}`),
						eq(orderBookDepth.side, "Sell")
					))
					.execute();

				askLiquidity = askData[0]?.totalQuantity?.toString() || "0";

				// Calculate total liquidity in quote asset (sum of bid_quantity * price for buy orders)
				const quoteLiquidityData = await db
					.select({
						totalValue: sql`SUM(${orderBookDepth.quantity} * ${orderBookDepth.price})`.as("totalValue")
					})
					.from(orderBookDepth)
					.where(and(
						eq(orderBookDepth.poolId, pool.orderBook as `0x${string}`),
						eq(orderBookDepth.side, "Buy")
					))
					.execute();

				totalLiquidityInQuote = quoteLiquidityData[0]?.totalValue?.toString() || "0";
			}

			return {
				symbol: symbol.replace("/", ""),
				baseAsset: symbolParts[0] || symbol,
				quoteAsset: symbolParts[1] || "USDT",
				poolId: pool.id,
				baseDecimals: pool.baseDecimals,
				quoteDecimals: pool.quoteDecimals,
				volume: pool.volume?.toString() || "0",
				volumeInQuote: pool.volumeInQuote?.toString() || "0",
				latestPrice: pool.price?.toString() || "0",
				age: marketAge,
				bidLiquidity: bidLiquidity,
				askLiquidity: askLiquidity,
				totalLiquidityInQuote: totalLiquidityInQuote,
				createdAt: pool.timestamp,
			};
		}));

		return c.json(pairs);
	} catch (error) {
		return c.json({ error: `Failed to fetch pairs data: ${error}` }, 500);
	}
});

app.get("/api/cross-chain-deposits", async c => {
	const user = c.req.query("user");
	const status = c.req.query("status");
	const limit = parseInt(c.req.query("limit") || "100");

	if (!user) {
		return c.json({ error: "User parameter is required" }, 400);
	}

	try {
		// Step 1: Find all ChainBalanceManager deposits for the user
		const deposits = await db
			.select()
			.from(chainBalanceDeposits)
			.where(eq(chainBalanceDeposits.recipient, user as `0x${string}`))
			.orderBy(desc(chainBalanceDeposits.timestamp))
			.limit(limit)
			.execute();

		if (!deposits || deposits.length === 0) {
			return c.json({ items: [] });
		}

		// Step 2: For each deposit, find the corresponding dispatch message using transaction hash
		const transactionHashes = deposits.map(deposit => deposit.transactionId);
		const dispatchMessages = await db
			.select()
			.from(hyperlaneMessages)
			.where(and(
				inArray(hyperlaneMessages.transactionHash, transactionHashes),
				eq(hyperlaneMessages.type, "DISPATCH")
			))
			.execute();

		// Create a map for quick lookup of dispatch messages by transaction hash
		const dispatchMessageMap = new Map(
			dispatchMessages.map(msg => [msg.transactionHash, msg])
		);

		// Step 3: For each dispatch message, find the corresponding process message by message ID
		const messageIds = dispatchMessages.map(msg => msg.messageId);
		let processMessages: any[] = [];

		if (messageIds.length > 0) {
			processMessages = await db
				.select()
				.from(hyperlaneMessages)
				.where(and(
					inArray(hyperlaneMessages.messageId, messageIds),
					eq(hyperlaneMessages.type, "PROCESS")
				))
				.execute();
		}

		// Create a map for quick lookup of process messages by message ID
		const processMessageMap = new Map(
			processMessages.map(msg => [msg.messageId, msg])
		);

		// Step 4: Compose the response in the same format as the existing GraphQL structure
		const composedTransfers = deposits.map(deposit => {
			const dispatchMessage = dispatchMessageMap.get(deposit.transactionId);
			const processMessage = dispatchMessage ? processMessageMap.get(dispatchMessage.messageId) : null;

			// Determine status based on message availability
			let transferStatus = "PENDING";
			let destinationChainId = null;
			let destinationTransactionHash = null;
			let destinationBlockNumber = null;
			let destinationTimestamp = null;

			if (processMessage) {
				transferStatus = "RELAYED";
				destinationChainId = processMessage.chainId;
				destinationTransactionHash = processMessage.transactionHash;
				destinationBlockNumber = processMessage.blockNumber;
				destinationTimestamp = processMessage.timestamp;
			} else if (dispatchMessage) {
				transferStatus = "SENT";
			}

			return {
				id: `transfer-${deposit.transactionId}`,
				amount: deposit.amount?.toString() || "0",
				destinationBlockNumber: destinationBlockNumber?.toString() || null,
				destinationChainId: destinationChainId,
				destinationTimestamp: destinationTimestamp,
				destinationToken: null, // Synthetic token info not available in separate schemas
				destinationTransactionHash: destinationTransactionHash,
				dispatchMessage: dispatchMessage ? {
					blockNumber: dispatchMessage.blockNumber?.toString() || null,
					chainId: dispatchMessage.chainId,
					id: dispatchMessage.id,
					messageId: dispatchMessage.messageId,
					sender: dispatchMessage.sender,
					timestamp: dispatchMessage.timestamp,
					type: dispatchMessage.type,
					transactionHash: dispatchMessage.transactionHash
				} : null,
				direction: "DEPOSIT",
				messageId: dispatchMessage?.messageId || null,
				processMessage: processMessage ? {
					blockNumber: processMessage.blockNumber?.toString() || null,
					chainId: processMessage.chainId,
					id: processMessage.id,
					messageId: processMessage.messageId,
					sender: processMessage.sender,
					timestamp: processMessage.timestamp,
					transactionHash: processMessage.transactionHash,
					type: processMessage.type
				} : null,
				sourceToken: deposit.token,
				sourceChainId: deposit.chainId,
				sourceBlockNumber: deposit.blockNumber,
				sender: deposit.depositor,
				recipient: deposit.recipient,
				sourceTransactionHash: deposit.transactionId,
				status: transferStatus,
				timestamp: deposit.timestamp
			};
		});

		// Filter by status if provided
		const filteredTransfers = status
			? composedTransfers.filter(transfer => transfer.status === status)
			: composedTransfers;

		return c.json({ items: filteredTransfers });
	} catch (error) {
		console.error("Error fetching cross-chain transfers:", error);
		return c.json({ error: `Failed to fetch cross-chain transfers: ${error}` }, 500);
	}
});

app.get("/api/token-mappings", async c => {
	const sourceChainId = c.req.query("sourceChainId");
	const targetChainId = c.req.query("targetChainId");
	const symbol = c.req.query("symbol");
	const isActive = c.req.query("isActive");
	const limit = parseInt(c.req.query("limit") || "100");

	try {
		let query = db.select().from(tokenMappings);

		// Apply filters
		const conditions = [];
		if (sourceChainId) {
			conditions.push(eq(tokenMappings.sourceChainId, parseInt(sourceChainId)));
		}
		if (targetChainId) {
			conditions.push(eq(tokenMappings.targetChainId, parseInt(targetChainId)));
		}
		if (symbol) {
			conditions.push(eq(tokenMappings.symbol, symbol));
		}
		if (isActive !== undefined) {
			conditions.push(eq(tokenMappings.isActive, isActive === 'true'));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions));
		}

		const mappings = await query
			.orderBy(desc(tokenMappings.timestamp))
			.limit(limit)
			.execute();

		const formattedMappings = mappings.map(mapping => ({
			id: mapping.id,
			sourceChainId: mapping.sourceChainId,
			sourceToken: mapping.sourceToken,
			targetChainId: mapping.targetChainId,
			syntheticToken: mapping.syntheticToken,
			symbol: mapping.symbol,
			sourceDecimals: mapping.sourceDecimals,
			syntheticDecimals: mapping.syntheticDecimals,
			isActive: mapping.isActive,
			registeredAt: mapping.registeredAt,
			transactionId: mapping.transactionId,
			blockNumber: mapping.blockNumber?.toString(),
			timestamp: mapping.timestamp,
		}));

		return c.json({ items: formattedMappings });
	} catch (error) {
		console.error("Error fetching token mappings:", error);
		return c.json({ error: `Failed to fetch token mappings: ${error}` }, 500);
	}
});

app.get("/api/account", async c => {
	const address = c.req.query("address");

	if (!address) {
		return c.json({ error: "Address parameter is required" }, 400);
	}

	try {
		const userBalances = await db
			.select()
			.from(balances)
			.where(eq(balances.user, address as `0x${string}`))
			.execute();

		const balancesWithInfo = await Promise.all(
			userBalances.map(async balance => {
				const currency = await db
					.select()
					.from(currencies)
					.where(
						and(eq(currencies.address, balance.currency as `0x${string}`), eq(currencies.chainId, balance.chainId))
					)
					.execute();

				const symbol = currency[0]?.symbol || "UNKNOWN";

				const amount = BigInt(balance.amount || 0);
				const locked = BigInt(balance.lockedAmount || 0);
				const free = amount >= locked ? (amount - locked).toString() : "0";

				return {
					asset: symbol,
					free: free,
					locked: balance.lockedAmount?.toString() || "0",
				};
			})
		);

		const orderCount = await db
			.select({ count: sql`count(*)` })
			.from(orders)
			.where(eq(orders.user, address as `0x${string}`))
			.execute();

		const response = {
			makerCommission: 10, // 0.1% = 10 basis points
			takerCommission: 20, // 0.2% = 20 basis points
			buyerCommission: 0,
			sellerCommission: 0,
			canTrade: true,
			canWithdraw: true,
			canDeposit: true,
			updateTime: Date.now(),
			accountType: "SPOT",
			balances: balancesWithInfo,
			permissions: ["SPOT"],
		};

		return c.json(response);
	} catch (error) {
		return c.json({ error: `Failed to fetch account information: ${error}` }, 500);
	}
});

// Function to format our bucket data into Binance Kline format
function formatKlineData(bucket: BucketData): BinanceKlineData {
	// Binance Kline format is an array with specific index positions:
	// [
	//   0: openTime,
	//   1: open,
	//   2: high,
	//   3: low,
	//   4: close,
	//   5: volume,
	//   6: closeTime,
	//   7: quoteVolume,
	//   8: numberOfTrades,
	//   9: takerBuyBaseVolume,
	//   10: takerBuyQuoteVolume,
	//   11: ignored
	// ]

	return [
		bucket.openTime * 1000,
		bucket.open.toString(),
		bucket.high.toString(),
		bucket.low.toString(),
		bucket.close.toString(),
		bucket.volume.toString(),
		bucket.closeTime * 1000,
		bucket.quoteVolume.toString(),
		bucket.count,
		bucket.takerBuyBaseVolume.toString(),
		bucket.takerBuyQuoteVolume.toString(),
		"0",
	];
}

// Only start WebSocket gateway if enabled
// if (process.env.ENABLE_WEBSOCKET === 'true') {
//   bootstrapGateway(app);
// }

// Initialize event publisher
async function initializeServices() {
	try {
		console.log('Initializing services...');

		// Initialize Redis client for event publishing
		const redisClient = await initIORedisClient();
		if (redisClient) {
			const eventPublisher = initializeEventPublisher(redisClient);
			await eventPublisher.createConsumerGroups();
			console.log('Event publisher initialized successfully');
		} else {
			console.warn('Redis client not available, event publishing disabled');
		}
	} catch (error) {
		console.error('Failed to initialize services:', error);
	}
}

// Initialize services on startup
initializeServices();

// Start system monitor for metrics collection (configurable)
const ENABLE_SYSTEM_MONITOR = process.env.ENABLE_SYSTEM_MONITOR === 'true';
const SYSTEM_MONITOR_INTERVAL = parseInt(process.env.SYSTEM_MONITOR_INTERVAL || '60');

if (ENABLE_SYSTEM_MONITOR) {
	console.log(`Starting system monitor for metrics collection (interval: ${SYSTEM_MONITOR_INTERVAL}s)...`);
	systemMonitor.start(SYSTEM_MONITOR_INTERVAL);
} else {
	console.log('System monitor disabled (set ENABLE_SYSTEM_MONITOR=true to enable)');
}

export default app;
