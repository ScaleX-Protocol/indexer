import { eq } from "ponder";
import { pools } from "../../ponder.schema";
import { createLogger, safeStringify } from "./logger";
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
        console.log(logger.logSimple(blockNumber, '1. ===== GET POOL TRADING PAIR START ====='));
        console.log(`${logger.logSimple(blockNumber, '2. Input parameters')}: ${safeStringify({
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
            console.log(`${logger.logSimple(blockNumber, '3. Pool validation')}: ${safeStringify({
                originalPool: pool,
                validatedPoolId,
                validationPassed: !!validatedPoolId
            })}`);
        }

        const cacheKey = createPoolCacheKey(validatedPoolId, chainId);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '4. Cache key creation')}: ${safeStringify({
                cacheKey,
                validatedPoolId,
                chainId
            })}`);
            
            // Log all Redis data before attempting to get specific cache
            try {
                const { initRedisClient } = await import('./redis');
                const client = await initRedisClient();
                if (client) {
                    console.log(logger.logSimple(blockNumber, '4a. Attempting to get all Redis keys...'));
                    const allKeys = await client.keys('pool:*');
                    console.log(`${logger.logSimple(blockNumber, '4b. All Redis pool keys')}: ${safeStringify(allKeys)}`);
                    
                    if (allKeys.length > 0) {
                        console.log(logger.logSimple(blockNumber, '4c. All Redis pool data'));
                        for (const key of allKeys) {
                            try {
                                const data = await client.get(key);
                                console.log(`${logger.logSimple(blockNumber, `4c1. ${key}`)}: ${data ? safeStringify(JSON.parse(data)) : 'null'}`);
                            } catch (err) {
                                console.log(`${logger.logSimple(blockNumber, `4c1. ${key} - Error`)}: ${safeStringify(err)}`);
                            }
                        }
                    } else {
                        console.log(logger.logSimple(blockNumber, '4c. No pool data found in Redis'));
                    }
                } else {
                    console.log(logger.logSimple(blockNumber, '4a. Redis client not available'));
                }
            } catch (err) {
                console.log(`${logger.logSimple(blockNumber, '4a. Error accessing Redis for debugging')}: ${safeStringify(err)}`);
            }
        }
        
        const cachedPoolData = await getCachedData<PoolData>(cacheKey);
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '5. Cache lookup result')}: ${safeStringify({
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
                console.log(`${logger.logSimple(blockNumber, '6. Cache hit - returning')}: ${safeStringify({
                    originalCoin: cachedPoolData.coin,
                    processedResult: result
                })}`);
                console.log(logger.logSimple(blockNumber, '7. ===== GET POOL TRADING PAIR END (CACHE HIT) ====='));
            }
            return result;
        }
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '8. Cache miss - querying database')}: ${safeStringify({
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
                    console.log(logger.logSimple(blockNumber, `8a. Database query attempt ${retryCount + 1}/${maxRetries}`));
                    console.log(`${logger.logSimple(blockNumber, '8a1. Query parameters')}: ${safeStringify({
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
                    console.log(logger.logSimple(blockNumber, `8b. Database query successful on attempt ${retryCount + 1}`));
                }
                break;
                
            } catch (error) {
                retryCount++;
                if (shouldDebug) {
                    console.log(`${logger.logSimple(blockNumber, `8c. Database query failed on attempt ${retryCount}`)}: ${safeStringify(error instanceof Error ? error.message : error)}`);
                }
                
                if (retryCount >= maxRetries) {
                    throw error;
                }
            }
        }

        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '9. Database find result')}: ${safeStringify({
                foundPoolData: !!poolData,
                poolDataKeys: poolData ? Object.keys(poolData) : null,
                poolDataCoin: poolData?.coin
            })}`);
        }

        if (!poolData) {
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '10. Fallback SQL query attempt')}: ${safeStringify({
                    reason: 'context.db.find returned null/undefined'
                })}`);
            }
            
            let poolRows;
            let sqlRetryCount = 0;
            const sqlMaxRetries = 3;
            
            while (sqlRetryCount < sqlMaxRetries) {
                try {
                    if (shouldDebug) {
                        console.log(logger.logSimple(blockNumber, `10a. SQL query attempt ${sqlRetryCount + 1}/${sqlMaxRetries}`));
                        console.log(`${logger.logSimple(blockNumber, '10a1. SQL query parameters')}: ${safeStringify({
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
                        console.log(logger.logSimple(blockNumber, `10b. SQL query successful on attempt ${sqlRetryCount + 1}`));
                    }
                    break;
                    
                } catch (error) {
                    sqlRetryCount++;
                    if (shouldDebug) {
                        console.log(`${logger.logSimple(blockNumber, `10c. SQL query failed on attempt ${sqlRetryCount}`)}: ${safeStringify(error instanceof Error ? error.message : error)}`);
                    }
                    
                    if (sqlRetryCount >= sqlMaxRetries) {
                        throw error;
                    }
                }
            }
            
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '11. SQL query result')}: ${safeStringify({
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
            console.log(`${logger.logSimple(blockNumber, '12. Final pool data before caching')}: ${safeStringify({
                hasPoolData: !!poolData,
                poolDataCoin: poolData?.coin,
                poolDataKeys: poolData ? Object.keys(poolData) : null
            })}`);
        }
        
        await setCachedData(cacheKey, poolData);
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, '13. Data cached successfully'));
        }
        
        if (!poolData || !poolData.coin) {
            if (shouldDebug) {
                console.log(`${logger.logSimple(blockNumber, '14. ERROR: No pool data or coin found')}: ${safeStringify({
                    hasPoolData: !!poolData,
                    hasCoin: !!poolData?.coin,
                    poolData: poolData
                })}`);
                console.log(logger.logSimple(blockNumber, '15. ===== GET POOL TRADING PAIR END (ERROR) ====='));
            }
            throw new Error(`Pool data not found for pool ${pool} on chain ${chainId}`);
        }
        
        const result = poolData.coin.replace('/', '').toLowerCase();
        
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '16. Success - returning result')}: ${safeStringify({
                originalCoin: poolData.coin,
                processedResult: result
            })}`);
            console.log(logger.logSimple(blockNumber, '17. ===== GET POOL TRADING PAIR END (SUCCESS) ====='));
        }
        
        return result;
    } catch (error) {
        if (shouldDebug) {
            console.log(`${logger.logSimple(blockNumber, '18. ERROR in getPoolTradingPair')}: ${safeStringify({
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                pool,
                chainId,
                blockNumber
            })}`);
            console.log(logger.logSimple(blockNumber, '19. ===== GET POOL TRADING PAIR END (EXCEPTION) ====='));
        }
        throw error;
    }
};