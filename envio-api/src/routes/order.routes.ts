import { Elysia, t } from 'elysia';
import { MarketController } from '../controllers';

export const orderRoutes = new Elysia({ prefix: '/api', tags: ['Orders'] })
  .get('/allOrders', MarketController.getAllOrders, {
    query: t.Object({
      symbol: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      address: t.String(),
    }),
  })
  .get('/openOrders', MarketController.getOpenOrders, {
    query: t.Object({
      symbol: t.Optional(t.String()),
      address: t.String(),
    }),
  });
