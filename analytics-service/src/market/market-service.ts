import { DatabaseClient } from '../shared/database';
import { MarketMetrics, TradingMetrics } from '../shared/types';

export class MarketService {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  async getMarketOverview(): Promise<any> {
    try {
      const [symbolStats, tradingMetrics, topTraders] = await Promise.all([
        this.db.getSymbolStats24h(),
        this.db.getTradingMetrics24h(),
        this.db.getTopTraders24h(5)
      ]);

      return {
        totalMarkets: symbolStats.length,
        totalVolume24h: tradingMetrics[0]?.total_volume || '0',
        totalTrades24h: tradingMetrics[0]?.total_trades || 0,
        uniqueTraders24h: tradingMetrics[0]?.unique_traders || 0,
        averageTradeSize: tradingMetrics[0]?.avg_trade_size || '0',
        largestTrade24h: tradingMetrics[0]?.largest_trade || '0',
        topMarkets: symbolStats.slice(0, 10).map(stat => ({
          symbol: stat.symbol,
          volume24h: stat.volume_24h,
          trades24h: stat.trades_24h,
          uniqueTraders24h: stat.unique_traders_24h,
          priceChange24h: '0', // TODO: Calculate from historical data
          priceChangePercent24h: '0'
        })),
        topTraders: topTraders.map(trader => ({
          address: trader.user,
          volume24h: trader.total_volume,
          trades24h: trader.trade_count,
          averageTradeSize: trader.avg_trade_size
        })),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error getting market overview:', error);
      throw error;
    }
  }

  async getSymbolMetrics(symbol: string): Promise<MarketMetrics> {
    try {
      const stats = await this.db.getSymbolStats24h(symbol);
      const symbolData = stats[0];

      if (!symbolData) {
        throw new Error(`Symbol ${symbol} not found`);
      }

      return {
        symbol,
        volume24h: symbolData.volume_24h || '0',
        priceChange24h: '0', // TODO: Calculate from historical data
        priceChangePercent24h: '0',
        high24h: symbolData.high_24h || '0',
        low24h: symbolData.low_24h || '0',
        trades24h: symbolData.trades_24h || 0,
        activeUsers24h: symbolData.unique_traders_24h || 0,
        timestamp: Date.now().toString()
      };
    } catch (error) {
      console.error(`Error getting metrics for symbol ${symbol}:`, error);
      throw error;
    }
  }

  async getTradingVolume(timeframe: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<any> {
    try {
      // For now, just return 24h data
      // TODO: Implement different timeframes
      const metrics = await this.db.getTradingMetrics24h();
      const symbolStats = await this.db.getSymbolStats24h();

      return {
        timeframe,
        totalVolume: metrics[0]?.total_volume || '0',
        volumeBySymbol: symbolStats.map(stat => ({
          symbol: stat.symbol,
          volume: stat.volume_24h,
          percentage: '0' // TODO: Calculate percentage of total volume
        })),
        volumeByTime: [], // TODO: Implement hourly breakdown
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error getting trading volume for ${timeframe}:`, error);
      throw error;
    }
  }

  async getLiquidityMetrics(): Promise<any> {
    try {
      // TODO: Implement proper liquidity metrics from order book depth
      const pools = await this.db.getPools();

      return {
        totalLiquidity: '0', // TODO: Calculate from order book depth
        liquidityBySymbol: pools.map(pool => ({
          symbol: pool.coin,
          bidLiquidity: '0',
          askLiquidity: '0',
          spread: '0',
          depth: '0'
        })),
        averageSpread: '0',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error getting liquidity metrics:', error);
      throw error;
    }
  }

  async getPriceData(symbol: string, interval: string = '1h', limit: number = 100): Promise<any[]> {
    try {
      // TODO: Implement proper OHLCV data retrieval
      // For now, return empty array
      return [];
    } catch (error) {
      console.error(`Error getting price data for ${symbol}:`, error);
      throw error;
    }
  }

  async getMarketMakers(): Promise<any[]> {
    try {
      const topTraders = await this.db.getTopTraders24h(20);
      
      // Simple heuristic: traders with high volume and many trades are likely market makers
      return topTraders
        .filter(trader => trader.trade_count > 10 && parseFloat(trader.total_volume) > 1000)
        .map(trader => ({
          address: trader.user,
          volume24h: trader.total_volume,
          trades24h: trader.trade_count,
          averageTradeSize: trader.avg_trade_size,
          marketMakerScore: this.calculateMarketMakerScore(trader),
          lastActivity: trader.last_trade_time
        }));
    } catch (error) {
      console.error('Error getting market makers:', error);
      throw error;
    }
  }

  private calculateMarketMakerScore(trader: any): number {
    // Simple scoring based on trade frequency and volume consistency
    const tradeFrequency = trader.trade_count / 24; // trades per hour
    const volumeConsistency = parseFloat(trader.avg_trade_size) / parseFloat(trader.total_volume);
    
    // Higher frequency and more consistent trade sizes = higher MM score
    return Math.min(100, (tradeFrequency * 10) + (volumeConsistency * 1000));
  }

  async getArbitrageOpportunities(): Promise<any[]> {
    try {
      // TODO: Implement cross-market arbitrage detection
      // This would require comparing prices across different pools/markets
      return [];
    } catch (error) {
      console.error('Error getting arbitrage opportunities:', error);
      throw error;
    }
  }

  async getMarketSentiment(): Promise<any> {
    try {
      const tradingMetrics = await this.db.getTradingMetrics24h();
      const symbolStats = await this.db.getSymbolStats24h();
      
      // Simple sentiment based on trading activity
      const totalTrades = tradingMetrics[0]?.total_trades || 0;
      const uniqueTraders = tradingMetrics[0]?.unique_traders || 0;
      const avgTradesPerUser = uniqueTraders > 0 ? totalTrades / uniqueTraders : 0;

      let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      
      if (avgTradesPerUser > 5) sentiment = 'bullish';
      else if (avgTradesPerUser < 2) sentiment = 'bearish';

      return {
        overall: sentiment,
        indicators: {
          tradingActivity: avgTradesPerUser > 3 ? 'high' : avgTradesPerUser > 1 ? 'medium' : 'low',
          marketParticipation: uniqueTraders > 100 ? 'high' : uniqueTraders > 50 ? 'medium' : 'low',
          volumeDistribution: symbolStats.length > 5 ? 'diversified' : 'concentrated'
        },
        score: Math.min(100, avgTradesPerUser * 20), // Simple sentiment score
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error calculating market sentiment:', error);
      throw error;
    }
  }
}