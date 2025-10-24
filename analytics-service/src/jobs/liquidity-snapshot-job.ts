import { DatabaseClient } from '../shared/database';
import { TimescaleDatabaseClient } from '../shared/timescale-database';

export class LiquiditySnapshotJob {
  private ponderDb: DatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;

  constructor() {
    this.ponderDb = new DatabaseClient();
    this.timescaleDb = new TimescaleDatabaseClient();
  }

  /**
   * Take periodic snapshots of order book depth for historical analysis
   * This solves the problem that orderBookDepth only stores current state
   */
  async captureHourlySnapshot() {
    const snapshotTimestamp = Math.floor(Date.now() / 1000);
    console.log(`📸 Taking liquidity snapshot at ${new Date().toISOString()}`);

    try {
      // Get current order book state from Ponder
      const currentDepth = await this.ponderDb.sql`
        SELECT 
          obd.pool_id,
          obd.side,
          obd.price,
          obd.quantity,
          obd.order_count,
          p.coin as symbol,
          p.base_decimals,
          p.quote_decimals
        FROM order_book_depth obd
        JOIN pools p ON p.order_book = obd.pool_id
        WHERE obd.quantity > 0 AND obd.price > 0
      `;

      // Store snapshot in TimescaleDB for historical analysis
      for (const depth of currentDepth) {
        const liquidityValue = 
          (parseFloat(depth.quantity) / Math.pow(10, depth.base_decimals || 18)) *
          (parseFloat(depth.price) / Math.pow(10, depth.quote_decimals || 6));

        await this.timescaleDb.sql`
          INSERT INTO analytics.liquidity_snapshots (
            snapshot_timestamp,
            pool_id,
            symbol,
            side,
            price,
            quantity,
            order_count,
            liquidity_value,
            interval_type
          ) VALUES (
            ${snapshotTimestamp},
            ${depth.pool_id},
            ${depth.symbol},
            ${depth.side},
            ${parseFloat(depth.price)},
            ${parseFloat(depth.quantity)},
            ${depth.order_count},
            ${liquidityValue},
            'hourly'
          )
          ON CONFLICT (snapshot_timestamp, pool_id, side, interval_type) 
          DO UPDATE SET
            price = EXCLUDED.price,
            quantity = EXCLUDED.quantity,
            order_count = EXCLUDED.order_count,
            liquidity_value = EXCLUDED.liquidity_value,
            updated_at = NOW()
        `;
      }

      console.log(`✅ Captured snapshot with ${currentDepth.length} depth records`);
      
      // Also create aggregated snapshot for faster queries
      await this.createAggregatedSnapshot(snapshotTimestamp);
      
      return {
        success: true,
        timestamp: snapshotTimestamp,
        records: currentDepth.length
      };

    } catch (error) {
      console.error('❌ Failed to capture liquidity snapshot:', error);
      throw error;
    }
  }

  /**
   * Create aggregated liquidity snapshot per pool for faster queries
   */
  private async createAggregatedSnapshot(timestamp: number) {
    await this.timescaleDb.sql`
      INSERT INTO analytics.liquidity_snapshots_aggregated (
        snapshot_timestamp,
        pool_id,
        symbol,
        bid_liquidity,
        ask_liquidity,
        total_liquidity,
        bid_orders,
        ask_orders,
        best_bid,
        best_ask,
        spread,
        interval_type
      )
      SELECT 
        ${timestamp} as snapshot_timestamp,
        pool_id,
        symbol,
        SUM(CASE WHEN side = 'Buy' THEN liquidity_value ELSE 0 END) as bid_liquidity,
        SUM(CASE WHEN side = 'Sell' THEN liquidity_value ELSE 0 END) as ask_liquidity,
        SUM(liquidity_value) as total_liquidity,
        SUM(CASE WHEN side = 'Buy' THEN order_count ELSE 0 END) as bid_orders,
        SUM(CASE WHEN side = 'Sell' THEN order_count ELSE 0 END) as ask_orders,
        MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END) as best_bid,
        MIN(CASE WHEN side = 'Sell' THEN price END) as best_ask,
        CASE 
          WHEN MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END) > 0 
          AND MIN(CASE WHEN side = 'Sell' THEN price END) > MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)
          THEN (MIN(CASE WHEN side = 'Sell' THEN price END) - MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)) 
               / MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)
          ELSE 0.0125
        END as spread,
        'hourly' as interval_type
      FROM analytics.liquidity_snapshots
      WHERE snapshot_timestamp = ${timestamp}
      GROUP BY pool_id, symbol
      ON CONFLICT (snapshot_timestamp, pool_id, interval_type) 
      DO UPDATE SET
        bid_liquidity = EXCLUDED.bid_liquidity,
        ask_liquidity = EXCLUDED.ask_liquidity,
        total_liquidity = EXCLUDED.total_liquidity,
        bid_orders = EXCLUDED.bid_orders,
        ask_orders = EXCLUDED.ask_orders,
        best_bid = EXCLUDED.best_bid,
        best_ask = EXCLUDED.best_ask,
        spread = EXCLUDED.spread,
        updated_at = NOW()
    `;
  }

  /**
   * Clean up old snapshots to manage storage
   */
  async cleanupOldSnapshots(retentionDays: number = 90) {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
    
    const deleted = await this.timescaleDb.sql`
      DELETE FROM analytics.liquidity_snapshots 
      WHERE snapshot_timestamp < ${cutoffTimestamp}
    `;
    
    console.log(`🧹 Cleaned up ${deleted.length} old liquidity snapshots`);
    return deleted.length;
  }
}