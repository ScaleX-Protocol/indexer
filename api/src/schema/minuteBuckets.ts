import { pgTable, text, integer, real, varchar, index } from 'drizzle-orm/pg-core';

export const minuteBuckets = pgTable(
  'minute_buckets',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    openTime: integer('open_time').notNull(),
    closeTime: integer('close_time').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
    quoteVolume: real('quote_volume').notNull(),
    count: integer('count').notNull(),
    takerBuyBaseVolume: real('taker_buy_base_volume').notNull(),
    takerBuyQuoteVolume: real('taker_buy_quote_volume').notNull(),
    average: real('average').notNull(),
    poolId: varchar('pool_id').notNull(),
  },
  (table) => ({
    openTimeIdx: index('minute_buckets_open_time_idx').on(table.openTime),
    poolIdx: index('minute_buckets_pool_idx').on(table.poolId),
    chainIdIdx: index('minute_buckets_chain_id_idx').on(table.chainId),
    poolOpenTimeIdx: index('minute_buckets_pool_open_time_idx').on(table.poolId, table.openTime),
    poolChainOpenTimeIdx: index('minute_buckets_pool_chain_open_time_idx').on(table.poolId, table.chainId, table.openTime),
    closeTimeIdx: index('minute_buckets_close_time_idx').on(table.closeTime),
  })
);

export const fiveMinuteBuckets = pgTable(
  'five_minute_buckets',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    openTime: integer('open_time').notNull(),
    closeTime: integer('close_time').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
    quoteVolume: real('quote_volume').notNull(),
    count: integer('count').notNull(),
    takerBuyBaseVolume: real('taker_buy_base_volume').notNull(),
    takerBuyQuoteVolume: real('taker_buy_quote_volume').notNull(),
    average: real('average').notNull(),
    poolId: varchar('pool_id').notNull(),
  },
  (table) => ({
    openTimeIdx: index('five_minute_buckets_open_time_idx').on(table.openTime),
    poolIdx: index('five_minute_buckets_pool_idx').on(table.poolId),
    chainIdIdx: index('five_minute_buckets_chain_id_idx').on(table.chainId),
    poolOpenTimeIdx: index('five_minute_buckets_pool_open_time_idx').on(table.poolId, table.openTime),
    poolChainOpenTimeIdx: index('five_minute_buckets_pool_chain_open_time_idx').on(table.poolId, table.chainId, table.openTime),
    closeTimeIdx: index('five_minute_buckets_close_time_idx').on(table.closeTime),
  })
);

export const thirtyMinuteBuckets = pgTable(
  'thirty_minute_buckets',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    openTime: integer('open_time').notNull(),
    closeTime: integer('close_time').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
    quoteVolume: real('quote_volume').notNull(),
    count: integer('count').notNull(),
    takerBuyBaseVolume: real('taker_buy_base_volume').notNull(),
    takerBuyQuoteVolume: real('taker_buy_quote_volume').notNull(),
    average: real('average').notNull(),
    poolId: varchar('pool_id').notNull(),
  },
  (table) => ({
    openTimeIdx: index('thirty_minute_buckets_open_time_idx').on(table.openTime),
    poolIdx: index('thirty_minute_buckets_pool_idx').on(table.poolId),
    chainIdIdx: index('thirty_minute_buckets_chain_id_idx').on(table.chainId),
    poolOpenTimeIdx: index('thirty_minute_buckets_pool_open_time_idx').on(table.poolId, table.openTime),
    poolChainOpenTimeIdx: index('thirty_minute_buckets_pool_chain_open_time_idx').on(table.poolId, table.chainId, table.openTime),
    closeTimeIdx: index('thirty_minute_buckets_close_time_idx').on(table.closeTime),
  })
);

export const hourBuckets = pgTable(
  'hour_buckets',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    openTime: integer('open_time').notNull(),
    closeTime: integer('close_time').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
    quoteVolume: real('quote_volume').notNull(),
    count: integer('count').notNull(),
    takerBuyBaseVolume: real('taker_buy_base_volume').notNull(),
    takerBuyQuoteVolume: real('taker_buy_quote_volume').notNull(),
    average: real('average').notNull(),
    poolId: varchar('pool_id').notNull(),
  },
  (table) => ({
    openTimeIdx: index('hour_buckets_open_time_idx').on(table.openTime),
    poolIdx: index('hour_buckets_pool_idx').on(table.poolId),
    chainIdIdx: index('hour_buckets_chain_id_idx').on(table.chainId),
    poolOpenTimeIdx: index('hour_buckets_pool_open_time_idx').on(table.poolId, table.openTime),
    poolChainOpenTimeIdx: index('hour_buckets_pool_chain_open_time_idx').on(table.poolId, table.chainId, table.openTime),
    closeTimeIdx: index('hour_buckets_close_time_idx').on(table.closeTime),
  })
);