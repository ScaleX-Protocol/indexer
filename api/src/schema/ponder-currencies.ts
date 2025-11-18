import { integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

export const currencies = pgTable('currencies', {
  address: text('address').notNull().primaryKey(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  decimals: integer('decimals').notNull().default(18),
  chainId: integer('chain_id').notNull(),
});

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;