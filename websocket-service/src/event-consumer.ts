import { Redis } from 'ioredis';
import {
  BalanceUpdateEventData,
  DepthEventData,
  ExecutionReportEventData,
  KlineEventData,
  OrderEventData,
  TradeEventData
} from './types';
import { WebSocketServer } from './websocket-server';

export class EventConsumer {
  private redis: Redis;
  private wsServer: WebSocketServer;
  private consumerGroup: string;
  private consumerId: string;
  private isRunning: boolean = false;
  private chainId: string;
  private streams: string[] = ['trades', 'balances', 'orders', 'depth', 'klines', 'execution_reports'];

  constructor(redis: Redis, wsServer: WebSocketServer, chainId?: string) {
    this.redis = redis;
    this.wsServer = wsServer;
    this.chainId = chainId || process.env.DEFAULT_CHAIN_ID || '84532';
    this.consumerGroup = process.env.CONSUMER_GROUP || `websocket-consumers-${this.chainId}`;
    this.consumerId = process.env.CONSUMER_ID || `ws-consumer-${this.chainId}-${Date.now()}`;
  }

  private getStreamKey(stream: string): string {
    return `chain:${this.chainId}:${stream}`;
  }

  async initialize() {
    console.log('Initializing event consumer...');

    // Clean up orphaned consumer groups and create groups only for existing streams
    for (const stream of this.streams) {
      try {
        const streamKey = this.getStreamKey(stream);
        const exists = await this.redis.exists(streamKey);
        if (exists) {
          // Stream exists, check if consumer group exists first
          try {
            const groups = await this.redis.xinfo('GROUPS', streamKey) as any[];
            const groupExists = groups.some((group: any) => group[1] === this.consumerGroup);

            if (!groupExists) {
              await this.redis.xgroup('CREATE', streamKey, this.consumerGroup, '0');
              console.log(`Created consumer group ${this.consumerGroup} for stream ${streamKey}`);
            }
            // No need to log if group already exists - it's expected
          } catch (error: any) {
            console.error(`Failed to validate/create consumer group for stream ${streamKey}:`, error);
          }
        } else {
          // Stream doesn't exist, but consumer group might - delete it
          try {
            await this.redis.xgroup('DESTROY', streamKey, this.consumerGroup);
            console.log(`Deleted orphaned consumer group ${this.consumerGroup} for non-existent stream ${streamKey}`);
          } catch (error: any) {
            // Group doesn't exist or stream doesn't exist - that's fine
            console.log(`Stream ${streamKey} does not exist, skipping consumer group creation`);
          }
        }
      } catch (error) {
        console.error(`Error processing stream ${stream}:`, error);
      }
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('Event consumer is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting event consumer with ID: ${this.consumerId}`);

    // Get the list of existing streams once at startup
    const existingStreams: string[] = [];
    for (const stream of this.streams) {
      try {
        const streamKey = this.getStreamKey(stream);
        const exists = await this.redis.exists(streamKey);
        if (exists) {
          existingStreams.push(streamKey);
        }
      } catch (error) {
        console.warn(`Error checking existence of stream ${stream}:`, error);
      }
    }

    if (existingStreams.length === 0) {
      console.log('No streams exist yet, stopping consumer');
      return;
    }

    console.log(`Consumer will read from streams: ${existingStreams.join(', ')}`);

    while (this.isRunning) {
      try {
        const batchSize = parseInt(process.env.BATCH_SIZE || '10');
        const pollInterval = parseInt(process.env.POLL_INTERVAL || '1000');

        // Try reading from one stream at a time
        let messages = null;
        for (const stream of existingStreams) {
          try {
            messages = await this.redis.xreadgroup(
              'GROUP', this.consumerGroup, this.consumerId,
              'COUNT', batchSize,
              'BLOCK', 100,
              'STREAMS', stream, '>'
            );
            if (messages && messages.length > 0) {
              console.log(`Processing ${messages.length} messages from stream: ${stream}`);
              break;
            }
            // If no messages, continue to next stream
          } catch (error: any) {
            console.error(`Failed to read from stream ${stream}:`, error.message);
            // Continue to next stream
          }
        }

        if (!messages || messages.length === 0) {
          // No messages from any stream, wait before next iteration
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        if (messages && messages.length > 0) {
          await this.processMessages(messages);
        }
      } catch (error) {
        console.error('Error reading from streams:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
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
          console.error(`Error processing message ${id} from stream ${stream}:`, error);
          // TODO: Implement dead letter queue or retry logic
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
    // Extract stream type from chain-specific stream key (chain:84532:trades -> trades)
    const streamType = stream.split(':').pop() || stream;

    switch (streamType) {
      case 'trades':
        await this.handleTradeEvent(data as any);
        break;
      case 'balances':
        await this.handleBalanceUpdateEvent(data as any);
        break;
      case 'orders':
        await this.handleOrderEvent(data as any);
        break;
      case 'depth':
        await this.handleDepthEvent(data as any);
        break;
      case 'klines':
        await this.handleKlineEvent(data as any);
        break;
      case 'execution_reports':
        await this.handleExecutionReportEvent(data as any);
        break;
      default:
        console.warn(`Unknown stream: ${stream}`);
    }
  }

  private async handleTradeEvent(data: TradeEventData) {
    const tradePayload = {
      e: 'trade',
      E: parseInt(data.timestamp) * 1000,
      s: data.symbol.toUpperCase(),
      t: data.tradeId,
      p: data.price,
      q: data.quantity,
      T: parseInt(data.timestamp) * 1000,
      m: data.side === 'sell' // isBuyerMaker
    };

    // Broadcast to public trade stream
    this.wsServer.broadcastToStream(`${data.symbol}@trade`, tradePayload);

    // Send user-specific trade execution to the trader
    if (data.userId) {
      const userTradePayload = {
        e: 'userTrade',
        E: parseInt(data.timestamp) * 1000,
        s: data.symbol.toUpperCase(),
        t: data.tradeId,
        o: data.orderId,
        p: data.price,
        q: data.quantity,
        T: parseInt(data.timestamp) * 1000,
        S: data.side.toUpperCase(),
        // Calculate commission (0.1% maker, 0.2% taker)
        // For now, assume taker (we can enhance this later with actual maker/taker info)
        n: (parseFloat(data.price) * parseFloat(data.quantity) * 0.002).toString(),
        N: data.symbol.split('/')[1] || 'USDT', // commission asset (quote currency)
        m: false, // isMaker - default to false (taker)
        isBuyer: data.side === 'buy'
      };

      this.wsServer.sendToUser(data.userId, userTradePayload);
    }
  }

  private async handleBalanceUpdateEvent(data: BalanceUpdateEventData) {
    const balancePayload = {
      e: 'balanceUpdate',
      E: parseInt(data.timestamp) * 1000,
      a: data.token,
      b: data.available,
      l: data.locked
    };

    // Send to specific user
    this.wsServer.sendToUser(data.userId, balancePayload);
  }

  private async handleOrderEvent(data: OrderEventData) {
    // This is for order book updates, not execution reports
    // Can be used for analytics or other purposes
    console.log(`Order event for ${data.symbol}: ${data.status}`);
  }

  private async handleDepthEvent(data: DepthEventData) {
    const depthPayload = {
      e: 'depthUpdate',
      E: parseInt(data.timestamp) * 1000,
      s: data.symbol.toUpperCase(),
      b: JSON.parse(data.bids),
      a: JSON.parse(data.asks)
    };

    // Broadcast to depth stream
    this.wsServer.broadcastToStream(`${data.symbol}@depth`, depthPayload);
  }

  private async handleKlineEvent(data: KlineEventData) {
    const klinePayload = {
      e: 'kline',
      E: parseInt(data.closeTime) * 1000,
      s: data.symbol.toUpperCase(),
      k: {
        t: parseInt(data.openTime) * 1000,
        T: parseInt(data.closeTime) * 1000,
        s: data.symbol.toUpperCase(),
        i: data.interval,
        o: data.open,
        c: data.close,
        h: data.high,
        l: data.low,
        v: data.volume,
        n: parseInt(data.trades),
        x: true, // kline is closed
        q: data.volume, // quote asset volume
        V: data.volume, // taker buy base volume
        Q: data.volume  // taker buy quote volume
      }
    };

    // Broadcast to kline stream
    this.wsServer.broadcastToStream(`${data.symbol}@kline_${data.interval}`, klinePayload);
  }

  private async handleExecutionReportEvent(data: ExecutionReportEventData) {
    // Calculate commission based on DEX rates (0.1% maker, 0.2% taker)
    const isMaker = false; // Default to taker for now - can be enhanced with actual maker/taker detection
    const commissionRate = isMaker ? 0.001 : 0.002;
    const quoteQuantity = parseFloat(data.filledQuantity) * parseFloat(data.price);
    const commission = (quoteQuantity * commissionRate).toString();
    const commissionAsset = data.symbol.split('/')[1] || 'USDT';

    const executionPayload = {
      e: 'executionReport',
      E: parseInt(data.timestamp) * 1000,
      s: data.symbol.toUpperCase(),
      c: data.orderId, // clientOrderId
      S: data.side.toUpperCase(),
      o: data.type.toUpperCase(),
      f: 'GTC', // timeInForce
      q: data.quantity,
      p: data.price,
      P: '0', // stopPrice
      F: '0', // icebergQty
      g: -1,  // orderListId
      C: '', // originalClientOrderId
      x: data.executionType.toUpperCase(), // currentExecutionType
      X: data.status.toUpperCase(), // currentOrderStatus
      r: 'NONE', // rejectReason
      i: data.orderId, // orderId
      l: data.filledQuantity, // lastExecutedQuantity
      z: data.filledQuantity, // cumulativeFilledQuantity
      L: data.price, // lastExecutedPrice
      n: commission, // commissionAmount
      N: commissionAsset, // commissionAsset
      T: parseInt(data.timestamp) * 1000, // transactionTime
      t: parseInt(data.timestamp), // tradeId (using timestamp as placeholder)
      I: parseInt(data.orderId), // ignore
      w: data.status === 'NEW' || data.status === 'PARTIALLY_FILLED', // isWorking
      m: isMaker, // isMaker
      M: false, // ignore
      O: parseInt(data.timestamp) * 1000, // orderCreationTime
      Z: quoteQuantity.toString(), // cumulativeQuoteQty
      Y: quoteQuantity.toString(), // lastQuoteQty
      Q: '0' // quoteOrderQty
    };

    // Send to specific user
    this.wsServer.sendToUser(data.userId, executionPayload);

    // Also send to user@executionReport stream subscribers
    this.wsServer.broadcastToStream('user@executionReport', executionPayload);
  }

  async stop() {
    console.log('Stopping event consumer...');
    this.isRunning = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('Event consumer health check failed:', error);
      return false;
    }
  }
}