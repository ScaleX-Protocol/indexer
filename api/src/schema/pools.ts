import { pgTable, varchar, integer, bigint, index } from 'drizzle-orm/pg-core';

export const pools = pgTable(
  'pools',
  {
    id: varchar('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    coin: varchar('coin'),
    orderBook: varchar('order_book'),
    baseCurrency: varchar('base_currency').notNull(),
    quoteCurrency: varchar('quote_currency').notNull(),
    baseDecimals: integer('base_decimals'),
    quoteDecimals: integer('quote_decimals'),
    volume: bigint('volume', { mode: 'bigint' }),
    volumeInQuote: bigint('volume_in_quote', { mode: 'bigint' }),
    price: bigint('price', { mode: 'bigint' }),
    timestamp: integer('timestamp'),
  },
  (table) => ({
    coinIdx: index('pools_coin_idx').on(table.coin),
    chainIdIdx: index('pools_chain_id_idx').on(table.chainId),
    orderBookIdx: index('pools_order_book_idx').on(table.orderBook),
  })
);