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
		name: "ScaleX Synthetic WETH",
		decimals: 18
	},
	"0x32eadcc3e41d18a1941044525a3ce23ab12e5c23": {
		symbol: "gsUSDC",
		name: "ScaleX Synthetic USDC",
		decimals: 6
	},
	"0xfbd1863c7e6d7b64fa456f79fa3a0aad2d1d2a3d": {
		symbol: "gsWBTC",
		name: "ScaleX Synthetic WBTC",
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
	try {
		const { client, db } = context;
		const chainId = context.network.chainId;

		if (!client) throw new Error('Client context is null or undefined');
		if (!db) throw new Error('Database context is null or undefined');
		if (!chainId) throw new Error('Chain ID is missing from context');

		if (!event.args.baseCurrency) throw new Error('Missing baseCurrency in event args');
		if (!event.args.quoteCurrency) throw new Error('Missing quoteCurrency in event args');
		if (!event.args.orderBook) throw new Error('Missing orderBook in event args');

		const baseCurrency = getAddress(event.args.baseCurrency);
		const quoteCurrency = getAddress(event.args.quoteCurrency);

		// Currencies are now recorded during token registration, not pool creation
		// Skip the currency insertion here to avoid duplicate work
		let baseData, quoteData;
		try {
			baseData = await fetchTokenData(client, baseCurrency);
		} catch (error) {
			// If token data fetch fails, use fallback data for pool creation
			baseData = {
				symbol: `BASE_${baseCurrency.slice(-6)}`,
				name: `Base Token`,
				decimals: 18
			};
		}

		try {
			quoteData = await fetchTokenData(client, quoteCurrency);
		} catch (error) {
			// If token data fetch fails, use fallback data for pool creation
			quoteData = {
				symbol: `QUOTE_${quoteCurrency.slice(-6)}`,
				name: `Quote Token`,
				decimals: 18
			};
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
			// Silently handle caching errors
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
		throw error;
	}
}
