import { Elysia, t } from 'elysia';
import { CurrencyController } from '../controllers';

export const currencyRoutes = new Elysia({ prefix: '/api', tags: ['Currency'] })
  .get('/currencies', CurrencyController.getAllCurrencies)
  .get('/currency', CurrencyController.getCurrency, {
    query: t.Object({
      address: t.String(),
    }),
  });
