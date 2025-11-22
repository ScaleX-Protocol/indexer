import { pgTable, text, integer, bigint, numeric, real, boolean } from 'drizzle-orm/pg-core';

// Pool entity - aggregated pool data
export const pools = pgTable('Pool', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  poolId: text('poolId').notNull(),
  orderBook: text('orderBook').notNull(),
  baseCurrency: text('baseCurrency').notNull(),
  quoteCurrency: text('quoteCurrency').notNull(),
  baseDecimals: integer('baseDecimals'),
  quoteDecimals: integer('quoteDecimals'),
  volume: bigint('volume', { mode: 'bigint' }),
  volumeInQuote: bigint('volumeInQuote', { mode: 'bigint' }),
  price: bigint('price', { mode: 'bigint' }),
  timestamp: integer('timestamp'),
});

// Order entity - current order state
export const orders = pgTable('Order', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  poolId: text('poolId').notNull(),
  orderId: bigint('orderId', { mode: 'bigint' }).notNull(),
  transactionId: text('transactionId'),
  user: text('user'),
  side: text('side'),
  timestamp: integer('timestamp'),
  price: bigint('price', { mode: 'bigint' }),
  quantity: bigint('quantity', { mode: 'bigint' }),
  filled: bigint('filled', { mode: 'bigint' }),
  orderType: text('orderType'),
  status: text('status'),
  expiry: integer('expiry'),
});

// OrderHistory entity
export const orderHistory = pgTable('OrderHistory', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  poolId: text('poolId').notNull(),
  orderId: bigint('orderId', { mode: 'bigint' }).notNull(),
  transactionId: text('transactionId'),
  timestamp: integer('timestamp'),
  filled: bigint('filled', { mode: 'bigint' }),
  status: text('status'),
});

// OrderBookDepth entity - aggregated depth
export const orderBookDepth = pgTable('OrderBookDepth', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  poolId: text('poolId').notNull(),
  side: text('side').notNull(),
  price: bigint('price', { mode: 'bigint' }).notNull(),
  quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
  orderCount: integer('orderCount').notNull(),
  lastUpdated: integer('lastUpdated').notNull(),
});

// Trade entity
export const trades = pgTable('Trade', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  transactionId: text('transactionId'),
  poolId: text('poolId').notNull(),
  orderId: text('orderId').notNull(),
  price: bigint('price', { mode: 'bigint' }),
  quantity: bigint('quantity', { mode: 'bigint' }),
  timestamp: integer('timestamp'),
});

// OrderBookTrade entity - simplified trades
export const orderBookTrades = pgTable('OrderBookTrade', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  price: bigint('price', { mode: 'bigint' }),
  quantity: bigint('quantity', { mode: 'bigint' }),
  timestamp: integer('timestamp'),
  transactionId: text('transactionId'),
  side: text('side'),
  poolId: text('poolId').notNull(),
});

// Candlestick buckets
export const minuteBuckets = pgTable('MinuteBucket', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  openTime: integer('openTime').notNull(),
  closeTime: integer('closeTime').notNull(),
  openPrice: real('openPrice').notNull(),
  highPrice: real('highPrice').notNull(),
  lowPrice: real('lowPrice').notNull(),
  closePrice: real('closePrice').notNull(),
  volume: real('volume').notNull(),
  quoteVolume: real('quoteVolume').notNull(),
  count: integer('count').notNull(),
  takerBuyBaseVolume: real('takerBuyBaseVolume').notNull(),
  takerBuyQuoteVolume: real('takerBuyQuoteVolume').notNull(),
  average: real('average').notNull(),
  poolId: text('poolId').notNull(),
});

export const fiveMinuteBuckets = pgTable('FiveMinuteBucket', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  openTime: integer('openTime').notNull(),
  closeTime: integer('closeTime').notNull(),
  openPrice: real('openPrice').notNull(),
  highPrice: real('highPrice').notNull(),
  lowPrice: real('lowPrice').notNull(),
  closePrice: real('closePrice').notNull(),
  volume: real('volume').notNull(),
  quoteVolume: real('quoteVolume').notNull(),
  count: integer('count').notNull(),
  takerBuyBaseVolume: real('takerBuyBaseVolume').notNull(),
  takerBuyQuoteVolume: real('takerBuyQuoteVolume').notNull(),
  average: real('average').notNull(),
  poolId: text('poolId').notNull(),
});

export const thirtyMinuteBuckets = pgTable('ThirtyMinuteBucket', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  openTime: integer('openTime').notNull(),
  closeTime: integer('closeTime').notNull(),
  openPrice: real('openPrice').notNull(),
  highPrice: real('highPrice').notNull(),
  lowPrice: real('lowPrice').notNull(),
  closePrice: real('closePrice').notNull(),
  volume: real('volume').notNull(),
  quoteVolume: real('quoteVolume').notNull(),
  count: integer('count').notNull(),
  takerBuyBaseVolume: real('takerBuyBaseVolume').notNull(),
  takerBuyQuoteVolume: real('takerBuyQuoteVolume').notNull(),
  average: real('average').notNull(),
  poolId: text('poolId').notNull(),
});

export const hourBuckets = pgTable('HourBucket', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  openTime: integer('openTime').notNull(),
  closeTime: integer('closeTime').notNull(),
  openPrice: real('openPrice').notNull(),
  highPrice: real('highPrice').notNull(),
  lowPrice: real('lowPrice').notNull(),
  closePrice: real('closePrice').notNull(),
  volume: real('volume').notNull(),
  quoteVolume: real('quoteVolume').notNull(),
  count: integer('count').notNull(),
  takerBuyBaseVolume: real('takerBuyBaseVolume').notNull(),
  takerBuyQuoteVolume: real('takerBuyQuoteVolume').notNull(),
  average: real('average').notNull(),
  poolId: text('poolId').notNull(),
});

export const dailyBuckets = pgTable('DailyBucket', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  openTime: integer('openTime').notNull(),
  closeTime: integer('closeTime').notNull(),
  openPrice: real('openPrice').notNull(),
  highPrice: real('highPrice').notNull(),
  lowPrice: real('lowPrice').notNull(),
  closePrice: real('closePrice').notNull(),
  volume: real('volume').notNull(),
  quoteVolume: real('quoteVolume').notNull(),
  count: integer('count').notNull(),
  takerBuyBaseVolume: real('takerBuyBaseVolume').notNull(),
  takerBuyQuoteVolume: real('takerBuyQuoteVolume').notNull(),
  average: real('average').notNull(),
  poolId: text('poolId').notNull(),
});

// Balance entity
export const balances = pgTable('Balance', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  user: text('user'),
  currency: text('currency'),
  amount: bigint('amount', { mode: 'bigint' }),
  lockedAmount: bigint('lockedAmount', { mode: 'bigint' }),
  lastUpdated: integer('lastUpdated'),
});

// Currency entity
export const currencies = pgTable('Currency', {
  id: text('id').primaryKey(),
  chainId: integer('chainId').notNull(),
  address: text('address').notNull(),
  name: text('name'),
  symbol: text('symbol'),
  decimals: integer('decimals'),
  isActive: boolean('isActive'),
  registeredAt: integer('registeredAt'),
});
