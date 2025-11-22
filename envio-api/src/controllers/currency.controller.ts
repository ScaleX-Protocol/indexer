import { Context } from 'elysia';
import { currencyService } from '../services';
import { createSuccessResponse, createErrorResponse } from '../utils';
import { HttpStatus } from '../enums';

export class CurrencyController {
  static async getAllCurrencies({ set }: Context) {
    try {
      const currencies = await currencyService.getAllCurrencies();
      return createSuccessResponse(currencies);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getCurrency({ query, set }: Context) {
    try {
      const { address } = query as { address: string };

      if (!address) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Address is required');
      }

      const currency = await currencyService.getCurrency(address);

      if (!currency) {
        set.status = HttpStatus.NOT_FOUND;
        return createErrorResponse('Currency not found');
      }

      return createSuccessResponse(currency);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
