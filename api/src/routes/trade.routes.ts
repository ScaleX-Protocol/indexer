import { Elysia } from 'elysia';
import { TradeController } from '../controllers';
import { TradeValidation } from '../validations/trade.validation';


export const tradeRoutes = new Elysia({ prefix: '/trades' })
    .get('/:symbol', TradeController.getInitData, {
        params: TradeValidation.params.symbol,
        query: TradeValidation.query.addressQuery
    })
    .get('/:symbol/orders', TradeController.getOpenOrders, {
        params: TradeValidation.params.symbol,
        query: TradeValidation.query.addressQuery
    })
    .get('/:symbol/price', TradeController.getTickerPrice, {
        params: TradeValidation.params.symbol
    })
    .get('/:symbol/ticker', TradeController.getTicker24Hr, {
        params: TradeValidation.params.symbol
    });