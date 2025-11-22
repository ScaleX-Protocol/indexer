import { Elysia, t } from 'elysia';
import { MarketController } from '../controllers';

export const tradeRoutes = new Elysia({ prefix: '/api', tags: ['Trading'] })
  .get('/trades', MarketController.getTrades, {
    query: t.Object({
      symbol: t.String(),
      limit: t.Optional(t.String()),
      user: t.Optional(t.String()),
    }),
  });
