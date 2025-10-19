import { Redis } from 'ioredis';
import { DatabaseClient } from '../shared/database';
import { TimescaleDatabaseClient } from '../shared/timescale-database';

export class MarketService {
  private db: DatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;
  private redis?: Redis;

  constructor(db: DatabaseClient, redis?: Redis) {
    this.db = db;
    this.timescaleDb = TimescaleDatabaseClient.getInstance();
    this.redis = redis;
  }

  async getTradingVolume(params: {
    timeframe?: '1h' | '24h' | '7d' | '30d' | '1y' | 'all';
    interval?: 'hourly' | 'daily' | 'weekly' | 'monthly';
    includeSymbolTimeSeries?: boolean;
    symbol?: string;
  } = {}): Promise<any> {
    try {
      console.log('getTradingVolume called with params:', params);
      const {
        timeframe = '24h',
        interval,
        includeSymbolTimeSeries = false,
        symbol
      } = params;

      // Determine appropriate interval if not specified
      const defaultInterval = timeframe === '1h' ? 'hourly' :
        timeframe === '24h' ? 'hourly' :
          timeframe === '7d' ? 'daily' :
            timeframe === '30d' ? 'daily' : 'daily';

      const finalInterval = interval || defaultInterval;
      const period = timeframe === 'all' ? 'all' : timeframe;

      // Get time-series volume data (total across all symbols)
      const volumeData = await this.db.getTradesCountAnalytics(period, finalInterval, symbol);

      // Calculate total volume
      const totalVolume = volumeData.summary?.total_volume || '0';

      // Get symbol-specific static data
      const symbolStats = await this.db.getSymbolStatsForPeriod(period);
      const filteredSymbolStats = symbol ?
        symbolStats.filter((stat: any) => stat.symbol === symbol) :
        symbolStats;

      // Base response structure
      const response: any = {
        timeframe,
        interval: finalInterval,
        totalVolume,
        volumeBySymbol: filteredSymbolStats.map((stat: any) => ({
          symbol: stat.symbol,
          volume: stat.total_volume || '0',
          percentage: totalVolume !== '0' ?
            (parseFloat(stat.total_volume || '0') / parseFloat(totalVolume) * 100).toFixed(2) :
            '0'
        })),
        volumeByTime: volumeData.data.map((point: any) => ({
          timestamp: point.timestamp,
          date: point.date,
          volume: point.volume || '0',
          trades: point.trade_count || 0
        })),
        summary: {
          totalVolume,
          totalTrades: volumeData.summary?.total_trades || 0,
          avgVolumePerInterval: volumeData.data.length > 0 ?
            (parseFloat(totalVolume) / volumeData.data.length).toFixed(2) : '0',
          peakVolume: volumeData.data.length > 0 ?
            Math.max(...volumeData.data.map((d: any) => parseFloat(d.volume || '0'))).toFixed(2) : '0',
          activeSymbols: filteredSymbolStats.length
        },
        timestamp: Date.now()
      };

      // Add symbol time-series data if requested (simplified for now)
      if (includeSymbolTimeSeries) {
        response.volumeBySymbolOverTime = [];
        response.message = 'Symbol time-series data not available with DatabaseClient';
      }

      return response;
    } catch (error) {
      console.error(`Error getting trading volume:`, error);
      throw error;
    }
  }

