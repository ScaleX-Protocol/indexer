import { Context } from 'elysia';
import { TradeService } from '../services/trade.service';
import { createErrorResponse, createSuccessResponse } from '../utils/response.utils';
import { HttpStatus } from '../enums';

export class TradeController {
    static async getInitData(ctx: Context) {
        try {
            const { symbol } = ctx.params;
            const decodedSymbol = decodeURIComponent(symbol);
            const address = String(ctx.query.address).toLowerCase() as `0x${string}`;
            const response = await TradeService.getInitData(decodedSymbol, address);
            return createSuccessResponse(response);
        } catch (error) {
            console.error('Error in getInitData:', error);
            return createErrorResponse('Failed to retrieve trades init data', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    static async getOpenOrders(ctx: Context) {
        try {
            const { symbol } = ctx.params;
            const decodedSymbol = decodeURIComponent(symbol);
            const address = String(ctx.query.address).toLowerCase() as `0x${string}`;
            const response = await TradeService.getOpenOrders({ symbol: decodedSymbol, address });
            return createSuccessResponse(response);
        } catch (error) {
            console.error('Error in getOpenOrders:', error);
            return createErrorResponse('Failed to retrieve open orders', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    static async getTickerPrice(ctx: Context) {
        try {
            const { symbol } = ctx.params;
            const decodedSymbol = decodeURIComponent(symbol);
            const response = await TradeService.getTickerPrice({ symbol: decodedSymbol });
            return createSuccessResponse(response);
        } catch (error) {
            console.error('Error in getTickerPrice:', error);
            return createErrorResponse('Failed to retrieve ticker price', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    static async getTicker24Hr(ctx: Context) {
        try {
            const { symbol } = ctx.params;
            const decodedSymbol = decodeURIComponent(symbol);
            const response = await TradeService.getTicker24Hr({ symbol: decodedSymbol });
            return createSuccessResponse(response);
        } catch (error) {
            console.error('Error in getTicker24Hr:', error);
            return createErrorResponse('Failed to retrieve ticker 24hr', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}