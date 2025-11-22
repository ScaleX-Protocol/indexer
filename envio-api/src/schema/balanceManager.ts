import { pgTable, text, numeric } from 'drizzle-orm/pg-core';

export const balanceManagerDeposit = pgTable('BalanceManager_Deposit', {
  id: text('id').primaryKey(),
  user: text('user').notNull(),
  amount: numeric('amount').notNull(),
  event_id: numeric('event_id').notNull(),
});

export const balanceManagerWithdrawal = pgTable('BalanceManager_Withdrawal', {
  id: text('id').primaryKey(),
  user: text('user').notNull(),
  amount: numeric('amount').notNull(),
  event_id: numeric('event_id').notNull(),
});

export const balanceManagerLock = pgTable('BalanceManager_Lock', {
  id: text('id').primaryKey(),
  user: text('user').notNull(),
  amount: numeric('amount').notNull(),
  event_id: numeric('event_id').notNull(),
});

export const balanceManagerUnlock = pgTable('BalanceManager_Unlock', {
  id: text('id').primaryKey(),
  user: text('user').notNull(),
  amount: numeric('amount').notNull(),
  event_id: numeric('event_id').notNull(),
});

export const balanceManagerTransferFrom = pgTable('BalanceManager_TransferFrom', {
  id: text('id').primaryKey(),
  sender: text('sender').notNull(),
  receiver: text('receiver').notNull(),
  operator: text('operator').notNull(),
  amount: numeric('amount').notNull(),
  feeAmount: numeric('feeAmount').notNull(),
  event_id: numeric('event_id').notNull(),
});
