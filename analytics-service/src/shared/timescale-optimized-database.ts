import postgres from 'postgres';

/**
 * Optimized TimescaleDB client that leverages hypertables, continuous aggregates,
 * and other TimescaleDB-specific features for maximum performance
 */
export class TimescaleOptimizedDatabaseClient {
  public sql: ReturnType<typeof postgres>;
  private static instance: TimescaleOptimizedDatabaseClient;

  constructor() {
    const connectionString = process.env.TIMESCALE_DATABASE_URL || process.env.ANALYTICS_DATABASE_URL;
    if (!connectionString) {
      throw new Error('TIMESCALE_DATABASE_URL or ANALYTICS_DATABASE_URL environment variable is required');
    }

    this.sql = postgres(connectionString, {
      max: 30, // More connections for high-performance analytics
      idle_timeout: 30,
      connect_timeout: 60,
    } as any);
    
    // Set search path and enable TimescaleDB optimizations
    this.sql`
      SET search_path TO analytics, public;
      SET timescaledb.telemetry_level = OFF;
      SET work_mem = '256MB';
      SET max_parallel_workers_per_gather = 4;
    `.catch(console.error);
  }

  public static getInstance(): TimescaleOptimizedDatabaseClient {
    if (!TimescaleOptimizedDatabaseClient.instance) {
      TimescaleOptimizedDatabaseClient.instance = new TimescaleOptimizedDatabaseClient();
    }
    return TimescaleOptimizedDatabaseClient.instance;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.sql`SELECT 1`;
      return result.length > 0;
    } catch (error) {
      console.error('TimescaleDB health check failed:', error);
      return false;
    }
  }

  // =====================================================================
  // VOLUME ANALYTICS - Using Continuous Aggregates
  // =====================================================================

  async getVolumeTimeSeries(period: string, interval: string, symbol?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? new Date(Date.now() - (hours * 60 * 60 * 1000)) : new Date('1970-01-01');

    // Use appropriate continuous aggregate based on interval
    const useHourlyAggregate = ['1m', '5m', '15m', '30m', '1h'].includes(interval);
    const useDailyAggregate = ['6h', '12h', '1d'].includes(interval);

    if (useHourlyAggregate) {
      // Use hourly continuous aggregate for sub-daily queries
      const data = await this.sql`
        SELECT 
          time_bucket(${this.getTimeBucketInterval(interval)}, bucket) as timestamp,
          time_bucket(${this.getTimeBucketInterval(interval)}, bucket)::date as date,
          SUM(volume) as volume,
          SUM(trade_count) as trade_count,
          AVG(avg_trade_size) as avg_trade_size,
          MIN(min_price) as min_price,
          MAX(max_price) as max_price,
          FIRST(open_price, bucket) as open_price,
          LAST(close_price, bucket) as close_price
        FROM volume_1h_continuous v
        ${symbol ? this.sql`JOIN symbols s ON v.pool_id = s.pool_id WHERE s.symbol = ${symbol} AND` : this.sql`WHERE`}
        bucket >= ${fromTime}
        GROUP BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)
        ORDER BY timestamp DESC
      `;
      return { data };
    } else if (useDailyAggregate) {
      // Use daily continuous aggregate for daily+ queries
      const data = await this.sql`
        SELECT 
          time_bucket(${this.getTimeBucketInterval(interval)}, bucket) as timestamp,
          time_bucket(${this.getTimeBucketInterval(interval)}, bucket)::date as date,
          SUM(volume) as volume,
          SUM(trade_count) as trade_count,
          AVG(avg_trade_size) as avg_trade_size,
          MIN(min_price) as min_price,
          MAX(max_price) as max_price,
          FIRST(open_price, bucket) as open_price,
          LAST(close_price, bucket) as close_price
        FROM volume_1d_continuous v
        ${symbol ? this.sql`JOIN symbols s ON v.pool_id = s.pool_id WHERE s.symbol = ${symbol} AND` : this.sql`WHERE`}
        bucket >= ${fromTime}
        GROUP BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)
        ORDER BY timestamp DESC
      `;
      return { data };
    } else {
      // Fallback to raw data for custom intervals
      return this.getVolumeTimeSeriesRaw(period, interval, symbol);
    }
  }

  async getSymbolVolumeTimeSeries(period: string, interval: string, symbols?: string[]) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? new Date(Date.now() - (hours * 60 * 60 * 1000)) : new Date('1970-01-01');

    // Use symbol-specific continuous aggregate for maximum performance
    const data = await this.sql`
      SELECT 
        time_bucket(${this.getTimeBucketInterval(interval)}, bucket) as timestamp,
        time_bucket(${this.getTimeBucketInterval(interval)}, bucket)::date as date,
        symbol,
        pool_id,
        SUM(volume) as total_volume,
        SUM(trade_count) as trade_count,
        AVG(avg_trade_size) as avg_trade_size,
        SUM(unique_traders) as unique_traders,
        SUM(buy_volume) as buy_volume,
        SUM(sell_volume) as sell_volume,
        ROUND((SUM(sell_volume) / NULLIF(SUM(buy_volume + sell_volume), 0) * 100), 2) as sell_ratio
      FROM symbol_volume_1h_continuous
      WHERE bucket >= ${fromTime}
      ${symbols && symbols.length > 0 ? this.sql`AND symbol = ANY(${symbols})` : this.sql``}
      GROUP BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket), symbol, pool_id
      ORDER BY timestamp DESC, symbol
    `;

    return { data };
  }

  // =====================================================================
  // UNIQUE TRADERS ANALYTICS - Using Continuous Aggregates  
  // =====================================================================

  async getUniqueTraders(period: string, interval: string, minTrades: number = 1) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? new Date(Date.now() - (hours * 60 * 60 * 1000)) : new Date('1970-01-01');

    // Use continuous aggregate for much faster performance
    const data = await this.sql`
      SELECT 
        time_bucket(${this.getTimeBucketInterval(interval)}, bucket) as timestamp,
        time_bucket(${this.getTimeBucketInterval(interval)}, bucket)::date as date,
        SUM(unique_traders) as unique_traders,
        SUM(unique_buyers) as unique_buyers,
        SUM(unique_sellers) as unique_sellers,
        SUM(total_trades) as total_trades,
        -- Calculate new vs returning traders using window functions
        SUM(unique_traders) - LAG(SUM(unique_traders), 1, 0) OVER (ORDER BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)) as new_traders,
        LAG(SUM(unique_traders), 1, 0) OVER (ORDER BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)) as returning_traders,
        ROUND((LAG(SUM(unique_traders), 1, 0) OVER (ORDER BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)) * 100.0 / NULLIF(SUM(unique_traders), 0)), 2) as retention_rate
      FROM unique_traders_1h_continuous
      WHERE bucket >= ${fromTime}
      GROUP BY time_bucket(${this.getTimeBucketInterval(interval)}, bucket)
      HAVING SUM(total_trades) >= ${minTrades}
      ORDER BY timestamp DESC
    `;

    // Get summary statistics using optimized aggregates
    const summaryResult = await this.sql`
      SELECT 
        MAX(unique_traders) as peak_daily_traders,
        AVG(unique_traders) as avg_daily_active_traders,
        COUNT(DISTINCT EXTRACT(date FROM bucket)) as total_active_days,
        SUM(unique_traders) / COUNT(DISTINCT EXTRACT(date FROM bucket)) as overall_retention_rate
      FROM unique_traders_1h_continuous
      WHERE bucket >= ${fromTime}
    `;

    return { 
      data, 
      summary: summaryResult[0] || {}
    };
  }

  // =====================================================================
  // SLIPPAGE ANALYTICS - Using Raw Data with Optimized Queries
  // =====================================================================

  async getSlippageAnalytics(period: string, interval: string, symbol?: string, tradeSize?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? new Date(Date.now() - (hours * 60 * 60 * 1000)) : new Date('1970-01-01');

    // Build trade size filter
    const tradeSizeFilter = this.getTradeSizeFilter(tradeSize);

    // Use hypertable with optimized time-based partitioning
    const data = await this.sql`
      WITH trade_slippage AS (
        SELECT 
          time_bucket(${this.getTimeBucketInterval(interval)}, t.timestamp) as timestamp,
          s.symbol,
          t.size * t.price as trade_value,
          -- Calculate slippage using window functions (much faster than subqueries)
          ABS(t.price - AVG(t.price) OVER (
            PARTITION BY s.symbol 
            ORDER BY t.timestamp 
            ROWS BETWEEN 10 PRECEDING AND 10 FOLLOWING
          )) / NULLIF(AVG(t.price) OVER (
            PARTITION BY s.symbol 
            ORDER BY t.timestamp 
            ROWS BETWEEN 10 PRECEDING AND 10 FOLLOWING
          ), 0) * 100 as slippage_pct,
          CASE 
            WHEN t.size * t.price < 1000 THEN 'small'
            WHEN t.size * t.price < 10000 THEN 'medium'
            ELSE 'large'
          END as size_category
        FROM order_book_trades t
        JOIN symbols s ON t.pool_id = s.pool_id
        WHERE t.timestamp >= ${fromTime}
        ${symbol ? this.sql`AND s.symbol = ${symbol}` : this.sql``}
        ${tradeSizeFilter}
      )
      SELECT 
        timestamp,
        timestamp::date as date,
        ${symbol ? this.sql`symbol,` : this.sql``}
        COUNT(*) as trade_count,
        AVG(slippage_pct) as avg_slippage,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY slippage_pct) as median_slippage,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY slippage_pct) as p95_slippage,
        MAX(slippage_pct) as max_slippage,
        SUM(trade_value) as total_volume,
        -- Quality metrics
        COUNT(*) FILTER (WHERE slippage_pct < 0.1) * 100.0 / COUNT(*) as low_slippage_pct,
        COUNT(*) FILTER (WHERE slippage_pct > 1.0) * 100.0 / COUNT(*) as high_slippage_pct
      FROM trade_slippage
      GROUP BY timestamp ${symbol ? this.sql`, symbol` : this.sql``}
      ORDER BY timestamp DESC
    `;

    return { data };
  }

  // =====================================================================
  // PERFORMANCE MONITORING
  // =====================================================================

  async getTimescaleStats() {
    const hypertableStats = await this.sql`
      SELECT 
        hypertable_name,
        num_chunks,
        num_compressed_chunks,
        compression_ratio,
        total_size,
        compressed_size
      FROM timescaledb_information.hypertables h
      LEFT JOIN timescaledb_information.compression_stats c ON h.hypertable_name = c.hypertable_name
    `;

    const continuousAggregateStats = await this.sql`
      SELECT 
        view_name,
        refresh_lag,
        last_run_status,
        last_run_duration
      FROM timescaledb_information.continuous_aggregates ca
      LEFT JOIN timescaledb_information.jobs j ON ca.view_name = j.hypertable_name
    `;

    return {
      hypertables: hypertableStats,
      continuousAggregates: continuousAggregateStats,
      timestamp: Date.now()
    };
  }

  // =====================================================================
  // HELPER METHODS
  // =====================================================================

  private getPeriodHours(period: string): number | null {
    const periodMap: { [key: string]: number } = {
      '1h': 1,
      '24h': 24,
      '7d': 24 * 7,
      '30d': 24 * 30,
      '90d': 24 * 90,
      '1y': 24 * 365,
    };
    return periodMap[period] || null;
  }

  private getTimeBucketInterval(interval: string): string {
    const intervalMap: { [key: string]: string } = {
      '1m': '1 minute',
      '5m': '5 minutes',
      '15m': '15 minutes',
      '30m': '30 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '12h': '12 hours',
      '1d': '1 day',
      'hourly': '1 hour',
      'daily': '1 day',
      'weekly': '1 week',
      'monthly': '1 month'
    };
    return intervalMap[interval] || '1 hour';
  }

  private getTradeSizeFilter(tradeSize?: string) {
    if (!tradeSize || tradeSize === 'all') return this.sql``;
    
    switch (tradeSize) {
      case 'small':
        return this.sql`AND t.size * t.price < 1000`;
      case 'medium':
        return this.sql`AND t.size * t.price >= 1000 AND t.size * t.price < 10000`;
      case 'large':
        return this.sql`AND t.size * t.price >= 10000`;
      default:
        return this.sql``;
    }
  }

  // Fallback method for raw data queries (when continuous aggregates don't fit)
  private async getVolumeTimeSeriesRaw(period: string, interval: string, symbol?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? new Date(Date.now() - (hours * 60 * 60 * 1000)) : new Date('1970-01-01');

    const data = await this.sql`
      SELECT 
        time_bucket(${this.getTimeBucketInterval(interval)}, timestamp) as timestamp,
        time_bucket(${this.getTimeBucketInterval(interval)}, timestamp)::date as date,
        COUNT(*) as trade_count,
        SUM(size * price) as volume,
        AVG(size * price) as avg_trade_size,
        MIN(price) as min_price,
        MAX(price) as max_price,
        FIRST(price, timestamp) as open_price,
        LAST(price, timestamp) as close_price
      FROM order_book_trades t
      ${symbol ? this.sql`JOIN symbols s ON t.pool_id = s.pool_id WHERE s.symbol = ${symbol} AND` : this.sql`WHERE`}
      timestamp >= ${fromTime}
      GROUP BY time_bucket(${this.getTimeBucketInterval(interval)}, timestamp)
      ORDER BY timestamp DESC
    `;

    return { data };
  }

  async close() {
    await this.sql.end();
  }
}