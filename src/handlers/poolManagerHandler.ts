import { createCurrencyId, createPoolId } from "@/utils";
import { createLogger, safeStringify } from "@/utils/logger";
import { shouldEnableWebSocket } from "@/utils/syncState";
import dotenv from "dotenv";
import { sql } from "ponder";
import { currencies, pools } from "ponder:schema";
import { Address, getAddress } from "viem";
import { ERC20ABI } from "../../abis/ERC20";
import { createPoolCacheKey, setCachedData } from "../utils/redis";
import { executeIfInSync } from "../utils/syncState";
import { pushMiniTicker } from "../websocket/broadcaster";

const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL || '3600');
const USE_RAW_SQL = process.env.USE_RAW_SQL === 'true';

dotenv.config();

async function fetchTokenData(client: any, address: string) {
	try {
		const [symbol, name, decimals] = await client.multicall({
			contracts: [
				{ address, abi: ERC20ABI, functionName: "symbol" },
				{ address, abi: ERC20ABI, functionName: "name" },
				{ address, abi: ERC20ABI, functionName: "decimals" },
			],
		});

		return {
			symbol: symbol.status === "success" ? symbol.result : "",
			name: name.status === "success" ? name.result : "",
			decimals: decimals.status === "success" ? decimals.result : 18,
		};
	} catch {
		return {
			symbol: await safeReadContract(client, address, "symbol"),
			name: await safeReadContract(client, address, "name"),
			decimals: (await safeReadContract(client, address, "decimals")) || 18,
		};
	}
}

async function safeReadContract(client: any, address: string, functionName: string) {
	try {
		return await client.readContract({ address, abi: ERC20ABI, functionName });
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

		if (shouldDebug) {
			console.log(`${logger.log(event, '7. Pool identifiers created')}: ${safeStringify({
				coin,
				orderBook,
				poolId,
				rawOrderBook: event.args.orderBook
			})}`);
		}

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

		if (shouldDebug) {
			console.log(`${logger.log(event, '8. Pool data structure created')}: ${safeStringify({
				poolId: poolData.id,
				coin: poolData.coin,
				orderBook: poolData.orderBook,
				baseCurrency: poolData.baseCurrency,
				quoteCurrency: poolData.quoteCurrency,
				baseDecimals: poolData.baseDecimals,
				quoteDecimals: poolData.quoteDecimals,
				timestamp: poolData.timestamp
			})}`);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '9. Inserting pool into database...'));
		}

		try {
			if (USE_RAW_SQL) {
				if (shouldDebug) {
					console.log(logger.log(event, '9a. Using raw SQL for pool insertion'));
				}
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
			if (shouldDebug) {
				console.log(`${logger.log(event, '9. Pool inserted successfully')}: ${safeStringify({ method: USE_RAW_SQL ? 'raw SQL' : 'Ponder stores API' })}`);
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '9. Pool insertion failed')}: ${safeStringify({ error, method: USE_RAW_SQL ? 'raw SQL' : 'Ponder stores API' })}`);
			}
			throw new Error(`Failed to insert pool: ${(error as Error).message}`);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '10. Caching pool data...'));
		}

		try {
			const cacheKey = createPoolCacheKey(orderBook, chainId);
			if (shouldDebug) {
				console.log(`${logger.log(event, '10a. Cache key created')}: ${safeStringify({ cacheKey })}`);
			}
			await setCachedData(cacheKey, poolData, REDIS_CACHE_TTL, Number(event.block.number), 'handlePoolCreated');
			if (shouldDebug) {
				console.log(logger.log(event, '10. Pool data cached successfully'));
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '10. Pool data caching failed')}: ${safeStringify(error)}`);
			}
			console.error('Failed to cache pool data:', error);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '11. Starting executeIfInSync operation...'));
		}

		try {
			await executeIfInSync(Number(event.block.number), async () => {
				if (shouldDebug) {
					console.log(logger.log(event, '11a. Inside executeIfInSync callback'));
				}

				const symbol = coin.replace("/", "").toLowerCase();
				if (shouldDebug) {
					console.log(`${logger.log(event, '11b. Symbol created for WebSocket')}: ${safeStringify({ originalCoin: coin, symbol })}`);
				}

				try {
					pushMiniTicker(symbol, "0", "0", "0", "0");
					if (shouldDebug) {
						console.log(logger.log(event, '11c. MiniTicker pushed successfully'));
					}
				} catch (error) {
					if (shouldDebug) {
						console.error(`${logger.log(event, '11c. MiniTicker push failed')}: ${safeStringify(error)}`);
					}
					throw new Error(`Failed to push MiniTicker: ${(error as Error).message}`);
				}

				if (shouldDebug) {
					console.log(logger.log(event, '11d. executeIfInSync callback completed successfully'));
				}
			}, 'handlePoolCreated');
			if (shouldDebug) {
				console.log(logger.log(event, '11. executeIfInSync operation completed successfully'));
			}
		} catch (error) {
			if (shouldDebug) {
				console.error(`${logger.log(event, '11. executeIfInSync operation failed')}: ${safeStringify(error)}`);
			}
			throw new Error(`executeIfInSync failed: ${(error as Error).message}`);
		}

		if (shouldDebug) {
			console.log(logger.log(event, '12. POOL CREATION DEBUG SUCCESS'));
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
