import { integer, pgTable, text, varchar, boolean } from 'drizzle-orm/pg-core';

export const currencies = pgTable('currencies', {
  id: text('id').primaryKey(),
  chainId: integer('chain_id').notNull(),
  address: text('address').notNull(),
  name: varchar('name'),
  symbol: varchar('symbol'),
  decimals: integer('decimals'),
  tokenType: varchar('token_type').default('underlying'),
  sourceChainId: integer('source_chain_id'),
  underlyingTokenAddress: text('underlying_token_address'),
  isActive: boolean('is_active').default(true),
  registeredAt: integer('registered_at'),
});

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;