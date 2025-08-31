#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const { createPublicClient, http } = require("viem");
const { mainnet, sepolia, goerli, arbitrum, optimism, polygon, base } = require("viem/chains");
const { createClient } = require('redis');

// Custom RISE testnet chain definition
const rise = {
  id: parseInt(process.env.CHAIN_ID || '11155931'),
  name: 'RISE Testnet',
  network: 'rise',
  nativeCurrency: {
    decimals: 18,
    name: 'RISE',
    symbol: 'RISE',
  },
  rpcUrls: {
    default: {
      http: [process.env.PONDER_RPC_URL || 'https://indexing.testnet.riselabs.xyz'],
    },
    public: {
      http: [process.env.PONDER_RPC_URL || 'https://indexing.testnet.riselabs.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'RISE Explorer',
      url: process.env.BLOCK_EXPLORER_URL || 'https://testnet-explorer.risechain.net',
    },
  },
  testnet: true,
};

const anvil = {
  id: parseInt(process.env.CHAIN_ID || '31337'),
  name: 'Anvil',
  network: 'anvil',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://localhost:8545'],
    },
    public: {
      http: ['http://localhost:8545'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Anvil',
      url: 'http://localhost:8545',
    },
  },
  testnet: true,
};

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL || '2147483647');

let redisClient = null;

// Safe JSON stringify function to handle BigInt
const safeStringify = (obj, space) => {
  return JSON.stringify(obj, (_, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, space);
};

// JSON replacer for BigInt handling
const jsonReplacer = (key, value) => {
  if (typeof value === 'bigint') {
    return {
      __type: 'bigint',
      value: value.toString()
    };
  }
  return value;
};

// Initialize Redis client
const initRedisClient = async () => {
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

// Set cached data function
const setCachedData = async (key, data, ttl = REDIS_CACHE_TTL, blockNumber, callerFunction) => {
  try {
    console.log(`${blockNumber}:${callerFunction} Starting cache operation: ${safeStringify({
      key,
      ttl,
      dataType: typeof data,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : undefined
    })}`);
    
    const client = await initRedisClient();
    if (!client) {
      console.log(`${blockNumber}:${callerFunction} Redis client not available, skipping cache operation for key: ${key}`);
      return;
    }
    
    const serializedData = JSON.stringify(data, jsonReplacer);
    console.log(`${blockNumber}:${callerFunction} Data serialized successfully: ${safeStringify({
      key,
      serializedLength: serializedData.length,
      containsBigInt: serializedData.includes('__type":"bigint"')
    })}`);
    
    await client.set(key, serializedData, { EX: ttl });
    console.log(`${blockNumber}:${callerFunction} Cache set successfully: ${safeStringify({
      key,
      ttl,
      success: true
    })}`);
  } catch (error) {
    console.error(`${blockNumber}:${callerFunction} Error setting cached data: ${safeStringify({
      key,
      ttl,
      error: error.message,
      stack: error.stack
    })}`);
    console.error(`Error setting cached data for key ${key}:`, error);
  }
};

// Get current block number function
async function getCurrentBlockNumber() {
  try {
    const networkName = (process.env.NETWORK || 'mainnet').toLowerCase();

    const chainMap = {
      'rise': rise,
      'mainnet': mainnet,
      'sepolia': sepolia,
      'goerli': goerli,
      'arbitrumsepolia': arbitrum,
      'optimism': optimism,
      'polygon': polygon,
      'base': base,
      'anvil': anvil
    };

    const chain = chainMap[networkName] || mainnet;
    console.log(`Using ${networkName} network`);
    console.log(`Chain ID: ${chain.id}`);
    console.log(`RPC URL: ${chain.rpcUrls.default.http[0]}`);

    const client = createPublicClient({
      chain,
      transport: http()
    });

    const blockNumber = await client.getBlockNumber();
    console.log(`Current block number: ${blockNumber}`);

    return Number(blockNumber);
  } catch (error) {
    console.error('Error getting current block number:', error);
    return 0;
  }
}

// Main function - equivalent to the selected function
async function setWebSocketEnableBlockNumber() {
  try {
    const enableWebSocketBlockNumberStr = process.env.ENABLE_WEBSOCKET_BLOCK_NUMBER;
    let blockNumber;

    if (enableWebSocketBlockNumberStr) {
      blockNumber = parseInt(enableWebSocketBlockNumberStr);
      console.log(`Using WebSocket enable block number from env: ${blockNumber}`);
    } else {
      blockNumber = await getCurrentBlockNumber();
      console.log(`Using current block number for WebSocket enable: ${blockNumber}`);
    }

    if (blockNumber > 0) {
      await setCachedData('websocket:enable:block', blockNumber, REDIS_CACHE_TTL, blockNumber, 'setWebSocketEnableBlockNumber');
      console.log(`WebSocket enable block number set to ${blockNumber}`);
    }
  } catch (error) {
    console.error('Error setting WebSocket enable block number:', error);
  }
}

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  if (redisClient) {
    await redisClient.quit();
    console.log('Redis connection closed');
  }
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Run the main function if this script is executed directly
if (require.main === module) {
  setWebSocketEnableBlockNumber()
    .then(() => {
      console.log('WebSocket enable block number set successfully');
      gracefulShutdown();
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { setWebSocketEnableBlockNumber, getCurrentBlockNumber, setCachedData };
