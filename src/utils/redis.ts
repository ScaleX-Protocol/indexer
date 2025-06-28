import { createClient } from 'redis';
import dotenv from 'dotenv';
import { safeStringify, createLogger } from './logger';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL || '3600'); 

let redisClient: ReturnType<typeof createClient> | null = null;

export const initRedisClient = async () => {
  try {
    if (!redisClient) {
      redisClient = createClient({
        url: REDIS_URL
      });
      
      redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });
      
      await redisClient.connect();
      console.log('Redis client connected');
    }
    return redisClient;
  } catch (error) {
    console.error('Failed to initialize Redis client:', error);
    return null;
  }
};

export const getCachedData = async <T>(key: string, blockNumber: number, callerFunction: string): Promise<T | null> => {
  const logger = createLogger('redis.ts', 'getCachedData');
  
  try {
    console.log(logger.logSimple(blockNumber, `${callerFunction} Starting cache retrieval: ${safeStringify({
      key,
      blockNumber
    })}`));
    
    const client = await initRedisClient();
    if (!client) {
      console.log(logger.logSimple(blockNumber, `${callerFunction} Redis client not available, returning null for key: ${key}`));
      return null;
    }
    
    const data = await client.get(key);
    const result = data ? JSON.parse(data, jsonReviver) as T : null;
    
    console.log(logger.logSimple(blockNumber, `${callerFunction} Cache retrieval completed: ${safeStringify({
      key,
      blockNumber,
      found: !!data,
      dataLength: data?.length || 0
    })}`));
    
    return result;
  } catch (error) {
    console.error(logger.logSimple(blockNumber, `${callerFunction} Error getting cached data: ${safeStringify({
      key,
      blockNumber,
      error: (error as Error).message,
      stack: (error as Error).stack
    })}`));
    console.error(`Error getting cached data for key ${key}:`, error);
    return null;
  }
};

const jsonReplacer = (_key: string, value: any) => {
  if (typeof value === 'bigint') {
    return { __type: 'bigint', value: value.toString() };
  }
  return value;
};

const jsonReviver = (_key: string, value: any) => {
  if (value && value.__type === 'bigint' && typeof value.value === 'string') {
    return BigInt(value.value);
  }
  return value;
};

export const setCachedData = async <T>(key: string, data: T, ttl: number = REDIS_CACHE_TTL, blockNumber: number, callerFunction: string): Promise<void> => {
  const logger = createLogger('redis.ts', 'setCachedData');
  
  try {
    console.log(logger.logSimple(blockNumber, `${callerFunction} Starting cache operation: ${safeStringify({
      key,
      ttl,
      dataType: typeof data,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : undefined
    })}`));
    
    const client = await initRedisClient();
    if (!client) {
      console.log(logger.logSimple(blockNumber, `${callerFunction} Redis client not available, skipping cache operation for key: ${key}`));
      return;
    }
    
    const serializedData = JSON.stringify(data, jsonReplacer);
    console.log(logger.logSimple(blockNumber, `${callerFunction} Data serialized successfully: ${safeStringify({
      key,
      serializedLength: serializedData.length,
      containsBigInt: serializedData.includes('__type":"bigint"')
    })}`));
    
    await client.set(key, serializedData, { EX: ttl });
    console.log(logger.logSimple(blockNumber, `${callerFunction} Cache set successfully: ${safeStringify({
      key,
      ttl,
      success: true
    })}`));
  } catch (error) {
    console.error(logger.logSimple(blockNumber, `${callerFunction} Error setting cached data: ${safeStringify({
      key,
      ttl,
      error: (error as Error).message,
      stack: (error as Error).stack
    })}`));
    console.error(`Error setting cached data for key ${key}:`, error);
  }
};

export const createPoolCacheKey = (orderBook: string, chainId: number): string => {
  return `pool:${orderBook.toLowerCase()}:${chainId}`;
};
