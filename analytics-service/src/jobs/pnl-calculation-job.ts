import { DatabaseClient } from '../shared/database';
import { TimescaleDatabaseClient } from '../shared/timescale-database';

export class PNLCalculationJob {
  private ponderDb: DatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;

  constructor() {
    this.ponderDb = new DatabaseClient();
    this.timescaleDb = new TimescaleDatabaseClient();
  }

  /**
   * Capture hourly PNL snapshots from current positions
   * This solves the problem that positions only show current state
   */
  async captureHourlyPNLSnapshot() {
    const snapshotHour = new Date();
    snapshotHour.setMinutes(0, 0, 0);
    console.log(`💰 Taking PNL snapshot at ${snapshotHour.toISOString()}`);

    try {
      // Get current positions from TimescaleDB analytics.positions
      const currentPositions = await this.timescaleDb.sql`
        SELECT 
          user_id,
          symbol,
          quantity,
          avg_cost,
          total_cost,
          realized_pnl,
          unrealized_pnl,
          (realized_pnl + unrealized_pnl) as total_pnl,
          updated_at
        FROM analytics.positions
        WHERE quantity != 0 OR realized_pnl != 0 OR unrealized_pnl != 0
      `;

      console.log(`📊 Found ${currentPositions.length} active positions`);

      // Get trading activity for this hour to add volume/trades data
      const hourStart = Math.floor(snapshotHour.getTime() / 1000);
      const hourEnd = hourStart + 3600;

      for (const position of currentPositions) {
        // Get trading activity for this user in the current hour
        const activity = await this.getUserHourlyActivity(position.user_id, hourStart, hourEnd);

        // Store hourly PNL snapshot
        await this.timescaleDb.sql`
          INSERT INTO analytics.hourly_pnl_metrics (
            bucket,
            user_id,
            total_pnl,
            total_realized_pnl,
            total_unrealized_pnl,
            trades_count,
            volume_traded,
            created_at
          ) VALUES (
            ${snapshotHour},
            ${position.user_id},
            ${parseFloat(position.total_pnl)},
            ${parseFloat(position.realized_pnl)},
            ${parseFloat(position.unrealized_pnl)},
            ${activity.trades_count},
            ${activity.volume_traded},
            NOW()
          )
          ON CONFLICT (bucket, user_id) DO UPDATE SET
            total_pnl = EXCLUDED.total_pnl,
            total_realized_pnl = EXCLUDED.total_realized_pnl,
            total_unrealized_pnl = EXCLUDED.total_unrealized_pnl,
            trades_count = EXCLUDED.trades_count,
            volume_traded = EXCLUDED.volume_traded,
            created_at = NOW()
        `;
      }

      console.log(`✅ Captured PNL snapshot for ${currentPositions.length} users`);
      
      return {
        success: true,
        timestamp: snapshotHour,
        users: currentPositions.length
      };

    } catch (error) {
      console.error('❌ Failed to capture PNL snapshot:', error);
      throw error;
    }
  }

  /**
   * Get user trading activity for a specific hour
   */
  private async getUserHourlyActivity(userId: string, hourStart: number, hourEnd: number): Promise<{trades_count: number, volume_traded: number}> {
    try {
      // Get trading activity from trades table linked to orders via order_id
      const activity = await this.ponderDb.sql`
        SELECT 
          COUNT(*) as trades_count,
          COALESCE(SUM(
            CAST(t.price AS DECIMAL) * CAST(t.quantity AS DECIMAL) / 
            POWER(10, COALESCE(p.quote_decimals, 6) + COALESCE(p.base_decimals, 18))
          ), 0) as volume_traded
        FROM trades t
        JOIN orders o ON o.id = t.order_id
        LEFT JOIN pools p ON p.order_book = o.pool_id
        WHERE o."user" = ${userId}
        AND t.timestamp >= ${hourStart}
        AND t.timestamp < ${hourEnd}
        AND o.status IN ('FILLED', 'PARTIALLY_FILLED')
      `;

      return {
        trades_count: parseInt(activity[0]?.trades_count || '0'),
        volume_traded: parseFloat(activity[0]?.volume_traded || '0')
      };
    } catch (error) {
      console.warn(`Warning: Could not get activity for user ${userId}:`, error instanceof Error ? error.message : String(error));
      return { trades_count: 0, volume_traded: 0 };
    }
  }

