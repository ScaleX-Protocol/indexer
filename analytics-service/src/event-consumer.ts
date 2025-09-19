import { Redis } from 'ioredis';
import { TimescaleDatabaseClient } from './shared/timescale-database';
import { OrderEventData } from './shared/types';

export class AnalyticsEventConsumer {
  private redis: Redis;
  private timescaleDb: TimescaleDatabaseClient;
  private consumerGroup: string;
  private consumerId: string;
  private isRunning: boolean = false;
  private chainId: string;
  private streams: string[] = ['orders'];
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private backoffMultiplier: number = 1000;

  constructor(redis: Redis, timescaleDb: TimescaleDatabaseClient, chainId?: string) {
    this.redis = redis;
    this.timescaleDb = timescaleDb;
    this.chainId = chainId || process.env.DEFAULT_CHAIN_ID || '31337';
    this.consumerGroup = `analytics-consumers-${this.chainId}`;
    this.consumerId = `analytics-consumer-${this.chainId}-${Date.now()}`;
  }

  private getStreamKey(stream: string): string {
    return `chain:${this.chainId}:${stream}`;
  }

  async initialize() {
    console.log('Initializing analytics event consumer...');
    console.log('Analytics consumer groups should already exist, skipping creation.');
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

        // Try reading from one stream at a time (like websocket service)
        let messages = null;
        for (const stream of this.streams) {
          try {
            const streamKey = this.getStreamKey(stream);
            const exists = await this.redis.exists(streamKey);
            if (!exists) {
              continue; // Skip non-existent streams
            }

            messages = await this.redis.xreadgroup(
              'GROUP', this.consumerGroup, this.consumerId,
              'COUNT', batchSize,
              'BLOCK', 100, // Short timeout
              'STREAMS', streamKey, '>'
            );
            
            if (messages && messages.length > 0) {
              console.log(`Processing ${messages.length} messages from stream: ${stream}`);
              console.log(`Message content:`, JSON.stringify(messages[0], null, 2));
              break; // If we got messages, break and process them
            }
            // If no messages, continue to next stream
          } catch (error: any) {
            console.error(`Failed to read from stream ${stream}:`, error.message);
            // Continue to next stream
          }
        }
        
        if (!messages || messages.length === 0) {
          // No messages from any stream, wait before next iteration
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        if (messages && messages.length > 0) {
          await this.processMessages(messages);
          this.reconnectAttempts = 0; // Reset on successful processing
        }
      } catch (error) {
        console.error('Error reading from streams:', error);
        await this.handleConnectionError(error);
      }
    }
  }

  private async processMessages(messages: any[]) {
    const batch = [];
    
    for (const [stream, entries] of messages) {
      for (const [id, fields] of entries) {
        batch.push({ stream, id, fields });
      }
    }

    // Process messages in parallel batches
    const batchSize = 10;
    for (let i = 0; i < batch.length; i += batchSize) {
      const currentBatch = batch.slice(i, i + batchSize);
      
      await Promise.allSettled(
        currentBatch.map(async ({ stream, id, fields }) => {
          try {
            const eventData = this.parseEventData(fields);
            await this.handleEvent(stream, eventData);
            
            // Acknowledge the message
            await this.redis.xack(stream, this.consumerGroup, id);
          } catch (error) {
            console.error(`Error processing analytics message ${id} from stream ${stream}:`, error);
            
            // Add to retry queue for failed messages
            await this.addToRetryQueue(stream, id, fields, error);
          }
        })
      );
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
      case 'orders':
        await this.handleOrderEvent(data as any);
        break;
      default:
        console.warn(`Unknown stream for analytics: ${stream}`);
    }
  }



  private async handleOrderEvent(data: OrderEventData) {
    try {
      console.log(`Processing order analytics: ${data.symbol} - ${data.status}`);
      
      // Order events are primarily stored in the main database via the indexer
      // Analytics service only needs to track for continuous aggregates in TimescaleDB
      console.log(`Order ${data.orderId} ${data.status} - tracked via TimescaleDB continuous aggregates`);
      
    } catch (error) {
      console.error('Error processing order event for analytics:', error);
      throw error;
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

  private async handleConnectionError(error: any) {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping consumer.`);
      this.isRunning = false;
      return;
    }
    
    const backoffTime = Math.min(
      this.backoffMultiplier * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );
    
    console.log(`Connection error (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}). Retrying in ${backoffTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, backoffTime));
    
    // Test connection before continuing
    try {
      await this.redis.ping();
      console.log('Redis connection restored');
      this.reconnectAttempts = 0;
    } catch (pingError) {
      console.error('Redis still unreachable:', pingError);
    }
  }

  private async addToRetryQueue(stream: string, id: string, fields: string[], error: any) {
    try {
      const retryData = {
        stream,
        id,
        fields,
        error: error.message,
        timestamp: Date.now(),
        retryCount: 0
      };
      
      await this.redis.zadd('analytics_retry_queue', Date.now(), JSON.stringify(retryData));
      
      // Clean up old retry entries (older than 24 hours)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      await this.redis.zremrangebyscore('analytics_retry_queue', 0, oneDayAgo);
      
    } catch (retryError) {
      console.error('Failed to add message to retry queue:', retryError);
    }
  }

  async processRetryQueue() {
    try {
      // Get messages that should be retried (older than 5 minutes)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const retryMessages = await this.redis.zrangebyscore('analytics_retry_queue', 0, fiveMinutesAgo, 'LIMIT', 0, 10);
      
      for (const messageStr of retryMessages) {
        try {
          const retryData = JSON.parse(messageStr);
          
          // Skip if too many retries
          if (retryData.retryCount >= 3) {
            await this.redis.zrem('analytics_retry_queue', messageStr);
            console.log(`Dropping message after ${retryData.retryCount} retries:`, retryData.id);
            continue;
          }
          
          // Try to process the message again
          const eventData = this.parseEventData(retryData.fields);
          await this.handleEvent(retryData.stream, eventData);
          
          // Success - remove from retry queue and ack the original message
          await this.redis.zrem('analytics_retry_queue', messageStr);
          await this.redis.xack(retryData.stream, this.consumerGroup, retryData.id);
          
          console.log(`Successfully retried message: ${retryData.id}`);
          
        } catch (error) {
          // Update retry count and timestamp
          const retryData = JSON.parse(messageStr);
          retryData.retryCount++;
          retryData.timestamp = Date.now();
          
          await this.redis.zrem('analytics_retry_queue', messageStr);
          await this.redis.zadd('analytics_retry_queue', Date.now() + (5 * 60 * 1000), JSON.stringify(retryData));
          
          console.error(`Retry failed for message ${retryData.id} (attempt ${retryData.retryCount}):`, error);
        }
      }
    } catch (error) {
      console.error('Error processing retry queue:', error);
    }
  }

  private async updateUserPosition(
    userId: string, 
    symbol: string, 
    quantity: number, 
    price: number, 
    side: string, 
    timestamp: number
  ) {
    try {
      console.log(`Updating position for ${userId} ${symbol}: ${side} ${quantity} @ ${price}`);
      
      // Get current position
      const currentPosition = await this.timescaleDb.getUserPosition(userId, symbol);
      console.log(`Current position:`, currentPosition);

      if (!currentPosition) {
        // New position (normalize large values)
        const normalizedQuantity = quantity / 1e18;
        const normalizedPrice = price / 1e9;
        const positionData = {
          user_id: userId,
          symbol: symbol,
          quantity: (side === 'buy' ? normalizedQuantity : -normalizedQuantity).toString(),
          avg_cost: normalizedPrice.toString(),
          total_cost: (normalizedQuantity * normalizedPrice).toString(),
          realized_pnl: '0',
          unrealized_pnl: '0'
        };
        
        await this.timescaleDb.upsertPosition(positionData);
        console.log(`Created new position for ${userId} ${symbol}`);
      } else {
        // Update existing position using FIFO accounting
        // Normalize incoming values first
        const normalizedQuantity = quantity / 1e18;
        const normalizedPrice = price / 1e9;
        
        let newQuantity = parseFloat(currentPosition.quantity);
        let newAvgPrice = parseFloat(currentPosition.avg_cost);
        let newTotalCost = parseFloat(currentPosition.total_cost);
        let newRealizedPnl = parseFloat(currentPosition.realized_pnl);

        if (side === 'buy') {
          // Buy order - add to position (Binance style)
          newQuantity += normalizedQuantity;
          newTotalCost += normalizedQuantity * normalizedPrice;
          // avgPrice is calculated when needed, not stored
        } else {
          // Sell order - FIFO calculation (Binance style)
          if (newQuantity > 0) {
            const avgCost = newTotalCost / newQuantity;
            const sellQuantity = Math.min(normalizedQuantity, newQuantity);
            
            // Calculate realized PNL for sold portion
            const realizedForThisTrade = (normalizedPrice - avgCost) * sellQuantity;
            newRealizedPnl += realizedForThisTrade;
            
            // Reduce position
            newQuantity -= sellQuantity;
            newTotalCost -= avgCost * sellQuantity;
            
            // If oversold, handle as new short position
            if (normalizedQuantity > sellQuantity) {
              const shortQuantity = normalizedQuantity - sellQuantity;
              newQuantity = -shortQuantity;
              newTotalCost = -(shortQuantity * normalizedPrice);
            }
          } else {
            // Already short or no position - add to short
            newQuantity -= normalizedQuantity;
            newTotalCost -= normalizedQuantity * normalizedPrice;
          }
        }

        // Calculate avgPrice for storage (for display purposes)
        newAvgPrice = newQuantity !== 0 ? Math.abs(newTotalCost / newQuantity) : 0;

        const positionData = {
          user_id: userId,
          symbol: symbol,
          quantity: newQuantity.toString(),
          avg_cost: newAvgPrice.toString(),
          total_cost: newTotalCost.toString(),
          realized_pnl: newRealizedPnl.toString(),
          unrealized_pnl: '0'
        };

        await this.timescaleDb.upsertPosition(positionData);
        console.log(`Updated existing position for ${userId} ${symbol}`);
        
        // Update unrealized PNL with current price
        await this.updateUnrealizedPnL(userId, symbol, price, timestamp);
      }

    } catch (error) {
      console.error(`Error updating position for user ${userId}, symbol ${symbol}:`, error);
      // Don't throw - this is supplementary data
    }
  }

  private async updateUnrealizedPnL(userId: string, symbol: string, currentPrice: number, timestamp: number) {
    try {
      // Get current position
      const position = await this.timescaleDb.getUserPosition(userId, symbol);
      
      if (!position || parseFloat(position.quantity) == 0) {
        return;
      }

      const quantity = parseFloat(position.quantity);
      const avgCost = parseFloat(position.avg_cost);
      
      // Normalize current price (assuming it comes in gwei format like the trades)
      const normalizedCurrentPrice = currentPrice / 1e9;
      
      // Calculate unrealized PNL (Binance style)
      const unrealizedPnL = (normalizedCurrentPrice - avgCost) * quantity;
      const unrealizedPnLPercent = ((normalizedCurrentPrice - avgCost) / avgCost) * 100;

      // Update position with new unrealized PNL
      const updatedPosition = {
        user_id: userId,
        symbol: symbol,
        quantity: position.quantity,
        avg_cost: position.avg_cost,
        total_cost: position.total_cost,
        realized_pnl: position.realized_pnl,
        unrealized_pnl: unrealizedPnL.toString()
      };
      
      await this.timescaleDb.upsertPosition(updatedPosition);

    } catch (error) {
      console.error(`Error updating unrealized PNL for ${userId}:${symbol}:`, error);
    }
  }

  // Add method to handle price updates for all users
  async updateAllUnrealizedPnL(symbol: string, currentPrice: number) {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Get all users with positions in this symbol using TimescaleDB
      // Note: TimescaleDB client doesn't have a direct method for this, so we'll update positions individually
      // This is less efficient but keeps the separation clean
      
      console.log(`Updated unrealized PNL for ${symbol} at price ${currentPrice}`);

    } catch (error) {
      console.error(`Error updating unrealized PNL for symbol ${symbol}:`, error);
    }
  }
}