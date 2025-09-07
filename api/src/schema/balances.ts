import { pgTable, text, integer, bigint, varchar, index } from 'drizzle-orm/pg-core';

export const balances = pgTable(
  'balances',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    user: varchar('user').notNull(),
    currency: varchar('currency').notNull(),
    amount: bigint('amount', { mode: 'bigint' }),
    lockedAmount: bigint('locked_amount', { mode: 'bigint' }),
    timestamp: integer('timestamp'),
  },
  (table) => ({
    userIdx: index('balances_user_idx').on(table.user),
    userCurrencyIdx: index('balances_user_currency_idx').on(table.user, table.currency),
    chainIdIdx: index('balances_chain_id_idx').on(table.chainId),
    currencyIdx: index('balances_currency_idx').on(table.currency),
    userChainCurrencyIdx: index('balances_user_chain_currency_idx').on(table.user, table.chainId, table.currency),
    timestampIdx: index('balances_timestamp_idx').on(table.timestamp),
  })
);

export const currencies = pgTable(
  'currencies',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    address: varchar('address').notNull(),
    symbol: varchar('symbol'),
    name: varchar('name'),
    decimals: integer('decimals'),
    timestamp: integer('timestamp'),
  },
  (table) => ({
    addressChainIdx: index('currencies_address_chain_idx').on(table.address, table.chainId),
    symbolIdx: index('currencies_symbol_idx').on(table.symbol),
    chainIdIdx: index('currencies_chain_id_idx').on(table.chainId),
    addressIdx: index('currencies_address_idx').on(table.address),
  })
);