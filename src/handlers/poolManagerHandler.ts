import { createCurrencyId, createPoolId } from "@/utils";
import { createLogger, safeStringify } from "@/utils/logger";
import { shouldEnableWebSocket } from "@/utils/syncState";
import dotenv from "dotenv";
import { sql } from "ponder";
import { currencies, pools } from "ponder:schema";
import { Address, getAddress } from "viem";
import { ERC20ABI } from "../../abis/ERC20";
import { createPoolCacheKey, setChainCachedData } from "../utils/redis";
import { executeIfInSync } from "../utils/syncState";
import { pushMiniTicker } from "../websocket/broadcaster";

const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL || '2147483647');
const USE_RAW_SQL = process.env.USE_RAW_SQL === 'true';
const USE_STATIC_TOKEN_DATA = process.env.USE_STATIC_TOKEN_DATA !== 'false';

dotenv.config();

// Static token data mapping for core chain tokens to avoid RPC calls
const STATIC_TOKEN_DATA: Record<string, { symbol: string; name: string; decimals: number }> = {
	// Actual deployed token addresses from .env.core-chain
	"0x274bcac65b190d41bf866aa04e984e677675d500": {
		symbol: "gsWETH",
		name: "GTX Synthetic WETH",
		decimals: 18
	},
	"0x32eadcc3e41d18a1941044525a3ce23ab12e5c23": {
		symbol: "gsUSDC",
		name: "GTX Synthetic USDC",
		decimals: 6
	},
	"0xfbd1863c7e6d7b64fa456f79fa3a0aad2d1d2a3d": {
		symbol: "gsWBTC",
		name: "GTX Synthetic WBTC",
		decimals: 8
	}
};

async function fetchTokenData(client: any, address: string) {
	// Check environment variable to decide whether to use static data
	if (USE_STATIC_TOKEN_DATA) {
		const normalizedAddress = address.toLowerCase();
		const staticData = STATIC_TOKEN_DATA[normalizedAddress];

		if (staticData) {
			console.log(`Using static token data for ${address}: ${staticData.symbol}`);
			return staticData;
		}
	}

	try {
		const [symbol, name, decimals] = await client.multicall({
			contracts: [
				{ address, abi: ERC20ABI, functionName: "symbol" },
				{ address, abi: ERC20ABI, functionName: "name" },
				{ address, abi: ERC20ABI, functionName: "decimals" },
			],
			blockTag: "latest"
		});

		return {
			symbol: symbol.status === "success" ? symbol.result : "",
			name: name.status === "success" ? name.result : "",
			decimals: decimals.status === "success" ? decimals.result : 18,
		};
	} catch {
		try {
			return {
				symbol: await safeReadContract(client, address, "symbol"),
				name: await safeReadContract(client, address, "name"),
				decimals: (await safeReadContract(client, address, "decimals")) || 18,
			};
		} catch {
			return {
				symbol: "",
				name: "",
				decimals: 18,
			};
		}
	}
}

async function safeReadContract(client: any, address: string, functionName: string) {
	try {
		return await client.readContract({
			address,
			abi: ERC20ABI,
			functionName,
			blockTag: "latest"
		});
	} catch (e) {
		console.error(`Failed to get ${functionName} for ${address}:`, e);
		return functionName === "decimals" ? 18 : "";
	}
}

async function insertCurrency(context: any, chainId: number, address: Address, data: any) {
	if (USE_RAW_SQL) {
		const currencyId = createCurrencyId(chainId, address);
		await context.db.sql
			.insert(currencies)
			.values({
				id: currencyId,
				address: address,
				chainId,
				name: data.name,
				symbol: data.symbol,
				decimals: data.decimals,
			})
			.onConflictDoNothing();
	} else {
		await context.db
			.insert(currencies)
			.values({
				id: createCurrencyId(chainId, address),
				address: address,
				chainId,
				name: data.name,
				symbol: data.symbol,
				decimals: data.decimals,
			})
			.onConflictDoNothing();
	}
}

