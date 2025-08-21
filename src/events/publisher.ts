import { Redis } from 'ioredis';
import { 
  TradeEvent, 
  BalanceUpdateEvent, 
  OrderEvent, 
  DepthEvent, 
  KlineEvent, 
  ExecutionReportEvent,
  EventStreams 
} from './types.js';

export class EventPublisher {
  private redis: Redis;
  private isEnabled: boolean = true;

  constructor(redis: Redis) {
    this.redis = redis;
    this.isEnabled = process.env.ENABLE_EVENT_PUBLISHING !== 'false';
  }

  async publishTrade(trade: TradeEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping trade event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.TRADES, 'MAXLEN', '~', '1000', '*', 
        'symbol', trade.symbol,
        'price', trade.price,
        'quantity', trade.quantity,
        'timestamp', trade.timestamp,
        'userId', trade.userId,
        'side', trade.side,
        'tradeId', trade.tradeId,
        'orderId', trade.orderId,
        'makerOrderId', trade.makerOrderId
      );
      console.log(`[REDIS STREAM] Published trade event: ${trade.symbol} ${trade.side} ${trade.quantity}@${trade.price} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish trade event:', error);
    }
  }

  async publishBalanceUpdate(balance: BalanceUpdateEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping balance update event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.BALANCES, 'MAXLEN', '~', '1000', '*',
        'userId', balance.userId,
        'token', balance.token,
        'available', balance.available,
        'locked', balance.locked,
        'timestamp', balance.timestamp
      );
      console.log(`[REDIS STREAM] Published balance update: ${balance.userId} ${balance.token} available=${balance.available} locked=${balance.locked} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish balance update event:', error);
    }
  }

  async publishOrder(order: OrderEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping order event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.ORDERS, 'MAXLEN', '~', '1000', '*',
        'orderId', order.orderId,
        'userId', order.userId,
        'symbol', order.symbol,
        'side', order.side,
        'type', order.type,
        'price', order.price,
        'quantity', order.quantity,
        'filledQuantity', order.filledQuantity,
        'status', order.status,
        'timestamp', order.timestamp
      );
      console.log(`[REDIS STREAM] Published order event: ${order.symbol} ${order.side} ${order.status} ${order.orderId} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish order event:', error);
    }
  }

  async publishDepth(depth: DepthEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping depth event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.DEPTH, 'MAXLEN', '~', '500', '*',
        'symbol', depth.symbol,
        'bids', JSON.stringify(depth.bids),
        'asks', JSON.stringify(depth.asks),
        'timestamp', depth.timestamp
      );
      console.log(`[REDIS STREAM] Published depth event: ${depth.symbol} bids=${depth.bids.length} asks=${depth.asks.length} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish depth event:', error);
    }
  }

  async publishKline(kline: KlineEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping kline event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.KLINES, 'MAXLEN', '~', '1000', '*',
        'symbol', kline.symbol,
        'interval', kline.interval,
        'openTime', kline.openTime,
        'closeTime', kline.closeTime,
        'open', kline.open,
        'high', kline.high,
        'low', kline.low,
        'close', kline.close,
        'volume', kline.volume,
        'trades', kline.trades
      );
      console.log(`[REDIS STREAM] Published kline event: ${kline.symbol} ${kline.interval} close=${kline.close} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish kline event:', error);
    }
  }

  async publishExecutionReport(report: ExecutionReportEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Event publishing disabled - skipping execution report event');
      return;
    }

    try {
      const messageId = await this.redis.xadd(EventStreams.EXECUTION_REPORTS, 'MAXLEN', '~', '1000', '*',
        'orderId', report.orderId,
        'userId', report.userId,
        'symbol', report.symbol,
        'side', report.side,
        'type', report.type,
        'price', report.price,
        'quantity', report.quantity,
        'filledQuantity', report.filledQuantity,
        'status', report.status,
        'timestamp', report.timestamp,
        'executionType', report.executionType
      );
      console.log(`[REDIS STREAM] Published execution report: ${report.symbol} ${report.executionType} ${report.orderId} (ID: ${messageId})`);
    } catch (error) {
      console.error('Failed to publish execution report event:', error);
    }
  }

  async createConsumerGroups(): Promise<void> {
    const groups = [
      { stream: EventStreams.TRADES, groups: ['websocket-consumers', 'analytics-consumers'] },
      { stream: EventStreams.BALANCES, groups: ['websocket-consumers', 'analytics-consumers'] },
      { stream: EventStreams.ORDERS, groups: ['websocket-consumers', 'analytics-consumers'] },
      { stream: EventStreams.DEPTH, groups: ['websocket-consumers'] },
      { stream: EventStreams.KLINES, groups: ['websocket-consumers', 'analytics-consumers'] },
      { stream: EventStreams.EXECUTION_REPORTS, groups: ['websocket-consumers'] }
    ];

    for (const { stream, groups: consumerGroups } of groups) {
      try {
        // Only create consumer groups if stream exists
        const exists = await this.redis.exists(stream);
        if (!exists) {
          console.log(`Stream ${stream} does not exist, skipping consumer group creation`);
          continue;
        }

        for (const group of consumerGroups) {
          try {
            await this.redis.xgroup('CREATE', stream, group, '0');
            console.log(`Created consumer group ${group} for stream ${stream}`);
          } catch (error: any) {
            if (error.message.includes('BUSYGROUP')) {
              // Consumer group already exists
              console.log(`Consumer group ${group} already exists for stream ${stream}`);
            } else {
              console.error(`Failed to create consumer group ${group} for stream ${stream}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing stream ${stream}:`, error);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('Event publisher health check failed:', error);
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
}