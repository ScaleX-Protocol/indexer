import { Elysia, t } from 'elysia';
import { MarketController } from '../controllers';

export const marketDataRoutes = new Elysia({ prefix: '/api', tags: ['Market'] })
  .get('/depth', MarketController.getDepth, {
    query: t.Object({
      symbol: t.String(),
      limit: t.Optional(t.String()),
    }),
  })
  .get('/ticker/24hr', MarketController.getTicker24Hr, {
    query: t.Object({
      symbol: t.String(),
    }),
  })
  .get('/ticker/price', MarketController.getTickerPrice, {
    query: t.Object({
      symbol: t.String(),
    }),
  })
  .get('/klines', MarketController.getKlines, {
    query: t.Object({
      symbol: t.String(),
      interval: t.String(),
      limit: t.Optional(t.String()),
      startTime: t.Optional(t.Number()),
      endTime: t.Optional(t.Number()),
    }),
  })
  .get('/pairs', MarketController.getPairs)
  .get('/markets', MarketController.getMarkets);
