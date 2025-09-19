import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { DatabaseClient } from './database';
import { ClientConnection, WebSocketMessage, WebSocketResponse } from './types';

export class WebSocketServer {
  private wss: WSServer;
  private clients: Map<string, ClientConnection> = new Map();
  private streamSubscriptions: Map<string, Set<string>> = new Map(); // stream -> client IDs
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> client IDs
  private db: DatabaseClient;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(port: number, db: DatabaseClient) {
    this.db = db;
    this.wss = new WSServer({ 
      port,
      perMessageDeflate: false,
      maxPayload: 1024 * 1024 // 1MB
    });

    this.setupWebSocketServer();
    this.startPingInterval();
    
    console.log(`WebSocket server listening on port ${port}`);
  }

  private setupWebSocketServer() {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = this.generateClientId();
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const userId = this.extractUserIdFromPath(url.pathname);

    const client: ClientConnection = {
      id: clientId,
      ws,
      isAlive: true,
      subscriptions: new Set(),
      userId,
      rateLimitData: {
        lastMessage: Date.now(),
        messageCount: 0
      }
    };

    this.clients.set(clientId, client);

    // Track user connections
    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(clientId);
    }

    console.log(`Client ${clientId} connected${userId ? ` for user ${userId}` : ''}`);

    // Set up event handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleError(clientId, error));
    ws.on('pong', () => this.handlePong(clientId));

