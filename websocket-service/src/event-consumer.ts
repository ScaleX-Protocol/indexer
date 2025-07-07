import { Redis } from 'ioredis';
import { WebSocketServer } from './websocket-server';
import { 
  TradeEventData, 
  BalanceUpdateEventData, 
  OrderEventData, 
  DepthEventData, 
  KlineEventData, 
  ExecutionReportEventData,
  EventStreamMessage 
} from './types';

export class EventConsumer {
  private redis: Redis;
  private wsServer: WebSocketServer;
  private consumerGroup: string;
  private consumerId: string;
  private isRunning: boolean = false;
  private streams: string[] = ['trades', 'balances', 'orders', 'depth', 'klines', 'execution_reports'];

  constructor(redis: Redis, wsServer: WebSocketServer) {
    this.redis = redis;
    this.wsServer = wsServer;
    this.consumerGroup = process.env.CONSUMER_GROUP || 'websocket-consumers';
    this.consumerId = process.env.CONSUMER_ID || `ws-consumer-${Date.now()}`;
  }

  async initialize() {
    console.log('Initializing event consumer...');
    
    // Create consumer groups for all streams
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
      console.log('Event consumer is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting event consumer with ID: ${this.consumerId}`);

    // Start consuming from all streams
    const streamArgs = this.streams.flatMap(stream => [stream, '>']);
    
    while (this.isRunning) {
      try {
        const batchSize = parseInt(process.env.BATCH_SIZE || '10');
        const pollInterval = parseInt(process.env.POLL_INTERVAL || '1000');

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
    const executionPayload = {
      e: 'executionReport',
      E: parseInt(data.timestamp) * 1000,
      s: data.symbol.toUpperCase(),
      S: data.side.toUpperCase(),
      o: data.type.toUpperCase(),
      f: 'GTC', // timeInForce
      q: data.quantity,
      p: data.price,
      P: '0', // stopPrice
      F: '0', // icebergQty
      g: -1,  // orderListId
      C: data.orderId, // clientOrderId
      x: data.executionType.toUpperCase(),
      X: data.status.toUpperCase(),
      r: 'NONE', // rejectReason
      i: data.orderId,
      l: data.filledQuantity,
      z: data.filledQuantity, // cumulative filled quantity
      L: data.price, // last executed price
      n: '0', // commission
      N: null, // commission asset
      T: parseInt(data.timestamp) * 1000,
      t: -1, // tradeId
      I: data.orderId,
      w: true, // isWorking
      m: false, // isMaker
      M: false, // ignore
      O: parseInt(data.timestamp) * 1000, // order creation time
      Z: (parseFloat(data.filledQuantity) * parseFloat(data.price)).toString() // cumulative quote qty
    };

    // Send to specific user
    this.wsServer.sendToUser(data.userId, executionPayload);
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