  /**
   * Backfill historical PNL data for a specific time range
   */
  async backfillHistoricalPNL(fromTimestamp: number, toTimestamp: number) {
    console.log(`🔄 Backfilling PNL data from ${new Date(fromTimestamp * 1000).toISOString()} to ${new Date(toTimestamp * 1000).toISOString()}`);

    const hourSeconds = 3600;
    let currentTimestamp = fromTimestamp;
    let processedHours = 0;

    while (currentTimestamp < toTimestamp) {
      const hourBucket = new Date(currentTimestamp * 1000);
      hourBucket.setMinutes(0, 0, 0);

      try {
        // For historical data, calculate real PNL from actual trading activity
        const hourEnd = currentTimestamp + hourSeconds;
        
        // Get all users who traded in this hour
        const activeUsers = await this.ponderDb.sql`
          SELECT DISTINCT o."user" as user_id
          FROM trades t
          JOIN orders o ON o.id = t.order_id
          WHERE t.timestamp >= ${currentTimestamp}
          AND t.timestamp < ${hourEnd}
          AND o.status IN ('FILLED', 'PARTIALLY_FILLED')
        `;

        for (const user of activeUsers) {
          const activity = await this.getUserHourlyActivity(user.user_id, currentTimestamp, hourEnd);
          
          if (activity.trades_count > 0) {
            // Calculate REAL PNL from actual trading data using FIFO accounting
            const realPnl = await this.calculateRealHistoricalPNL(user.user_id, currentTimestamp, hourEnd);
            
            const totalPnl = realPnl.totalPnl;
            const realizedPnl = realPnl.realizedPnl;
            const unrealizedPnl = realPnl.unrealizedPnl;

            await this.timescaleDb.sql`
              INSERT INTO analytics.hourly_pnl_metrics (
                bucket,
                user_id,
                total_pnl,
                total_realized_pnl,
                total_unrealized_pnl,
                trades_count,
                volume_traded,
                created_at
              ) VALUES (
                ${hourBucket},
                ${user.user_id},
                ${totalPnl},
                ${realizedPnl},
                ${unrealizedPnl},
                ${activity.trades_count},
                ${activity.volume_traded},
                NOW()
              )
              ON CONFLICT (bucket, user_id) DO NOTHING
            `;
          }
        }

        processedHours++;
        if (processedHours % 24 === 0) {
          console.log(`📈 Processed ${processedHours} hours of PNL data...`);
        }

      } catch (error) {
        console.warn(`Warning: Failed to process hour ${hourBucket.toISOString()}:`, error instanceof Error ? error.message : String(error));
      }

      currentTimestamp += hourSeconds;
    }

    console.log(`✅ Backfilled ${processedHours} hours of PNL data`);
    return processedHours;
  }

  /**
   * Calculate real historical PNL from actual trading data using FIFO accounting
   */
  private async calculateRealHistoricalPNL(userId: string, hourStart: number, hourEnd: number): Promise<{totalPnl: number, realizedPnl: number, unrealizedPnl: number}> {
    try {
      // Get all trades for this user in this hour, ordered by timestamp
      const trades = await this.ponderDb.sql`
        SELECT 
          t.price,
          t.quantity,
          t.timestamp,
          o.side,
          p.coin as symbol,
          p.quote_decimals,
          p.base_decimals
        FROM trades t
        JOIN orders o ON o.id = t.order_id
        LEFT JOIN pools p ON p.order_book = o.pool_id
        WHERE o."user" = ${userId}
        AND t.timestamp >= ${hourStart}
        AND t.timestamp < ${hourEnd}
        AND o.status IN ('FILLED', 'PARTIALLY_FILLED')
        ORDER BY t.timestamp ASC
      `;

      if (trades.length === 0) {
        return { totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0 };
      }

      // Group trades by symbol and calculate PNL for each
      const symbolPnl = new Map<string, {realizedPnl: number, unrealizedPnl: number, position: number, avgCost: number}>();
      
      for (const trade of trades) {
        const symbol = trade.symbol || 'UNKNOWN';
        const quoteDecimals = parseInt(trade.quote_decimals) || 6;
        const baseDecimals = parseInt(trade.base_decimals) || 18;
        
        // Normalize price and quantity using actual token decimals
        const price = parseFloat(trade.price) / Math.pow(10, quoteDecimals); // Proper price normalization
        const quantity = parseFloat(trade.quantity) / Math.pow(10, baseDecimals); // Proper quantity normalization
        const isBuy = trade.side === 'Buy';
        
        if (!symbolPnl.has(symbol)) {
          symbolPnl.set(symbol, { realizedPnl: 0, unrealizedPnl: 0, position: 0, avgCost: 0 });
        }
        
        const symbolData = symbolPnl.get(symbol)!;
        
        if (isBuy) {
          // Buy: Add to position, update average cost
          const oldPositionValue = symbolData.position * symbolData.avgCost;
          const newPositionValue = quantity * price;
          symbolData.position += quantity;
          symbolData.avgCost = symbolData.position > 0 
            ? (oldPositionValue + newPositionValue) / symbolData.position 
            : price;
        } else {
          // Sell: Calculate realized PNL using FIFO
          if (symbolData.position > 0) {
            const sellQuantity = Math.min(quantity, symbolData.position);
            const realizedPnlForThisTrade = (price - symbolData.avgCost) * sellQuantity;
            symbolData.realizedPnl += realizedPnlForThisTrade;
            symbolData.position -= sellQuantity;
            
            // If oversold, treat as short position
            if (quantity > sellQuantity) {
              const shortQuantity = quantity - sellQuantity;
              symbolData.position = -shortQuantity;
              symbolData.avgCost = price;
            }
          } else {
            // Already short or no position - add to short
            const oldPositionValue = Math.abs(symbolData.position) * symbolData.avgCost;
            const newPositionValue = quantity * price;
            const totalQuantity = Math.abs(symbolData.position) + quantity;
            symbolData.position = -totalQuantity;
            symbolData.avgCost = totalQuantity > 0 ? (oldPositionValue + newPositionValue) / totalQuantity : price;
          }
        }
      }

      // Calculate unrealized PNL using the most recent market price for each symbol
      let totalRealizedPnl = 0;
      let totalUnrealizedPnl = 0;
      
      for (const [symbol, data] of symbolPnl) {
        totalRealizedPnl += data.realizedPnl;
        
        // Calculate unrealized PNL based on current market price vs average cost
        if (data.position !== 0) {
          // Get the most recent market price for this symbol from recent trades
          const currentMarketPrice = await this.getCurrentMarketPrice(symbol, hourEnd);
          
          if (currentMarketPrice > 0) {
            // Calculate unrealized PNL: (current_price - avg_cost) * position
            const unrealizedPnl = (currentMarketPrice - data.avgCost) * data.position;
            totalUnrealizedPnl += unrealizedPnl;
          } else {
            // If no recent market price available, unrealized PNL is 0
            totalUnrealizedPnl += 0;
          }
        }
      }
      
      const totalPnl = totalRealizedPnl + totalUnrealizedPnl;
      
      return {
        totalPnl,
        realizedPnl: totalRealizedPnl,
        unrealizedPnl: totalUnrealizedPnl
      };
      
    } catch (error) {
      console.warn(`Warning: Could not calculate real PNL for user ${userId}:`, error instanceof Error ? error.message : String(error));
      return { totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0 };
    }
  }

