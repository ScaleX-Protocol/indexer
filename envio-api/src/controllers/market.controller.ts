import { Context } from 'elysia';
import { marketService } from '../services';
import { createSuccessResponse, createErrorResponse } from '../utils';
import { HttpStatus } from '../enums';

export class MarketController {
  static async getOpenOrders({ query, set }: Context) {
    try {
      const { symbol, address } = query as { symbol: string; address: string };

      if (!symbol || !address) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol and address are required');
      }

      const orders = await marketService.getOpenOrders(symbol, address);
      return createSuccessResponse(orders);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getAllOrders({ query, set }: Context) {
    try {
      const { symbol, address, limit } = query as {
        symbol?: string;
        address: string;
        limit?: string;
      };

      if (!address) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Address is required');
      }

      if (!symbol) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol is required');
      }

      const limitNum = limit ? parseInt(limit) : 50;
      const orders = await marketService.getAllOrders(symbol, address, limitNum);
      return createSuccessResponse(orders);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getTrades({ query, set }: Context) {
    try {
      const { symbol, limit, user } = query as {
        symbol: string;
        limit?: string;
        user?: string;
      };

      if (!symbol) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol is required');
      }

      const limitNum = limit ? parseInt(limit) : 100;
      const trades = await marketService.getTrades(symbol, limitNum, user);
      return createSuccessResponse(trades);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getDepth({ query, set }: Context) {
    try {
      const { symbol, limit } = query as { symbol: string; limit?: string };

      if (!symbol) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol is required');
      }

      const limitNum = limit ? parseInt(limit) : 20;
      const depth = await marketService.getDepth(symbol, limitNum);
      return createSuccessResponse(depth);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getPairs({ set }: Context) {
    try {
      const pairs = await marketService.getPairs();
      return createSuccessResponse(pairs);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getMarkets({ set }: Context) {
    try {
      const markets = await marketService.getPairs();
      return createSuccessResponse(markets);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getTickerPrice({ query, set }: Context) {
    try {
      const { symbol } = query as { symbol: string };

      if (!symbol) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol is required');
      }

      let ticker = await marketService.getTickerPrice(symbol);
      if(!ticker) ticker = { price: '0' };

      return createSuccessResponse(ticker);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getTicker24Hr({ query, set }: Context) {
    try {
      const { symbol } = query as { symbol: string };

      if (!symbol) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol is required');
      }

      const ticker = await marketService.getTicker24Hr(symbol);
      return createSuccessResponse(ticker);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getKlines({ query, set }: Context) {
    try {
      const { symbol, interval, limit, startTime, endTime } = query as {
        symbol: string;
        interval: string;
        limit?: string;
        startTime?: number;
        endTime?: number;
      };

      if (!symbol || !interval) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Symbol and interval are required');
      }

      const limitNum = limit ? parseInt(limit) : 500;
      const klines = await marketService.getKlines(symbol, interval, limitNum, startTime, endTime);
      return createSuccessResponse(klines);
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  static async getAccount({ query, set }: Context) {
    try {
      const { address } = query as { address: string };

      if (!address) {
        set.status = HttpStatus.BAD_REQUEST;
        return createErrorResponse('Address is required');
      }

      const balances = await marketService.getBalances(address);
      return createSuccessResponse({
        address,
        balances,
      });
    } catch (error) {
      set.status = HttpStatus.INTERNAL_SERVER_ERROR;
      return createErrorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
