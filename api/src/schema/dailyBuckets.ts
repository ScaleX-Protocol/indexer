import { pgTable, text, integer, real, varchar, index } from 'drizzle-orm/pg-core';

export const dailyBuckets = pgTable(
  'daily_buckets',
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
    openTimeIdx: index('daily_buckets_open_time_idx').on(table.openTime),
    poolIdx: index('daily_buckets_pool_idx').on(table.poolId),
    chainIdIdx: index('daily_buckets_chain_id_idx').on(table.chainId),
    poolOpenTimeIdx: index('daily_buckets_pool_open_time_idx').on(table.poolId, table.openTime),
    poolChainOpenTimeIdx: index('daily_buckets_pool_chain_open_time_idx').on(table.poolId, table.chainId, table.openTime),
    closeTimeIdx: index('daily_buckets_close_time_idx').on(table.closeTime),
  })
);