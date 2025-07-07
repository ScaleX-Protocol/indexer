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

export interface PortfolioSnapshot {
  userId: string;
  totalValue: string;
  availableValue: string;
  lockedValue: string;
  assets: AssetPosition[];
  timestamp: string;
  pnl24h: string;
  pnlPercent24h: string;
}

export interface AssetPosition {
  symbol: string;
  available: string;
  locked: string;
  total: string;
  value: string;
  price: string;
  priceChange24h: string;
  percentage: string;
}

export interface MarketMetrics {
  symbol: string;
  volume24h: string;
  priceChange24h: string;
  priceChangePercent24h: string;
  high24h: string;
  low24h: string;
  trades24h: number;
  activeUsers24h: number;
  timestamp: string;
}

export interface TradingMetrics {
  totalVolume: string;
  totalTrades: number;
  uniqueTraders: number;
  avgTradeSize: string;
  largestTrade: string;
  mostActiveSymbol: string;
  timestamp: string;
}

export interface UserTradingStats {
  userId: string;
  totalTrades: number;
  totalVolume: string;
  avgTradeSize: string;
  winRate: string;
  pnl: string;
  favoriteSymbol: string;
  lastTradeTime: string;
  riskScore: number;
}