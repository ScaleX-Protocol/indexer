export interface TradeEvent {
  symbol: string;
  price: string;
  quantity: string;
  timestamp: string;
  userId: string;
  side: 'buy' | 'sell';
  tradeId: string;
  orderId: string;
  makerOrderId: string;
}

export interface BalanceUpdateEvent {
  userId: string;
  token: string;
  available: string;
  locked: string;
  timestamp: string;
}

export interface OrderEvent {
  orderId: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string;
  quantity: string;
  filledQuantity: string;
  status: 'pending' | 'filled' | 'cancelled' | 'partially_filled';
  timestamp: string;
}

export interface DepthEvent {
  symbol: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  timestamp: string;
}

export interface KlineEvent {
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

export interface ExecutionReportEvent {
  orderId: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string;
  quantity: string;
  filledQuantity: string;
  status: 'new' | 'filled' | 'cancelled' | 'partially_filled';
  timestamp: string;
  executionType: 'new' | 'trade' | 'cancelled';
}

export enum EventStreams {
  TRADES = 'trades',
  BALANCES = 'balances',
  ORDERS = 'orders',
  DEPTH = 'depth',
  KLINES = 'klines',
  EXECUTION_REPORTS = 'execution_reports'
}

export interface StreamMessage {
  [key: string]: string;
}