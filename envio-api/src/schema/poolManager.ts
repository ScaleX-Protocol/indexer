import { pgTable, text } from 'drizzle-orm/pg-core';

export const poolManagerPoolCreated = pgTable('PoolManager_PoolCreated', {
  id: text('id').primaryKey(),
  baseCurrency: text('baseCurrency').notNull(),
  quoteCurrency: text('quoteCurrency').notNull(),
  orderBook: text('orderBook').notNull(),
  poolId: text('poolId').notNull(),
});

export const poolManagerCurrencyAdded = pgTable('PoolManager_CurrencyAdded', {
  id: text('id').primaryKey(),
  currency: text('currency').notNull(),
});
