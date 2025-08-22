import { pgTable, text, integer, bigint, varchar, index } from 'drizzle-orm/pg-core';

export const orderBookDepth = pgTable(
  'order_book_depth',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    poolId: varchar('pool_id').notNull(),
    side: varchar('side').notNull(),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
    orderCount: integer('order_count').notNull(),
    lastUpdated: integer('last_updated').notNull(),
  },
  (table) => ({
    poolSideIdx: index('order_book_depth_pool_side_idx').on(table.poolId, table.side),
    poolPriceIdx: index('order_book_depth_pool_price_idx').on(table.poolId, table.price),
    chainIdIdx: index('order_book_depth_chain_id_idx').on(table.chainId),
    lastUpdatedIdx: index('order_book_depth_last_updated_idx').on(table.lastUpdated),
    poolChainSideIdx: index('order_book_depth_pool_chain_side_idx').on(table.poolId, table.chainId, table.side),
    poolChainSidePriceIdx: index('order_book_depth_pool_chain_side_price_idx').on(table.poolId, table.chainId, table.side, table.price),
    quantityIdx: index('order_book_depth_quantity_idx').on(table.quantity),
  })
);