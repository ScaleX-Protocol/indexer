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

export const getPoolTradingPair = async (context: any, pool: `0x${string}`, chainId: number, callerFunction: string, blockNumber?: number) => {
    const shouldDebug = blockNumber ? await shouldEnableWebSocket(blockNumber, callerFunction) : false;
    const logger = createLogger('getPoolTradingPair.ts', 'getPoolTradingPair');
    
    if (shouldDebug) {
        console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR START =====`));
        console.log(logger.logSimple(blockNumber, `${callerFunction} Input parameters: ${safeStringify({
            pool,
            chainId,
            blockNumber,
            poolType: typeof pool,
            chainIdType: typeof chainId
        })}`));
    }

    try {
        const validatedPoolId = validatePoolId(pool);
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Pool validation: ${safeStringify({
                originalPool: pool,
                validatedPoolId,
                validationPassed: !!validatedPoolId
            })}`));
        }

        const cacheKey = createPoolCacheKey(validatedPoolId, chainId);
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Cache key creation: ${safeStringify({
                cacheKey,
                validatedPoolId,
                chainId
            })}`));
        }
        
        const cachedPoolData = await getCachedData<PoolData>(cacheKey, blockNumber || 0, callerFunction);
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Cache lookup result: ${safeStringify({
                cacheKey,
                hasCachedData: !!cachedPoolData,
                cachedDataKeys: cachedPoolData ? Object.keys(cachedPoolData) : null,
                cachedCoin: cachedPoolData?.coin,
                cacheHit: !!(cachedPoolData && cachedPoolData.coin)
            })}`));
        }
        
        if (cachedPoolData && cachedPoolData.coin) {
            const result = cachedPoolData.coin.replace('/', '').toLowerCase();
            if (shouldDebug) {
                console.log(logger.logSimple(blockNumber, `${callerFunction} Cache hit - returning: ${safeStringify({
                    originalCoin: cachedPoolData.coin,
                    processedResult: result
                })}`));
                console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (CACHE HIT) =====`));
            }
            return result;
        }
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Cache miss - querying database: ${safeStringify({
                searchCriteria: {
                    orderBook: validatedPoolId,
                    chainId: chainId
                },
                hasContext: !!context,
                hasDb: !!context?.db
            })}`));
        }
        
        let poolData;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                if (shouldDebug) {
                    console.log(logger.logSimple(blockNumber, `${callerFunction} Database query attempt ${retryCount + 1}/${maxRetries}`));
                    console.log(logger.logSimple(blockNumber, `${callerFunction} Query parameters: ${safeStringify({
                        table: 'pools',
                        method: 'context.db.find',
                        params: {
                            orderBook: validatedPoolId,
                            chainId: chainId
                        },
                        validatedPoolIdType: typeof validatedPoolId,
                        chainIdType: typeof chainId
                    })}`));
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
                    console.log(logger.logSimple(blockNumber, `${callerFunction} Database query successful on attempt ${retryCount + 1}`));
                }
                break;
                
            } catch (error) {
                retryCount++;
                if (shouldDebug) {
                    console.log(logger.logSimple(blockNumber, `${callerFunction} Database query failed on attempt ${retryCount}: ${safeStringify(error instanceof Error ? error.message : error)}`));
                }
                
                if (retryCount >= maxRetries) {
                    throw error;
                }
            }
        }

        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Database find result: ${safeStringify({
                foundPoolData: !!poolData,
                poolDataKeys: poolData ? Object.keys(poolData) : null,
                poolDataCoin: poolData?.coin
            })}`));
        }

        if (!poolData) {
            if (shouldDebug) {
                console.log(logger.logSimple(blockNumber, `${callerFunction} Fallback SQL query attempt: ${safeStringify({
                    reason: 'context.db.find returned null/undefined'
                })}`));
            }
            
            let poolRows;
            let sqlRetryCount = 0;
            const sqlMaxRetries = 3;
            
            while (sqlRetryCount < sqlMaxRetries) {
                try {
                    if (shouldDebug) {
                        console.log(logger.logSimple(blockNumber, `${callerFunction} SQL query attempt ${sqlRetryCount + 1}/${sqlMaxRetries}`));
                        console.log(logger.logSimple(blockNumber, `${callerFunction} SQL query parameters: ${safeStringify({
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
                        })}`));
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
                        console.log(logger.logSimple(blockNumber, `${callerFunction} SQL query successful on attempt ${sqlRetryCount + 1}`));
                    }
                    break;
                    
                } catch (error) {
                    sqlRetryCount++;
                    if (shouldDebug) {
                        console.log(logger.logSimple(blockNumber, `${callerFunction} SQL query failed on attempt ${sqlRetryCount}: ${safeStringify(error instanceof Error ? error.message : error)}`));
                    }
                    
                    if (sqlRetryCount >= sqlMaxRetries) {
                        throw error;
                    }
                }
            }
            
            if (shouldDebug) {
                console.log(logger.logSimple(blockNumber, `${callerFunction} SQL query result: ${safeStringify({
                    rowsFound: poolRows.length,
                    firstRowKeys: poolRows.length > 0 ? Object.keys(poolRows[0]) : null,
                    firstRowCoin: poolRows.length > 0 ? poolRows[0].coin : null
                })}`));
            }
            
            if (poolRows.length > 0) {
                poolData = poolRows[0];
            }
        }
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Final pool data before caching: ${safeStringify({
                hasPoolData: !!poolData,
                poolDataCoin: poolData?.coin,
                poolDataKeys: poolData ? Object.keys(poolData) : null
            })}`));
        }
        
        await setCachedData(cacheKey, poolData, 3600, blockNumber || 0, callerFunction);
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Data cached successfully`));
        }
        
        if (!poolData || !poolData.coin) {
            if (shouldDebug) {
                console.log(logger.logSimple(blockNumber, `${callerFunction} ERROR: No pool data or coin found: ${safeStringify({
                    hasPoolData: !!poolData,
                    hasCoin: !!poolData?.coin,
                    poolData: poolData
                })}`));
                console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (ERROR) =====`));
            }
            throw new Error(`Pool data not found for pool ${pool} on chain ${chainId}`);
        }
        
        const result = poolData.coin.replace('/', '').toLowerCase();
        
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} Success - returning result: ${safeStringify({
                originalCoin: poolData.coin,
                processedResult: result
            })}`));
            console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (SUCCESS) =====`));
        }
        
        return result;
    } catch (error) {
        if (shouldDebug) {
            console.log(logger.logSimple(blockNumber, `${callerFunction} ERROR in getPoolTradingPair: ${safeStringify({
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                pool,
                chainId,
                blockNumber
            })}`));
            console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (EXCEPTION) =====`));
        }
        throw error;
    }
};