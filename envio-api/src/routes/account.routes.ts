import { Elysia, t } from 'elysia';
import { MarketController } from '../controllers';

export const accountRoutes = new Elysia({ prefix: '/api', tags: ['Account'] })
  .get('/account', MarketController.getAccount, {
    query: t.Object({
      address: t.String(),
    }),
  });
