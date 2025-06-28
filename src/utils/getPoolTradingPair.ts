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

const STATIC_POOL_DATA = {
    "data": {
      "poolss": {
        "items": [
          {
            "chainId": 11155931,
            "id": "a8e602dc46351c604f988ea52ff319d45d07d892fdf2da4fac572e3eab48657f",
            "coin": "MUSDC/mWBTC",
            "orderBook": "0x0c7907a26424bae17908803d1045604e8c1bb19f",
            "price": "10720688650000",
            "quoteDecimals": 8,
            "timestamp": 1751112787,
            "volume": "26200000",
            "volumeInQuote": "280960220318000",
            "baseDecimals": 6,
            "quoteCurrency": {
              "address": "0xca1de9daf1d62d0e0e9cd1db7e3a31c61875a6c0",
              "chainId": 11155931,
              "id": "9752ff740daa0034507394c6fa8bebfa01cf4c152859cf7984064964f423108c",
              "decimals": 8,
              "name": "Mock WBTC",
              "symbol": "mWBTC"
            },
            "baseCurrency": {
              "symbol": "MUSDC",
              "name": "MockUSDC",
              "id": "79ddf016627fedccb8660681b22c6311d6d5b74996442bc33796a9ace66b0676",
              "decimals": 6,
              "chainId": 11155931,
              "address": "0xa652aede05d70c1aff00249ac05a9d021f9d30c2"
            }
          },
          {
            "chainId": 11155931,
            "id": "d751ecff384afb051fb9917e00fcfbceea1a7df23ce9a76d8cfc410a00b2fc97",
            "coin": "MWETH/MUSDC",
            "orderBook": "0x9ce34b49aee0bba07a34752a917189b34b54d433",
            "price": "1980000000",
            "quoteDecimals": 6,
            "timestamp": 1751114691,
            "volume": "112700000000000000000",
            "volumeInQuote": "1291082012710019207999988",
            "baseDecimals": 18,
            "baseCurrency": {
              "symbol": "MWETH",
              "name": "MockWETH",
              "id": "f7324016cb4804fcf77959766a4a0262b549ac07ad7972b802595b56f654286d",
              "decimals": 18,
              "chainId": 11155931,
              "address": "0x05d889798a21c3838d7ff6f67cd46b576dab2174"
            },
            "quoteCurrency": {
              "address": "0xa652aede05d70c1aff00249ac05a9d021f9d30c2",
              "chainId": 11155931,
              "id": "79ddf016627fedccb8660681b22c6311d6d5b74996442bc33796a9ace66b0676",
              "decimals": 6,
              "name": "MockUSDC",
              "symbol": "MUSDC"
            }
          }
        ]
      }
    }
  };

// Check if static data mode is enabled
const USE_STATIC_DATA = process.env.USE_STATIC_POOL_DATA === 'true';

/**
 * Get pool data from static configuration
 */
const getStaticPoolData = (orderBook: string, chainId: number): PoolData | null => {
  const pool = STATIC_POOL_DATA.data.poolss.items.find(
    item => item.orderBook.toLowerCase() === orderBook.toLowerCase() && item.chainId === chainId
  );
  
  if (!pool) {
    return null;
  }
  
  return {
    id: pool.id,
    chainId: pool.chainId,
    coin: pool.coin,
    orderBook: pool.orderBook,
    baseCurrency: "", // Not available in static data
    quoteCurrency: pool.quoteCurrency.address,
    baseDecimals: pool.baseDecimals,
    quoteDecimals: pool.quoteDecimals,
    volume: BigInt(pool.volume),
    volumeInQuote: BigInt(pool.volumeInQuote),
    price: BigInt(pool.price),
    timestamp: pool.timestamp,
  };
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
            chainIdType: typeof chainId,
            useStaticData: USE_STATIC_DATA
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

        // If static data mode is enabled, use static pool data
        if (USE_STATIC_DATA) {
            if (shouldDebug) {
                console.log(logger.logSimple(blockNumber, `${callerFunction} Using static pool data mode`));
            }
            
            const staticPoolData = getStaticPoolData(validatedPoolId, chainId);
            
            if (staticPoolData && staticPoolData.coin) {
                const result = staticPoolData.coin.replace('/', '').toLowerCase();
                if (shouldDebug) {
                    console.log(logger.logSimple(blockNumber, `${callerFunction} Static data found - returning: ${safeStringify({
                        originalCoin: staticPoolData.coin,
                        processedResult: result,
                        poolData: staticPoolData
                    })}`));
                    console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (STATIC DATA) =====`));
                }
                return result;
            } else {
                if (shouldDebug) {
                    console.log(logger.logSimple(blockNumber, `${callerFunction} No static data found for pool ${validatedPoolId} on chain ${chainId}`));
                    console.log(logger.logSimple(blockNumber, `${callerFunction} ===== GET POOL TRADING PAIR END (STATIC DATA NOT FOUND) =====`));
                }
                throw new Error(`Static pool data not found for pool ${pool} on chain ${chainId}`);
            }
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