  /**
   * Get the most recent market price for a symbol from recent trades
   */
  private async getCurrentMarketPrice(symbol: string, beforeTimestamp: number): Promise<number> {
    try {
      // Look for the most recent trade price within the last 24 hours for this symbol
      const recentTrade = await this.ponderDb.sql`
        SELECT t.price, p.quote_decimals
        FROM trades t
        JOIN orders o ON o.id = t.order_id
        LEFT JOIN pools p ON p.order_book = o.pool_id
        WHERE p.coin = ${symbol}
        AND t.timestamp <= ${beforeTimestamp}
        AND t.timestamp >= ${beforeTimestamp - (24 * 3600)}
        AND o.status IN ('FILLED', 'PARTIALLY_FILLED')
        ORDER BY t.timestamp DESC
        LIMIT 1
      `;

      if (recentTrade.length > 0) {
        const quoteDecimals = parseInt(recentTrade[0].quote_decimals) || 6;
        return parseFloat(recentTrade[0].price) / Math.pow(10, quoteDecimals); // Proper price normalization
      }

      // If no recent trade found, try to get from order book depth
      const marketPrice = await this.ponderDb.sql`
        SELECT 
          AVG(CAST(obd.price AS DECIMAL)) as avg_price,
          p.quote_decimals
        FROM order_book_depth obd
        LEFT JOIN pools p ON p.order_book = obd.pool_id
        WHERE p.coin = ${symbol}
        AND obd.quantity > 0
        AND obd.price > 0
        GROUP BY p.quote_decimals
      `;

      if (marketPrice.length > 0 && marketPrice[0].avg_price) {
        const quoteDecimals = parseInt(marketPrice[0].quote_decimals) || 6;
        return parseFloat(marketPrice[0].avg_price) / Math.pow(10, quoteDecimals); // Proper price normalization
      }

      // No market price available
      return 0;
    } catch (error) {
      console.warn(`Warning: Could not get market price for ${symbol}:`, error instanceof Error ? error.message : String(error));
      return 0;
    }
  }

  /**
   * Clean up old PNL snapshots to manage storage
   */
  async cleanupOldSnapshots(retentionDays: number = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const deleted = await this.timescaleDb.sql`
      DELETE FROM analytics.hourly_pnl_metrics 
      WHERE bucket < ${cutoffDate}
    `;
    
    console.log(`🧹 Cleaned up ${deleted.length} old PNL snapshots`);
    return deleted.length;
  }
}