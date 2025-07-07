import { DatabaseClient } from '../shared/database';
import { PortfolioSnapshot, AssetPosition } from '../shared/types';

export class PortfolioService {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  async calculatePortfolio(userId: string): Promise<PortfolioSnapshot> {
    try {
      // Get user balances
      const balances = await this.db.getUserBalances(userId);
      
      // Get latest prices
      const prices = await this.db.getLatestPrices();
      const priceMap = new Map(prices.map(p => [p.symbol.toLowerCase(), parseFloat(p.price)]));

      // Calculate asset positions
      const assetPositions: AssetPosition[] = [];
      let totalValue = 0;
      let availableValue = 0;
      let lockedValue = 0;

      for (const balance of balances) {
        const symbol = balance.symbol || 'UNKNOWN';
        const available = parseFloat(balance.amount) - parseFloat(balance.locked_amount || '0');
        const locked = parseFloat(balance.locked_amount || '0');
        const total = available + locked;

        if (total <= 0) continue;

        // Get current price (default to 1 for stablecoins or unknown tokens)
        const currentPrice = priceMap.get(symbol.toLowerCase()) || 
                           (symbol.toLowerCase().includes('usd') ? 1 : 0);

        const value = total * currentPrice;
        const availableVal = available * currentPrice;
        const lockedVal = locked * currentPrice;

        totalValue += value;
        availableValue += availableVal;
        lockedValue += lockedVal;

        assetPositions.push({
          symbol,
          available: available.toString(),
          locked: locked.toString(),
          total: total.toString(),
          value: value.toString(),
          price: currentPrice.toString(),
          priceChange24h: '0', // TODO: Calculate from historical data
          percentage: '0' // Will be calculated after totalValue is known
        });
      }

      // Calculate percentages
      assetPositions.forEach(position => {
        position.percentage = totalValue > 0 
          ? ((parseFloat(position.value) / totalValue) * 100).toFixed(2)
          : '0';
      });

      // Sort by value descending
      assetPositions.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

      return {
        userId,
        totalValue: totalValue.toString(),
        availableValue: availableValue.toString(),
        lockedValue: lockedValue.toString(),
        assets: assetPositions,
        timestamp: Date.now().toString(),
        pnl24h: '0', // TODO: Calculate from historical portfolio values
        pnlPercent24h: '0'
      };
    } catch (error) {
      console.error(`Error calculating portfolio for user ${userId}:`, error);
      throw error;
    }
  }

  async getPortfolioHistory(userId: string, days: number = 30): Promise<any[]> {
    // TODO: Implement portfolio history tracking
    // This would require storing daily portfolio snapshots
    return [];
  }

  async getPortfolioPerformance(userId: string): Promise<any> {
    try {
      const trades = await this.db.getUserTrades(userId, 1000);
      
      let totalPnL = 0;
      let totalVolume = 0;
      let winningTrades = 0;
      let totalTrades = trades.length;

      // Calculate basic performance metrics
      for (const trade of trades) {
        const volume = parseFloat(trade.quantity) * parseFloat(trade.price);
        totalVolume += volume;

        // Simple PnL calculation (this is very basic and would need more sophisticated logic)
        // For now, just track volume as a proxy for activity
      }

      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      return {
        totalTrades,
        totalVolume: totalVolume.toString(),
        averageTradeSize: totalTrades > 0 ? (totalVolume / totalTrades).toString() : '0',
        winRate: winRate.toString(),
        totalPnL: totalPnL.toString(),
        sharpeRatio: '0', // TODO: Calculate proper Sharpe ratio
        maxDrawdown: '0', // TODO: Calculate max drawdown
        lastTradeTime: trades.length > 0 ? trades[0].timestamp : null
      };
    } catch (error) {
      console.error(`Error calculating portfolio performance for user ${userId}:`, error);
      throw error;
    }
  }

  async getAssetAllocation(userId: string): Promise<any> {
    const portfolio = await this.calculatePortfolio(userId);
    
    return {
      assets: portfolio.assets.map(asset => ({
        symbol: asset.symbol,
        percentage: asset.percentage,
        value: asset.value
      })),
      diversificationScore: this.calculateDiversificationScore(portfolio.assets),
      riskLevel: this.assessRiskLevel(portfolio.assets)
    };
  }

  private calculateDiversificationScore(assets: AssetPosition[]): number {
    if (assets.length === 0) return 0;
    
    // Simple diversification score based on Herfindahl-Hirschman Index
    const hhi = assets.reduce((sum, asset) => {
      const percentage = parseFloat(asset.percentage) / 100;
      return sum + (percentage * percentage);
    }, 0);
    
    // Convert to diversification score (0-100, higher is more diversified)
    return Math.max(0, (1 - hhi) * 100);
  }

  private assessRiskLevel(assets: AssetPosition[]): 'low' | 'medium' | 'high' {
    // Simple risk assessment based on asset concentration
    const maxConcentration = Math.max(...assets.map(a => parseFloat(a.percentage)));
    
    if (maxConcentration > 80) return 'high';
    if (maxConcentration > 50) return 'medium';
    return 'low';
  }
}