export async function handlePoolCreated({ event, context }: any) {
	const shouldDebug = await shouldEnableWebSocket(Number(event.block.number), 'handlePoolCreated');
	const logger = createLogger('poolManagerHandler.ts', 'handlePoolCreated');

	if (shouldDebug) {
		console.log(logger.log(event, '=== POOL CREATION DEBUG START ==='));
	}

	try {
		if (shouldDebug) {
			console.log(`${logger.log(event, '1. Raw event data')}: ${safeStringify({
				eventType: 'PoolCreated',
				blockNumber: event.block.number,
				blockHash: event.block.hash,
				txHash: event.transaction.hash,
				logIndex: event.log.logIndex,
				contractAddress: event.log.address
			})}`);
		}

		const { client, db } = context;
		const chainId = context.network.chainId;

		if (shouldDebug) {
			console.log(`${logger.log(event, '2. Context validation')}: ${safeStringify({
				hasClient: !!client,
				hasDb: !!db,
				chainId,
				networkName: context.network.name
			})}`);
		}

		if (!client) throw new Error('Client context is null or undefined');
		if (!db) throw new Error('Database context is null or undefined');
		if (!chainId) throw new Error('Chain ID is missing from context');

		if (shouldDebug) {
			console.log(`${logger.log(event, '3. Event args validation')}: ${safeStringify({
				args: event.args,
				hasBaseCurrency: !!event.args.baseCurrency,
				hasQuoteCurrency: !!event.args.quoteCurrency,
				hasOrderBook: !!event.args.orderBook
			})}`);
		}

		if (!event.args.baseCurrency) throw new Error('Missing baseCurrency in event args');
		if (!event.args.quoteCurrency) throw new Error('Missing quoteCurrency in event args');
		if (!event.args.orderBook) throw new Error('Missing orderBook in event args');

		const baseCurrency = getAddress(event.args.baseCurrency);
		const quoteCurrency = getAddress(event.args.quoteCurrency);

		if (shouldDebug) {
			console.log(`${logger.log(event, '4. Address conversion')}: ${safeStringify({
				baseCurrency,
				quoteCurrency,
				rawBaseCurrency: event.args.baseCurrency,
				rawQuoteCurrency: event.args.quoteCurrency
			})}`);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '5. Fetching token data...'));
		}

		let baseData, quoteData;
		try {
			baseData = await fetchTokenData(client, baseCurrency);
			if (shouldDebug) {
				console.log(`${logger.log(event, '5a. Base token data fetched')}: ${safeStringify({
					address: baseCurrency,
					symbol: baseData.symbol,
					name: baseData.name,
					decimals: baseData.decimals
				})}`);
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '5a. Base token data fetch failed')}: ${safeStringify(error)}`);
			}
			throw new Error(`Failed to fetch base token data: ${(error as Error).message}`);
		}

		try {
			quoteData = await fetchTokenData(client, quoteCurrency);
			if (shouldDebug) {
				console.log(`${logger.log(event, '5b. Quote token data fetched')}: ${safeStringify({
					address: quoteCurrency,
					symbol: quoteData.symbol,
					name: quoteData.name,
					decimals: quoteData.decimals
				})}`);
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '5b. Quote token data fetch failed')}: ${safeStringify(error)}`);
			}
			throw new Error(`Failed to fetch quote token data: ${(error as Error).message}`);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '6. Inserting currencies...'));
		}

		try {
			await insertCurrency(context, chainId, baseCurrency, baseData);
			if (shouldDebug) {
				console.log(`${logger.log(event, '6a. Base currency inserted successfully')}: ${safeStringify({ currencyId: createCurrencyId(chainId, baseCurrency) })}`);
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '6a. Base currency insertion failed')}: ${safeStringify(error)}`);
			}
			throw new Error(`Failed to insert base currency: ${(error as Error).message}`);
		}

		try {
			await insertCurrency(context, chainId, quoteCurrency, quoteData);
			if (shouldDebug) {
				console.log(`${logger.log(event, '6b. Quote currency inserted successfully')}: ${safeStringify({ currencyId: createCurrencyId(chainId, quoteCurrency) })}`);
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '6b. Quote currency insertion failed')}: ${safeStringify(error)}`);
			}
			throw new Error(`Failed to insert quote currency: ${(error as Error).message}`);
		}

		const coin = `${baseData.symbol}/${quoteData.symbol}`;
		const orderBook = getAddress(event.args.orderBook);
		const poolId = createPoolId(chainId, orderBook);

		const timestamp = Number(event.block.timestamp);
		const poolData = {
			id: poolId,
			chainId,
			coin,
			orderBook,
			baseCurrency,
			quoteCurrency,
			baseDecimals: baseData.decimals,
			quoteDecimals: quoteData.decimals,
			volume: BigInt(0),
			volumeInQuote: BigInt(0),
			price: BigInt(0),
			timestamp,
		};

		try {
			if (USE_RAW_SQL) {
				await context.db.sql
					.insert(pools)
					.values(poolData)
					.onConflictDoNothing();
			} else {
				if (shouldDebug) {
					console.log(logger.log(event, '9a. Using Ponder stores API for pool insertion'));
				}
				await context.db
					.insert(pools)
					.values(poolData)
					.onConflictDoNothing();
			}
		} catch (error) {
			throw new Error(`Failed to insert pool: ${(error as Error).message}`);
		}

		try {
			const cacheKey = createPoolCacheKey(orderBook, chainId);
			await setChainCachedData(cacheKey, poolData, chainId, REDIS_CACHE_TTL, Number(event.block.number), 'handlePoolCreated');
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '10. Pool data caching failed')}: ${safeStringify(error)}`);
			}
		}

		try {
			await executeIfInSync(Number(event.block.number), async () => {
				const symbol = coin.replace("/", "").toLowerCase();
				try {
					pushMiniTicker(symbol, "0", "0", "0", "0");
				} catch (error) {
					throw new Error(`Failed to push MiniTicker: ${(error as Error).message}`);
				}
			}, 'handlePoolCreated');
		} catch (error) {
			throw new Error(`executeIfInSync failed: ${(error as Error).message}`);
		}

	} catch (error) {
		if (shouldDebug) {
			console.error(`${logger.log(event, 'POOL CREATION DEBUG FAILED')}: ${safeStringify({
				message: (error as Error).message,
				stack: (error as Error).stack,
				name: (error as Error).name,
				eventContext: {
					blockNumber: event?.block?.number,
					txHash: event?.transaction?.hash,
					contractAddress: event?.log?.address,
					args: event?.args
				}
			})}`);
		}
		throw error;
	}
}
