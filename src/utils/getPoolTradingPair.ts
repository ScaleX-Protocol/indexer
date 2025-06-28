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
          "baseDecimals": 8,
          "chainId": 11155931,
          "coin": "mWBTC/MUSDC",
          "id": "5dec33f246999d5aebb70e3adc138ab9203c22b522c843c6325f1b696d8fc45c",
          "orderBook": "0xd9fcb06641bd88d888ebca7c9d6eda774cd11e43",
          "price": "0",
          "quoteDecimals": 6,
          "volume": "0",
          "timestamp": 1746888129,
          "volumeInQuote": "0",
          "quoteCurrency": {
            "address": "0x4b9a14ca8b00b6d83c8d663a4d9471a79ca6f58e",
            "chainId": 11155931,
            "decimals": 6,
            "id": "80dafa0151c39bd79ce3e637c01f8dff3c75f4e097261f6f14d7161cd1d471f4",
            "name": "MockUSDC",
            "symbol": "MUSDC"
          }
        },
        {
          "baseDecimals": 18,
          "chainId": 11155931,
          "coin": "MLINK/MUSDC",
          "id": "b31aeaca00c53a694f9e622c4db434f444d7efa95fc079d54e632544a562b5b3",
          "orderBook": "0xbcd9b173dcb1374e344c449840b6a317542632f4",
          "price": "0",
          "quoteDecimals": 6,
          "volume": "0",
          "timestamp": 1747407547,
          "volumeInQuote": "0",
          "quoteCurrency": {
            "address": "0x4b9a14ca8b00b6d83c8d663a4d9471a79ca6f58e",
            "chainId": 11155931,
            "decimals": 6,
            "id": "80dafa0151c39bd79ce3e637c01f8dff3c75f4e097261f6f14d7161cd1d471f4",
            "name": "MockUSDC",
            "symbol": "MUSDC"
          }
        },
        {
          "baseDecimals": 18,
          "chainId": 11155931,
          "coin": "MWETH/MUSDC",
          "id": "d8466431bc58e06019a343acf064464d65361ece575367fddc25d2951b3fb8cb",
          "orderBook": "0xb154f8d27e328a788140f121d649e0684f80923a",
          "price": "2495040000",
          "quoteDecimals": 6,
          "volume": "43456392200000000410872",
          "timestamp": 1750527318,
          "volumeInQuote": "108540494287099",
          "quoteCurrency": {
            "address": "0x4b9a14ca8b00b6d83c8d663a4d9471a79ca6f58e",
            "chainId": 11155931,
            "decimals": 6,
            "id": "80dafa0151c39bd79ce3e637c01f8dff3c75f4e097261f6f14d7161cd1d471f4",
            "name": "MockUSDC",
            "symbol": "MUSDC"
          }
        },
        {
          "baseDecimals": 18,
          "chainId": 11155931,
          "coin": "/",
          "id": "db889952f7a2ad35ba827bd29bb4454fc2f94af13167c5d677efaeb4e9190700",
          "orderBook": "0x54a8b50180d8bdc30a41b381daa85e223acb9836",
          "price": "0",
          "quoteDecimals": 18,
          "volume": "0",
          "timestamp": 1747407247,
          "volumeInQuote": "0",
          "quoteCurrency": {
            "address": "0x0000000000000000000000000000000000000000",
            "chainId": 11155931,
            "decimals": 18,
            "id": "2bbcb676028636158e156c7e7d08dd4b04459fa2a8e31d72185ab4755fab99cc",
            "name": "",
            "symbol": ""
          }
        },
        {
          "baseDecimals": 18,
          "chainId": 11155931,
          "coin": "MADA/",
          "id": "e507be30c686e05c79e2b5becd9a826c66ccd2260fc9cec8532ef78787ff5628",
          "orderBook": "0x19e511baa073400da230c88e1a9e80fd1bfc1d83",
          "price": "0",
          "quoteDecimals": 18,
          "volume": "0",
          "timestamp": 1747837285,
          "volumeInQuote": "0",
          "quoteCurrency": {
            "address": "0x0000000000000000000000000000000000000000",
            "chainId": 11155931,
            "decimals": 18,
            "id": "2bbcb676028636158e156c7e7d08dd4b04459fa2a8e31d72185ab4755fab99cc",
            "name": "",
            "symbol": ""
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