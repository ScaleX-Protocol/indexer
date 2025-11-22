import { pgTable, text, numeric, boolean } from 'drizzle-orm/pg-core';

export const wbtcUsdcPoolOrderPlaced = pgTable('WBTCUSDCPool_OrderPlaced', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  user: text('user').notNull(),
  side: numeric('side').notNull(),
  price: numeric('price').notNull(),
  quantity: numeric('quantity').notNull(),
  status: numeric('status').notNull(),
  expiry: numeric('expiry').notNull(),
  isMarketOrder: boolean('isMarketOrder').notNull(),
});

export const wbtcUsdcPoolOrderMatched = pgTable('WBTCUSDCPool_OrderMatched', {
  id: text('id').primaryKey(),
  buyOrderId: numeric('buyOrderId').notNull(),
  sellOrderId: numeric('sellOrderId').notNull(),
  user: text('user').notNull(),
  side: numeric('side').notNull(),
  executionPrice: numeric('executionPrice').notNull(),
  executedQuantity: numeric('executedQuantity').notNull(),
  timestamp: numeric('timestamp').notNull(),
});

export const wbtcUsdcPoolOrderCancelled = pgTable('WBTCUSDCPool_OrderCancelled', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  user: text('user').notNull(),
  status: numeric('status').notNull(),
  timestamp: numeric('timestamp').notNull(),
});

export const wbtcUsdcPoolUpdateOrder = pgTable('WBTCUSDCPool_UpdateOrder', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  filled: numeric('filled').notNull(),
  status: numeric('status').notNull(),
  timestamp: numeric('timestamp').notNull(),
});