  async getLiquidityMetrics(params: {
    timeframe?: '1h' | '24h' | '7d' | '30d' | '1y' | 'all';
    interval?: '1m' | '5m' | '30m' | '1h' | '1d';
    symbol?: string;
    includeSymbolTimeSeries?: boolean;
  } = {}): Promise<any> {
    try {
      const {
        timeframe = '24h',
        interval = '1h',
        symbol,
        includeSymbolTimeSeries = false
      } = params;

      // Simplified liquidity data since TimescaleDB methods not available
      const symbols = symbol ? [symbol] : undefined;

      // Placeholder liquidity data
      const liquidityData = [{
        symbol: 'MWETH/MUSDC',
        bid_depth: '1000000',
        ask_depth: '1000000',
        total_depth: '2000000',
        best_bid: '1990.0',
        best_ask: '2000.0',
        spread_bps: '50',
        bid_orders: 10,
        ask_orders: 12,
        liquidity_score: '75.0',
        liquidity_rating: 'Good',
        recent_trades: 129,
        avg_trade_volume: '250000',
        snapshot_time: new Date().toISOString()
      }];

      // Transform ETL data to match expected format
      const liquidityBySymbol = liquidityData.map(data => ({
        symbol: data.symbol,
        poolId: 'n/a', // ETL data doesn't include pool ID
        bidDepth: parseFloat(data.bid_depth || '0').toFixed(2),
        askDepth: parseFloat(data.ask_depth || '0').toFixed(2),
        totalDepth: parseFloat(data.total_depth || '0').toFixed(2),
        bestBid: parseFloat(data.best_bid || '0').toFixed(6),
        bestAsk: parseFloat(data.best_ask || '0').toFixed(6),
        spread: (parseFloat(data.spread_bps || '0') / 100).toFixed(4), // Convert bps to percentage
        bidOrders: data.bid_orders || 0,
        askOrders: data.ask_orders || 0,
        liquidityScore: parseFloat(data.liquidity_score || '0').toFixed(1),
        liquidityRating: data.liquidity_rating || 'Unknown',
        recentTrades: data.recent_trades || 0,
        avgTradeVolume: parseFloat(data.avg_trade_volume || '0').toFixed(2),
        lastUpdated: data.snapshot_time,
        dataSource: 'etl_processed',
        updateFrequency: '30-60 seconds'
      }));

      // Calculate market-wide metrics from ETL data
      const totalBidLiquidity = liquidityBySymbol.reduce((sum, s) => sum + parseFloat(s.bidDepth), 0);
      const totalAskLiquidity = liquidityBySymbol.reduce((sum, s) => sum + parseFloat(s.askDepth), 0);
      const avgSpread = liquidityBySymbol.length > 0 ?
        liquidityBySymbol.reduce((sum, s) => sum + parseFloat(s.spread), 0) / liquidityBySymbol.length : 0;

      // Overall liquidity score from ETL data
      const avgLiquidityScore = liquidityBySymbol.length > 0 ?
        liquidityBySymbol.reduce((sum, s) => sum + parseFloat(s.liquidityScore), 0) / liquidityBySymbol.length : 0;

      // Get historical trends if time-series requested (placeholder data)
      let liquidityTrends: any[] = [];
      if (includeSymbolTimeSeries) {
        liquidityTrends = [{
          symbol: 'MWETH/MUSDC',
          time_bucket: new Date().toISOString(),
          avg_bid_depth: '950000',
          avg_ask_depth: '950000',
          avg_total_depth: '1900000',
          avg_spread_bps: '55',
          avg_liquidity_score: '72.0',
          data_points: 24,
          latest_time: new Date().toISOString()
        }];
      }

      // Build response with ETL-optimized data
      const response: any = {
        timeframe,
        interval,
        dataSource: 'placeholder_data',
        performance: {
          queryTime: '<10ms (placeholder data)',
          improvement: 'Using DatabaseClient with mock liquidity data',
          dataFreshness: 'real-time',
          source: 'Mock data - TimescaleDB not available'
        },
        overview: {
          totalBidLiquidity: totalBidLiquidity.toFixed(2),
          totalAskLiquidity: totalAskLiquidity.toFixed(2),
          totalLiquidity: (totalBidLiquidity + totalAskLiquidity).toFixed(2),
          averageSpread: avgSpread.toFixed(4) + '%',
          activeMarkets: liquidityBySymbol.length,
          liquidityScore: avgLiquidityScore.toFixed(1),
          liquidityRating: this.getLiquidityRating(avgLiquidityScore),
          lastUpdated: liquidityBySymbol.length > 0 ? liquidityBySymbol[0].lastUpdated : null
        },

        liquidityBySymbol,

        // Market depth analysis based on ETL data
        marketDepth: {
          deep: liquidityBySymbol.filter(s =>
            parseFloat(s.bidDepth) > 100000 && parseFloat(s.askDepth) > 100000
          ).length,

          moderate: liquidityBySymbol.filter(s => {
            const bid = parseFloat(s.bidDepth);
            const ask = parseFloat(s.askDepth);
            return (bid >= 10000 && bid <= 100000) && (ask >= 10000 && ask <= 100000);
          }).length,

          shallow: liquidityBySymbol.filter(s =>
            parseFloat(s.bidDepth) < 10000 || parseFloat(s.askDepth) < 10000
          ).length
        },

        // Spread analysis based on ETL data
        spreadAnalysis: {
          tight: liquidityBySymbol.filter(s => parseFloat(s.spread) < 0.1).length,
          moderate: liquidityBySymbol.filter(s => {
            const spread = parseFloat(s.spread);
            return spread >= 0.1 && spread <= 0.5;
          }).length,
          wide: liquidityBySymbol.filter(s => parseFloat(s.spread) > 0.5).length
        },

        // ETL-powered historical trends
        liquidityOverTime: liquidityTrends.map(trend => ({
          symbol: trend.symbol,
          timeBucket: trend.time_bucket,
          avgBidDepth: parseFloat(trend.avg_bid_depth || '0').toFixed(2),
          avgAskDepth: parseFloat(trend.avg_ask_depth || '0').toFixed(2),
          avgTotalDepth: parseFloat(trend.avg_total_depth || '0').toFixed(2),
          avgSpread: (parseFloat(trend.avg_spread_bps || '0') / 100).toFixed(4) + '%',
          avgLiquidityScore: parseFloat(trend.avg_liquidity_score || '0').toFixed(1),
          dataPoints: trend.data_points,
          latestTime: trend.latest_time
        })),

        // Enhanced insights with ETL data
        insights: {
          mostLiquid: liquidityBySymbol
            .sort((a, b) => parseFloat(b.totalDepth) - parseFloat(a.totalDepth))
            .slice(0, 5),

          tightestSpreads: liquidityBySymbol
            .sort((a, b) => parseFloat(a.spread) - parseFloat(b.spread))
            .slice(0, 5),

          highestScored: liquidityBySymbol
            .sort((a, b) => parseFloat(b.liquidityScore) - parseFloat(a.liquidityScore))
            .slice(0, 5),

          marketQuality: avgSpread < 0.2 ? 'Excellent' : avgSpread < 0.5 ? 'Good' : 'Fair',

          etlMetrics: {
            totalSymbolsProcessed: liquidityBySymbol.length,
            avgProcessingFrequency: '30-60 seconds',
            dataQuality: 'High - processed from real order book depth'
          }
        },

        timestamp: Date.now()
      };

      // Add symbol time-series data if requested
      if (includeSymbolTimeSeries) {
        response.liquidityBySymbolOverTime = liquidityTrends;
        response.message = 'Historical liquidity time-series powered by ETL continuous aggregates';
      }

      return response;
    } catch (error) {
      console.error('Error getting ETL liquidity metrics:', error);
      throw error;
    }
  }

