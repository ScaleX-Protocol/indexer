export interface WebSocketMessage {
  method: string;
  params: string[];
  id: number;
}

export interface WebSocketResponse {
  id?: number;
  result?: any;
  error?: {
    code: number;
    msg: string;
  };
}

export interface StreamSubscription {
  stream: string;
  symbol?: string;
  interval?: string;
}

export interface ClientConnection {
  id: string;
  ws: any; // WebSocket instance
  isAlive: boolean;
  subscriptions: Set<string>;
  userId?: string;
  rateLimitData: {
    lastMessage: number;
    messageCount: number;
  };
}

export interface EventStreamMessage {
  id: string;
  data: { [key: string]: string };
}

export interface TradeEventData {
  symbol: string;
  price: string;
  quantity: string;
  timestamp: string;
  userId: string;
  side: string;
  tradeId: string;
  orderId: string;
  makerOrderId: string;
}

export interface BalanceUpdateEventData {
  userId: string;
  token: string;
  available: string;
  locked: string;
  timestamp: string;
}

export interface OrderEventData {
  orderId: string;
  userId: string;
  symbol: string;
  side: string;
  type: string;
  price: string;
  quantity: string;
  filledQuantity: string;
  status: string;
  timestamp: string;
}

export interface DepthEventData {
  symbol: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  timestamp: string;
}

export interface KlineEventData {
  symbol: string;
  interval: string;
  openTime: string;
  closeTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: string;
}

export interface ExecutionReportEventData {
  orderId: string;
  userId: string;
  symbol: string;
  side: string;
  type: string;
  price: string;
  quantity: string;
  filledQuantity: string;
  status: string;
  timestamp: string;
  executionType: string;
}