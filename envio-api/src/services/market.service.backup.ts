import { db } from '../config/database';
import {
  wethUsdcPoolOrderPlaced,
  wethUsdcPoolOrderMatched,
  wethUsdcPoolUpdateOrder,
  wbtcUsdcPoolOrderPlaced,
  wbtcUsdcPoolOrderMatched,
  wbtcUsdcPoolUpdateOrder,
  poolManagerPoolCreated
} from '../schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { OrderSide, OrderStatus } from '../enums';
import type { Order, Trade, Pool, OrderBookDepth, DepthLevel } from '../types';

export class MarketService {
  private getPoolTables(symbol: string) {
    const normalizedSymbol = symbol.toUpperCase();

    if (normalizedSymbol === 'WETHUSDC' || normalizedSymbol === 'WETH/USDC') {
      return {
        orderPlaced: wethUsdcPoolOrderPlaced,
        orderMatched: wethUsdcPoolOrderMatched,
        orderUpdate: wethUsdcPoolUpdateOrder,
      };
    } else if (normalizedSymbol === 'WBTCUSDC' || normalizedSymbol === 'WBTC/USDC') {
      return {
        orderPlaced: wbtcUsdcPoolOrderPlaced,
        orderMatched: wbtcUsdcPoolOrderMatched,
        orderUpdate: wbtcUsdcPoolUpdateOrder,
      };
    }

    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  private mapOrderStatus(status: string): string {
    const statusNum = parseInt(status);
    switch (statusNum) {
      case OrderStatus.OPEN: return 'open';
      case OrderStatus.FILLED: return 'filled';
      case OrderStatus.CANCELLED: return 'cancelled';
      case OrderStatus.PARTIALLY_FILLED: return 'partially_filled';
      default: return 'unknown';
    }
  }

  private mapOrderSide(side: string): string {
    const sideNum = parseInt(side);
    return sideNum === OrderSide.BUY ? 'buy' : 'sell';
  }

  async getOpenOrders(symbol: string, address: string): Promise<Order[]> {
    const tables = this.getPoolTables(symbol);

    const orders = await db
      .select()
      .from(tables.orderPlaced)
      .where(
        and(
          eq(tables.orderPlaced.user, address.toLowerCase()),
          eq(tables.orderPlaced.status, sql`${OrderStatus.OPEN}`)
        )
      )
      .orderBy(desc(tables.orderPlaced.id));

    return orders.map(order => ({
      id: order.id,
      orderId: order.orderId.toString(),
      user: order.user,
      side: this.mapOrderSide(order.side.toString()),
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      filled: '0',
      status: this.mapOrderStatus(order.status.toString()),
      expiry: order.expiry.toString(),
      isMarketOrder: order.isMarketOrder,
    }));
  }

  async getAllOrders(symbol: string, address: string, limit: number = 50): Promise<Order[]> {
    const tables = this.getPoolTables(symbol);

    const orders = await db
      .select()
      .from(tables.orderPlaced)
      .where(eq(tables.orderPlaced.user, address.toLowerCase()))
      .orderBy(desc(tables.orderPlaced.id))
      .limit(limit);

    return orders.map(order => ({
      id: order.id,
      orderId: order.orderId.toString(),
      user: order.user,
      side: this.mapOrderSide(order.side.toString()),
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      filled: '0',
      status: this.mapOrderStatus(order.status.toString()),
      expiry: order.expiry.toString(),
      isMarketOrder: order.isMarketOrder,
    }));
  }

  async getTrades(symbol: string, limit: number = 100, user?: string): Promise<Trade[]> {
    const tables = this.getPoolTables(symbol);

    let query = db
      .select()
      .from(tables.orderMatched);

    if (user) {
      query = query.where(eq(tables.orderMatched.user, user.toLowerCase())) as any;
    }

    const trades = await query
      .orderBy(desc(tables.orderMatched.timestamp))
      .limit(limit);

    return trades.map(trade => ({
      id: trade.id,
      buyOrderId: trade.buyOrderId.toString(),
      sellOrderId: trade.sellOrderId.toString(),
      user: trade.user,
      side: this.mapOrderSide(trade.side.toString()),
      price: trade.executionPrice.toString(),
      quantity: trade.executedQuantity.toString(),
      timestamp: trade.timestamp.toString(),
    }));
  }

  async getDepth(symbol: string, limit: number = 20): Promise<OrderBookDepth> {
    const tables = this.getPoolTables(symbol);

    // Get open buy orders (bids)
    const buyOrders = await db
      .select()
      .from(tables.orderPlaced)
      .where(
        and(
          eq(tables.orderPlaced.side, sql`${OrderSide.BUY}`),
          eq(tables.orderPlaced.status, sql`${OrderStatus.OPEN}`)
        )
      )
      .orderBy(desc(tables.orderPlaced.price))
      .limit(limit);

    // Get open sell orders (asks)
    const sellOrders = await db
      .select()
      .from(tables.orderPlaced)
      .where(
        and(
          eq(tables.orderPlaced.side, sql`${OrderSide.SELL}`),
          eq(tables.orderPlaced.status, sql`${OrderStatus.OPEN}`)
        )
      )
      .orderBy(tables.orderPlaced.price)
      .limit(limit);

    // Aggregate by price level
    const bids: Map<string, bigint> = new Map();
    const asks: Map<string, bigint> = new Map();

    buyOrders.forEach(order => {
      const price = order.price.toString();
      const qty = BigInt(order.quantity.toString());
      bids.set(price, (bids.get(price) || 0n) + qty);
    });

    sellOrders.forEach(order => {
      const price = order.price.toString();
      const qty = BigInt(order.quantity.toString());
      asks.set(price, (asks.get(price) || 0n) + qty);
    });

    return {
      bids: Array.from(bids.entries()).map(([price, quantity]) => ({
        price,
        quantity: quantity.toString(),
      })),
      asks: Array.from(asks.entries()).map(([price, quantity]) => ({
        price,
        quantity: quantity.toString(),
      })),
    };
  }

  async getPairs(): Promise<Pool[]> {
    const pools = await db
      .select()
      .from(poolManagerPoolCreated);

    return pools.map(pool => ({
      id: pool.id,
      poolId: pool.poolId,
      baseCurrency: pool.baseCurrency,
      quoteCurrency: pool.quoteCurrency,
      orderBook: pool.orderBook,
    }));
  }

  async getTickerPrice(symbol: string): Promise<{ price: string } | null> {
    const tables = this.getPoolTables(symbol);

    const latestTrade = await db
      .select()
      .from(tables.orderMatched)
      .orderBy(desc(tables.orderMatched.timestamp))
      .limit(1);

    if (latestTrade.length === 0) {
      return null;
    }

    return {
      price: latestTrade[0].executionPrice.toString(),
    };
  }

  async getTicker24Hr(symbol: string): Promise<any> {
    const tables = this.getPoolTables(symbol);

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    const trades = await db
      .select()
      .from(tables.orderMatched)
      .where(sql`${tables.orderMatched.timestamp} >= ${oneDayAgo}`)
      .orderBy(tables.orderMatched.timestamp);

    if (trades.length === 0) {
      return {
        symbol,
        priceChange: '0',
        priceChangePercent: '0',
        lastPrice: '0',
        volume: '0',
        quoteVolume: '0',
        openPrice: '0',
        highPrice: '0',
        lowPrice: '0',
        count: 0,
      };
    }

    const prices = trades.map(t => BigInt(t.executionPrice.toString()));
    const volumes = trades.map(t => BigInt(t.executedQuantity.toString()));

    const lastPrice = prices[prices.length - 1];
    const openPrice = prices[0];
    const highPrice = prices.reduce((a, b) => a > b ? a : b);
    const lowPrice = prices.reduce((a, b) => a < b ? a : b);
    const volume = volumes.reduce((a, b) => a + b, 0n);

    const priceChange = lastPrice - openPrice;
    const priceChangePercent = openPrice > 0n
      ? Number((priceChange * 10000n) / openPrice) / 100
      : 0;

    return {
      symbol,
      priceChange: priceChange.toString(),
      priceChangePercent: priceChangePercent.toFixed(2),
      lastPrice: lastPrice.toString(),
      volume: volume.toString(),
      quoteVolume: (volume * lastPrice).toString(),
      openPrice: openPrice.toString(),
      highPrice: highPrice.toString(),
      lowPrice: lowPrice.toString(),
      count: trades.length,
    };
  }
}

export const marketService = new MarketService();