    // Send welcome message
    this.sendToClient(clientId, { id: 0, result: 'connected' });
  }

  private extractUserIdFromPath(pathname: string): string | undefined {
    // Extract user ID from paths like /ws/0x123... or /ws/user123
    const match = pathname.match(/^\/ws\/(.+)$/);
    return match ? match[1] : undefined;
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private handleMessage(clientId: string, data: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Rate limiting
    const now = Date.now();
    if (now - client.rateLimitData.lastMessage < 200) { // 200ms cooldown
      client.rateLimitData.messageCount++;
      if (client.rateLimitData.messageCount > 10) {
        this.sendError(clientId, -1, 'Rate limit exceeded');
        return;
      }
    } else {
      client.rateLimitData.messageCount = 0;
    }
    client.rateLimitData.lastMessage = now;

    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      this.processMessage(clientId, message);
    } catch (error) {
      console.error(`Error parsing message from client ${clientId}:`, error);
      this.sendError(clientId, -1, 'Invalid JSON format');
    }
  }

  private async processMessage(clientId: string, message: WebSocketMessage) {
    const { method, params, id } = message;

    switch (method) {
      case 'SUBSCRIBE':
        await this.handleSubscribe(clientId, params, id);
        break;
      case 'UNSUBSCRIBE':
        await this.handleUnsubscribe(clientId, params, id);
        break;
      case 'LIST_SUBSCRIPTIONS':
        await this.handleListSubscriptions(clientId, id);
        break;
      case 'PING':
        this.sendToClient(clientId, { id, result: 'PONG' });
        break;
      default:
        this.sendError(clientId, id, `Unknown method: ${method}`);
    }
  }

  private async handleSubscribe(clientId: string, streams: string[], messageId: number) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const validStreams: string[] = [];

    for (const stream of streams) {
      if (this.isValidStream(stream)) {
        // Add to client subscriptions
        client.subscriptions.add(stream);
        
        // Add to stream subscriptions
        if (!this.streamSubscriptions.has(stream)) {
          this.streamSubscriptions.set(stream, new Set());
        }
        this.streamSubscriptions.get(stream)!.add(clientId);
        
        validStreams.push(stream);

        // Send initial data for depth streams
        if (stream.includes('@depth')) {
          await this.sendInitialDepthData(clientId, stream);
        }
        
        // Handle user-specific stream subscriptions
        if (stream.startsWith('user@') && client.userId) {
          await this.handleUserStreamSubscription(clientId, stream);
        }
      }
    }

    this.sendToClient(clientId, { 
      id: messageId, 
      result: validStreams.length > 0 ? validStreams : null 
    });

    console.log(`Client ${clientId} subscribed to: ${validStreams.join(', ')}`);
  }

  private async handleUnsubscribe(clientId: string, streams: string[], messageId: number) {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const stream of streams) {
      // Remove from client subscriptions
      client.subscriptions.delete(stream);
      
      // Remove from stream subscriptions
      const streamClients = this.streamSubscriptions.get(stream);
      if (streamClients) {
        streamClients.delete(clientId);
        if (streamClients.size === 0) {
          this.streamSubscriptions.delete(stream);
        }
      }
    }

    this.sendToClient(clientId, { id: messageId, result: streams });
    console.log(`Client ${clientId} unsubscribed from: ${streams.join(', ')}`);
  }

  private async handleListSubscriptions(clientId: string, messageId: number) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const subscriptions = Array.from(client.subscriptions);
    this.sendToClient(clientId, { id: messageId, result: subscriptions });
  }

  private isValidStream(stream: string): boolean {
    // Validate stream format: symbol@type or symbol@type_interval
    const patterns = [
      /^[a-zA-Z0-9/]+@trade$/,           // e.g., btcusdt@trade
      /^[a-zA-Z0-9/]+@depth$/,           // e.g., btcusdt@depth  
      /^[a-zA-Z0-9/]+@kline_\w+$/,       // e.g., btcusdt@kline_1m
      /^[a-zA-Z0-9/]+@miniTicker$/,      // e.g., btcusdt@miniTicker
      /^[a-zA-Z0-9/]+@ticker$/,          // e.g., btcusdt@ticker (24hr ticker)
      /^user@(trades|orders|balance)$/,  // User-specific streams
      /^user@executionReport$/           // User execution reports
    ];

    return patterns.some(pattern => pattern.test(stream));
  }

  private async sendInitialDepthData(clientId: string, stream: string) {
    try {
      // Extract symbol from stream (e.g., "btcusdt@depth" -> "btcusdt")
      const symbol = stream.split('@')[0];
      const pool = await this.db.getPoolBySymbol(symbol.toUpperCase());
      
      if (pool) {
        const depth = await this.db.getOrderBookDepth(pool.order_book);
        const depthPayload = {
          e: 'depthUpdate',
          E: Date.now(),
          s: symbol.toUpperCase(),
          b: depth.bids,
          a: depth.asks
        };
        
        this.sendRawToClient(clientId, JSON.stringify(depthPayload));
      }
    } catch (error) {
      console.error(`Error sending initial depth data for ${stream}:`, error);
    }
  }

  private async handleUserStreamSubscription(clientId: string, stream: string) {
    const client = this.clients.get(clientId);
    if (!client || !client.userId) return;

    try {
      switch (stream) {
        case 'user@balance':
          // Send initial account balance
          await this.sendInitialAccountData(clientId, client.userId);
          break;
        
        case 'user@orders':
          // Send initial open orders
          await this.sendInitialOrderData(clientId, client.userId);
          break;
          
        case 'user@trades':
        case 'user@executionReport':
          // These will be sent when events occur
          this.sendToClient(clientId, { 
            id: 0,
            result: `Subscribed to ${stream} for user ${client.userId}`
          });
          break;
      }
    } catch (error) {
      console.error(`Error handling user stream subscription ${stream}:`, error);
    }
  }

  private async sendInitialAccountData(clientId: string, userId: string) {
    try {
      // This would typically fetch from your database
      // For now, send a placeholder that matches Binance format
      const accountPayload = {
        e: 'outboundAccountPosition',
        E: Date.now(),
        u: Date.now(),
        B: [] // Will be populated with actual balance data
      };
      
      this.sendRawToClient(clientId, JSON.stringify(accountPayload));
    } catch (error) {
      console.error(`Error sending initial account data for user ${userId}:`, error);
    }
  }

  private async sendInitialOrderData(clientId: string, userId: string) {
    try {
      // Send current open orders in Binance format
      // This would query your orders table for open orders
      const orderPayload = {
        e: 'openOrders',
        E: Date.now(),
        orders: [] // Will be populated with actual order data
      };
      
      this.sendRawToClient(clientId, JSON.stringify(orderPayload));
    } catch (error) {
      console.error(`Error sending initial order data for user ${userId}:`, error);
    }
  }

  private handleDisconnection(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from stream subscriptions
    for (const stream of client.subscriptions) {
      const streamClients = this.streamSubscriptions.get(stream);
      if (streamClients) {
        streamClients.delete(clientId);
        if (streamClients.size === 0) {
          this.streamSubscriptions.delete(stream);
        }
      }
    }

    // Remove from user connections
    if (client.userId) {
      const userClients = this.userConnections.get(client.userId);
      if (userClients) {
        userClients.delete(clientId);
        if (userClients.size === 0) {
          this.userConnections.delete(client.userId);
        }
      }
    }

    this.clients.delete(clientId);
    console.log(`Client ${clientId} disconnected`);
  }

  private handleError(clientId: string, error: Error) {
    console.error(`Client ${clientId} error:`, error);
  }

  private handlePong(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      client.isAlive = true;
    }
  }

  private startPingInterval() {
    const interval = parseInt(process.env.WS_PING_INTERVAL || '30000');
    
    this.pingInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (!client.isAlive) {
          console.log(`Terminating inactive client ${clientId}`);
          client.ws.terminate();
          this.handleDisconnection(clientId);
          return;
        }
        
        client.isAlive = false;
        client.ws.ping();
      });
    }, interval);
  }

  // Public methods for broadcasting
  public broadcastToStream(stream: string, data: any) {
    const clients = this.streamSubscriptions.get(stream);
    if (!clients) return;

    const message = JSON.stringify({
      stream,
      data
    });

    clients.forEach(clientId => {
      this.sendRawToClient(clientId, message);
    });
  }

  public sendToUser(userId: string, data: any) {
    const clients = this.userConnections.get(userId);
    if (!clients) return;

    const message = JSON.stringify(data);

    clients.forEach(clientId => {
      this.sendRawToClient(clientId, message);
    });
  }

  private sendToClient(clientId: string, data: WebSocketResponse) {
    const message = JSON.stringify(data);
    this.sendRawToClient(clientId, message);
  }

  private sendRawToClient(clientId: string, message: string) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch (error) {
        console.error(`Error sending message to client ${clientId}:`, error);
      }
    }
  }

  private sendError(clientId: string, id: number, message: string) {
    this.sendToClient(clientId, {
      id,
      error: {
        code: -1,
        msg: message
      }
    });
  }

  public getStats() {
    return {
      totalConnections: this.clients.size,
      totalStreams: this.streamSubscriptions.size,
      totalUsers: this.userConnections.size,
      activeStreams: Array.from(this.streamSubscriptions.keys())
    };
  }

  public async close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.clients.forEach(client => {
      client.ws.close();
    });
    
    this.wss.close();
    console.log('WebSocket server closed');
  }
}