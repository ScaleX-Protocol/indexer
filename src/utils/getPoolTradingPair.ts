import { eq } from "ponder";
import { pools } from "../../ponder.schema";
import { createPoolCacheKey, getCachedData, setCachedData } from "./redis";
import { validatePoolId } from "./validation";

type PoolData = {
  id: string;
  chainId: number;
  coin: string;
  orderBook: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  volume: bigint;
  volumeInQuote: bigint;
  price: bigint;
  timestamp: number;
};

export const getPoolTradingPair = async (context: any, pool: `0x${string}`, chainId: number) => {
    const validatedPoolId = validatePoolId(pool);

    const cacheKey = createPoolCacheKey(validatedPoolId, chainId);
    const cachedPoolData = await getCachedData<PoolData>(cacheKey);
    
    if (cachedPoolData && cachedPoolData.coin) {
        return cachedPoolData.coin.replace('/', '').toLowerCase();
    }
    
    let poolData = await context.db.find(pools, {
        orderBook: validatedPoolId,
        chainId: chainId
    });

    if (!poolData) {
        const poolRows = await context.db.sql.select().from(pools).where(
            eq(pools.orderBook, validatedPoolId), 
            eq(pools.chainId, chainId)
        ).limit(1).execute();
        
        if (poolRows.length > 0) {
            poolData = poolRows[0];
        }
    }
    
    await setCachedData(cacheKey, poolData);
    
    return poolData.coin.replace('/', '').toLowerCase();
};