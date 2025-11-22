import { pgTable, text, numeric } from 'drizzle-orm/pg-core';

export const oraclePriceUpdated = pgTable('Oracle_PriceUpdated', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  price: numeric('price').notNull(),
});

export const oracleTWAPCalculated = pgTable('Oracle_TWAPCalculated', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  twapPrice: numeric('twapPrice').notNull(),
  window: numeric('window').notNull(),
});
