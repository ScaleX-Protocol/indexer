import { Redis } from 'ioredis';
import { DatabaseClient } from './shared/database';
import { TradeEventData, BalanceUpdateEventData, OrderEventData } from './shared/types';

export class AnalyticsEventConsumer {
  private redis: Redis;
  private db: DatabaseClient;
  private consumerGroup: string;
  private consumerId: string;
  private isRunning: boolean = false;
  private streams: string[] = ['trades', 'balances', 'orders'];

  constructor(redis: Redis, db: DatabaseClient) {
    this.redis = redis;
    this.db = db;
    this.consumerGroup = 'analytics-consumers';
    this.consumerId = `analytics-consumer-${Date.now()}`;
  }

  async initialize() {
    console.log('Initializing analytics event consumer...');
    
    // Create consumer groups for streams we care about
    for (const stream of this.streams) {
      try {
        await this.redis.xgroup('CREATE', stream, this.consumerGroup, '0', 'MKSTREAM');
        console.log(`Created consumer group ${this.consumerGroup} for stream ${stream}`);
      } catch (error: any) {
        if (error.message.includes('BUSYGROUP')) {
          console.log(`Consumer group ${this.consumerGroup} already exists for stream ${stream}`);
        } else {
          console.error(`Failed to create consumer group for stream ${stream}:`, error);
        }
      }
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('Analytics event consumer is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting analytics event consumer with ID: ${this.consumerId}`);

    const streamArgs = this.streams.flatMap(stream => [stream, '>']);
    
    while (this.isRunning) {
      try {
        const batchSize = parseInt(process.env.ANALYTICS_BATCH_SIZE || '5');
        const pollInterval = parseInt(process.env.ANALYTICS_POLL_INTERVAL || '5000');

        const messages = await this.redis.xreadgroup(
          'GROUP', this.consumerGroup, this.consumerId,
          'COUNT', batchSize,
          'BLOCK', pollInterval,
          'STREAMS', ...streamArgs
        );

        if (messages && messages.length > 0) {
          await this.processMessages(messages);
        }
      } catch (error) {
        console.error('Error reading from streams:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s before retry
      }
    }
  }

  private async processMessages(messages: any[]) {
    for (const [stream, entries] of messages) {
      for (const [id, fields] of entries) {
        try {
          const eventData = this.parseEventData(fields);
          await this.handleEvent(stream, eventData);
          
          // Acknowledge the message
          await this.redis.xack(stream, this.consumerGroup, id);
        } catch (error) {
          console.error(`Error processing analytics message ${id} from stream ${stream}:`, error);
          // Could implement retry logic or dead letter queue here
        }
      }
    }
  }

  private parseEventData(fields: string[]): { [key: string]: string } {
    const data: { [key: string]: string } = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }
    return data;
  }

  private async handleEvent(stream: string, data: { [key: string]: string }) {
    switch (stream) {
      case 'trades':
        await this.handleTradeEvent(data as any);
        break;
      case 'balances':
        await this.handleBalanceUpdateEvent(data as any);
        break;
      case 'orders':
        await this.handleOrderEvent(data as any);
        break;
      default:
        console.warn(`Unknown stream for analytics: ${stream}`);
    }
  }

  private async handleTradeEvent(data: TradeEventData) {
    try {
      // Analytics processing for trades
      console.log(`Processing trade analytics: ${data.symbol} - ${data.quantity} @ ${data.price}`);
      
      // TODO: Implement real-time analytics calculations
      // - Update volume metrics
      // - Calculate price movements
      // - Update user trading statistics
      // - Detect unusual trading patterns
      
      // Example: Store aggregated metrics in cache for fast retrieval
      const cacheKey = `trade_metrics:${data.symbol}:${Math.floor(Date.now() / 3600000)}`; // hourly
      
      // This is a simplified example - in practice you'd want more sophisticated aggregation
      await this.redis.hincrby(cacheKey, 'volume', Math.floor(parseFloat(data.quantity) * parseFloat(data.price)));
      await this.redis.hincrby(cacheKey, 'trades', 1);
      await this.redis.expire(cacheKey, 86400 * 7); // 7 days TTL

      // Could also update user statistics in database
      // await this.db.updateUserTradingStats(data.userId, data);

    } catch (error) {
      console.error('Error processing trade event for analytics:', error);
    }
  }

  private async handleBalanceUpdateEvent(data: BalanceUpdateEventData) {
    try {
      // Analytics processing for balance updates
      console.log(`Processing balance analytics: ${data.userId} - ${data.token}`);
      
      // TODO: Implement portfolio tracking
      // - Track portfolio value changes
      // - Calculate portfolio performance metrics
      // - Store portfolio snapshots for historical analysis
      
    } catch (error) {
      console.error('Error processing balance event for analytics:', error);
    }
  }

  private async handleOrderEvent(data: OrderEventData) {
    try {
      // Analytics processing for orders
      console.log(`Processing order analytics: ${data.symbol} - ${data.status}`);
      
      // TODO: Implement order analytics
      // - Track order flow
      // - Calculate order book metrics
      // - Analyze trading patterns
      
    } catch (error) {
      console.error('Error processing order event for analytics:', error);
    }
  }

  async stop() {
    console.log('Stopping analytics event consumer...');
    this.isRunning = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('Analytics event consumer health check failed:', error);
      return false;
    }
  }
}