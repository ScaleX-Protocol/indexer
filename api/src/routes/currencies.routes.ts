import { Elysia } from 'elysia';
import { getAllCurrencies, getCurrencyByAddress } from '../controllers/currencies.controller';

const currenciesRoutes = new Elysia({ prefix: '/api/currencies' })
  .get('/', getAllCurrencies)
  .get('/:address', getCurrencyByAddress);

export { currenciesRoutes };