import { eq } from "ponder";
import { pools } from "../../ponder.schema";
import { createLogger } from "./logger";
import { createPoolCacheKey, getCachedData, setCachedData } from "./redis";
import { validatePoolId } from "./validation";
import { shouldEnableWebSocket } from "./syncState";

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

export const getPoolTradingPair = async (context: any, pool: `0x${string}`, chainId: number, blockNumber?: number) => {
    const shouldDebug = blockNumber ? await shouldEnableWebSocket(blockNumber) : false;
    const logger = createLogger('getPoolTradingPair.ts', 'getPoolTradingPair');
    
    if (shouldDebug) {
        console.log(`${logger.logSimple(blockNumber, '=== DEBUG START ===')}`);
        console.log(`${logger.logSimple(blockNumber, '1. Input parameters')}: ${JSON.stringify({
            pool,
            chainId,
            blockNumber,
            poolType: typeof pool,
            chainIdType: typeof chainId
        })}`);
    }

    try {
        const validatedPoolId = validatePoolId(pool);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '2. Pool validation')}: ${JSON.stringify({
                originalPool: pool,
                validatedPoolId,
                validationPassed: !!validatedPoolId
            })}`);
        }

        const cacheKey = createPoolCacheKey(validatedPoolId, chainId);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '3. Cache key creation')}: ${JSON.stringify({
                cacheKey,
                validatedPoolId,
                chainId
            })}`);
            
            // Log all Redis data before attempting to get specific cache
            try {
                const { initRedisClient } = await import('./redis');
                const client = await initRedisClient();
                if (client) {
                    console.log(`${logger.logSimple(blockNumber, '3a. Attempting to get all Redis keys...')}`);
                    const allKeys = await client.keys('pool:*');
                    console.log(`${logger.logSimple(blockNumber, '3b. All Redis pool keys')}:`, allKeys);
                    
                    if (allKeys.length > 0) {
                        console.log(`${logger.logSimple(blockNumber, '3c. All Redis pool data')}`);
                        for (const key of allKeys) {
                            try {
                                const data = await client.get(key);
                                console.log(`  ${key}:`, data ? JSON.parse(data) : null);
                            } catch (err) {
                                console.log(`  ${key}: Error parsing -`, err);
                            }
                        }
                    } else {
                        console.log(`${logger.logSimple(blockNumber, '3c. No pool data found in Redis')}`);
                    }
                } else {
                    console.log(`${logger.logSimple(blockNumber, '3a. Redis client not available')}`);
                }
            } catch (err) {
                console.log(`${logger.logSimple(blockNumber, '3a. Error accessing Redis for debugging')}:`, err);
            }
        }
        
        const cachedPoolData = await getCachedData<PoolData>(cacheKey);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '4. Cache lookup result')}: ${JSON.stringify({
                cacheKey,
                hasCachedData: !!cachedPoolData,
                cachedDataKeys: cachedPoolData ? Object.keys(cachedPoolData) : null,
                cachedCoin: cachedPoolData?.coin,
                cacheHit: !!(cachedPoolData && cachedPoolData.coin)
            })}`);
        }
        
        if (cachedPoolData && cachedPoolData.coin) {
            const result = cachedPoolData.coin.replace('/', '').toLowerCase();
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '5. Cache hit - returning')}: ${JSON.stringify({
                    originalCoin: cachedPoolData.coin,
                    processedResult: result
                })}`);
                console.log(`${logger.logSimple(blockNumber, '=== GET POOL TRADING PAIR DEBUG END (CACHE HIT) ===')}`);
            }
            return result;
        }
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '6. Cache miss - querying database')}: ${JSON.stringify({
                searchCriteria: {
                    orderBook: validatedPoolId,
                    chainId: chainId
                },
                hasContext: !!context,
                hasDb: !!context?.db
            })}`);
        }
        
        let poolData;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                if (shouldDebug) {
                    console.log(`${logger.logSimple(blockNumber, `6a. Database query attempt ${retryCount + 1}/${maxRetries}`)}`);
                    console.log(`${logger.logSimple(blockNumber, '6a1. Query parameters')}: ${JSON.stringify({
                        table: 'pools',
                        method: 'context.db.find',
                        params: {
                            orderBook: validatedPoolId,
                            chainId: chainId
                        },
                        validatedPoolIdType: typeof validatedPoolId,
                        chainIdType: typeof chainId
                    })}`);
                }
                
                // Add a small delay on retries to let reorg complete
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
                }
                
                poolData = await context.db.find(pools, {
                    orderBook: validatedPoolId,
                    chainId: chainId
                });
                
                if (shouldDebug) {
                    console.log(`${logger.logSimple(blockNumber, `6b. Database query successful on attempt ${retryCount + 1}`)}`);
                }
                break;
                
            } catch (error) {
                retryCount++;
                if (shouldDebug) {
                    console.log(`${logger.logSimple(blockNumber, `6c. Database query failed on attempt ${retryCount}`)} - error:`, error instanceof Error ? error.message : error);
                }
                
                if (retryCount >= maxRetries) {
                    throw error;
                }
            }
        }

        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '7. Database find result')}: ${JSON.stringify({
                foundPoolData: !!poolData,
                poolDataKeys: poolData ? Object.keys(poolData) : null,
                poolDataCoin: poolData?.coin
            })}`);
        }

        if (!poolData) {
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '8. Fallback SQL query attempt')}: ${JSON.stringify({
                    reason: 'context.db.find returned null/undefined'
                })}`);
            }
            
            let poolRows;
            let sqlRetryCount = 0;
            const sqlMaxRetries = 3;
            
            while (sqlRetryCount < sqlMaxRetries) {
                try {
                    if (shouldDebug) {
                        console.log(`${logger.logSimple(blockNumber, `8a. SQL query attempt ${sqlRetryCount + 1}/${sqlMaxRetries}`)}`);
                        console.log(`${logger.logSimple(blockNumber, '8a1. SQL query parameters')}: ${JSON.stringify({
                            table: 'pools',
                            method: 'context.db.sql.select',
                            whereConditions: [
                                { field: 'pools.orderBook', operator: 'eq', value: validatedPoolId },
                                { field: 'pools.chainId', operator: 'eq', value: chainId }
                            ],
                            limit: 1,
                            validatedPoolId,
                            chainId,
                            validatedPoolIdType: typeof validatedPoolId,
                            chainIdType: typeof chainId
                        })}`);
                    }
                    
                    // Add a small delay on retries
                    if (sqlRetryCount > 0) {
                        await new Promise(resolve => setTimeout(resolve, 100 * sqlRetryCount));
                    }
                    
                    poolRows = await context.db.sql.select().from(pools).where(
                        eq(pools.orderBook, validatedPoolId), 
                        eq(pools.chainId, chainId)
                    ).limit(1).execute();
                    
                    if (shouldDebug) {
                        console.log(`${logger.logSimple(blockNumber, `8b. SQL query successful on attempt ${sqlRetryCount + 1}`)}`);
                    }
                    break;
                    
                } catch (error) {
                    sqlRetryCount++;
                    if (shouldDebug) {
                        console.log(`${logger.logSimple(blockNumber, `8c. SQL query failed on attempt ${sqlRetryCount}`)} - error:`, error instanceof Error ? error.message : error);
                    }
                    
                    if (sqlRetryCount >= sqlMaxRetries) {
                        throw error;
                    }
                }
            }
            
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '9. SQL query result')}: ${JSON.stringify({
                    rowsFound: poolRows.length,
                    firstRowKeys: poolRows.length > 0 ? Object.keys(poolRows[0]) : null,
                    firstRowCoin: poolRows.length > 0 ? poolRows[0].coin : null
                })}`);
            }
            
            if (poolRows.length > 0) {
                poolData = poolRows[0];
            }
        }
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '10. Final pool data before caching')}: ${JSON.stringify({
                hasPoolData: !!poolData,
                poolDataCoin: poolData?.coin,
                poolDataKeys: poolData ? Object.keys(poolData) : null
            })}`);
        }
        
        await setCachedData(cacheKey, poolData);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '11. Data cached successfully')}`);
        }
        
        if (!poolData || !poolData.coin) {
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '12. ERROR: No pool data or coin found')}: ${JSON.stringify({
                    hasPoolData: !!poolData,
                    hasCoin: !!poolData?.coin,
                    poolData: poolData
                })}`);
                console.log(`${logger.logSimple(blockNumber, '=== GET POOL TRADING PAIR DEBUG END (ERROR) ===')}`);
            }
            throw new Error(`Pool data not found for pool ${pool} on chain ${chainId}`);
        }
        
        const result = poolData.coin.replace('/', '').toLowerCase();
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '13. Success - returning result')}: ${JSON.stringify({
                originalCoin: poolData.coin,
                processedResult: result
            })}`);
            console.log(`${logger.logSimple(blockNumber, '=== GET POOL TRADING PAIR DEBUG END (SUCCESS) ===')}`);
        }
        
        return result;
    } catch (error) {
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, 'ERROR in getPoolTradingPair')}: ${JSON.stringify({
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                pool,
                chainId,
                blockNumber
            })}`);
            console.log(`${logger.logSimple(blockNumber, '=== GET POOL TRADING PAIR DEBUG END (EXCEPTION) ===')}`);
        }
        throw error;
    }
};