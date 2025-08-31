import { createClient } from 'redis';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL || '2147483647'); 

let redisClient: ReturnType<typeof createClient> | null = null;
let ioredisClient: Redis | null = null;

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
  try {
    const client = await initRedisClient();
    if (!client) {
      return null;
    }
    
    const data = await client.get(key);
    const result = data ? JSON.parse(data, jsonReviver) as T : null;
    
    return result;
  } catch (error) {
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
  try {
    const client = await initRedisClient();
    if (!client) {
      return;
    }
    
    const serializedData = JSON.stringify(data, jsonReplacer);
    
    await client.set(key, serializedData, { EX: ttl });
  } catch (error) {
    console.error(`Error setting cached data for key ${key}:`, error);
  }
};

export const createPoolCacheKey = (orderBook: string, chainId: number): string => {
  return `pool:${orderBook.toLowerCase()}:${chainId}`;
};

export const initIORedisClient = async (): Promise<Redis | null> => {
  try {
    if (!ioredisClient) {
      ioredisClient = new Redis(REDIS_URL);
      
      ioredisClient.on('error', (err) => {
        console.error('IORedis Client Error:', err);
      });
      
      ioredisClient.on('connect', () => {
        console.log('IORedis client connected');
      });
      
      // Test connection
      await ioredisClient.ping();
    }
    return ioredisClient;
  } catch (error) {
    console.error('Failed to initialize IORedis client:', error);
    return null;
  }
};

export const getIORedisClient = (): Redis | null => {
  return ioredisClient;
};
