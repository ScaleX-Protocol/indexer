import { pgTable, text, numeric, boolean, integer } from 'drizzle-orm/pg-core';

export const wethUsdcPoolOrderPlaced = pgTable('WETHUSDCPool_OrderPlaced', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  user: text('user').notNull(),
  side: numeric('side').notNull(), // 0=Buy, 1=Sell
  price: numeric('price').notNull(),
  quantity: numeric('quantity').notNull(),
  status: numeric('status').notNull(), // 0=Open, 1=Filled, 2=Cancelled, 3=PartiallyFilled
  expiry: numeric('expiry').notNull(),
  isMarketOrder: boolean('isMarketOrder').notNull(),
});

export const wethUsdcPoolOrderMatched = pgTable('WETHUSDCPool_OrderMatched', {
  id: text('id').primaryKey(),
  buyOrderId: numeric('buyOrderId').notNull(),
  sellOrderId: numeric('sellOrderId').notNull(),
  user: text('user').notNull(),
  side: numeric('side').notNull(),
  executionPrice: numeric('executionPrice').notNull(),
  executedQuantity: numeric('executedQuantity').notNull(),
  timestamp: numeric('timestamp').notNull(),
});

export const wethUsdcPoolOrderCancelled = pgTable('WETHUSDCPool_OrderCancelled', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  user: text('user').notNull(),
  status: numeric('status').notNull(),
  timestamp: numeric('timestamp').notNull(),
});

export const wethUsdcPoolUpdateOrder = pgTable('WETHUSDCPool_UpdateOrder', {
  id: text('id').primaryKey(),
  orderId: numeric('orderId').notNull(),
  filled: numeric('filled').notNull(),
  status: numeric('status').notNull(),
  timestamp: numeric('timestamp').notNull(),
});
