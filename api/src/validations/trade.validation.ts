import { t } from 'elysia';

export const TradeValidation = {
  params: {
    symbol: t.Object({
      symbol: t.String({
        minLength: 1,
        pattern: '^[A-Za-z0-9/]+$',
        description: 'Trading symbol'
      })
    })
  },
  query: {
    addressQuery: t.Object({
      address: t.String({
        minLength: 42,
        maxLength: 42,
        pattern: '^0x[a-fA-F0-9]{40}$',
        description: 'Ethereum address'
      })
    })
  }
};