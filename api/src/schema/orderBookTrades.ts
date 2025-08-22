import { pgTable, text, integer, bigint, varchar, index } from 'drizzle-orm/pg-core';

export const orderBookTrades = pgTable(
  'order_book_trades',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    price: bigint('price', { mode: 'bigint' }),
    quantity: bigint('quantity', { mode: 'bigint' }),
    timestamp: integer('timestamp'),
    transactionId: text('transaction_id'),
    side: varchar('side'),
    poolId: varchar('pool_id').notNull(),
  },
  (table) => ({
    transactionIdx: index('order_book_trades_transaction_idx').on(table.transactionId),
    poolIdx: index('order_book_trades_pool_idx').on(table.poolId),
    chainIdIdx: index('order_book_trades_chain_id_idx').on(table.chainId),
    poolChainTimestampIdx: index('order_book_trades_pool_chain_timestamp_idx').on(table.poolId, table.chainId, table.timestamp),
    sideIdx: index('order_book_trades_side_idx').on(table.side),
    timestampIdx: index('order_book_trades_timestamp_idx').on(table.timestamp),
  })
);