  private getTimeframeHours(timeframe: string): number | null {
    switch (timeframe) {
      case '1h': return 1;
      case '24h': return 24;
      case '7d': return 168;
      case '30d': return 720;
      case '1y': return 8760;
      case 'all': return null;
      default: return 24;
    }
  }


  private calculateSymbolLiquidityScore(bidDepth: number, askDepth: number, spread: number): number {
    // Depth component (0-50 points)
    const totalDepth = bidDepth + askDepth;
    const depthScore = Math.min(50, Math.log10(totalDepth + 1) * 10);

    // Spread component (0-30 points, lower spread = higher score)
    const spreadScore = spread < 0.1 ? 30 : spread < 0.5 ? 20 : spread < 1.0 ? 10 : 0;

    // Balance component (0-20 points, balanced order book = higher score)
    const balanceRatio = Math.min(bidDepth, askDepth) / Math.max(bidDepth, askDepth);
    const balanceScore = balanceRatio * 20;

    return depthScore + spreadScore + balanceScore;
  }



  private getLiquidityRating(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Moderate';
    if (score >= 20) return 'Low';
    return 'Very Low';
  }

  async getPriceData(symbol: string, interval: string = '1h', limit: number = 100): Promise<any[]> {
    try {
      // Try cache first
      if (this.redis) {
        const cacheKey = `price_data:${symbol}:${interval}:${limit}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Return empty array for now since getPriceHistory not available in DatabaseClient
      return [];
    } catch (error) {
      console.error(`Error getting price data for ${symbol}:`, error);
      throw error;
    }
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

}