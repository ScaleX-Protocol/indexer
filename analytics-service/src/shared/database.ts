import postgres from 'postgres';

export class DatabaseClient {
  public sql: ReturnType<typeof postgres>;
  private static instance: DatabaseClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.sql = postgres(connectionString, {
      max: 10, // More connections for analytics workload
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  // Market analytics queries

  async getSymbolStatsForPeriod(period: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;

    // Simple working query that matches our real data
    if (hours) {
      return await this.sql`
        SELECT 
          p.coin as symbol,
          COALESCE(SUM(CAST(obt.quantity AS DECIMAL) * CAST(obt.price AS DECIMAL)), 0) as total_volume,
          COUNT(obt.id) as total_trades,
          0 as unique_traders,
          COALESCE(MIN(CAST(obt.price AS DECIMAL)), 0) as low_price,
          COALESCE(MAX(CAST(obt.price AS DECIMAL)), 0) as high_price,
          COALESCE(AVG(CAST(obt.price AS DECIMAL)), 0) as avg_price
        FROM pools p
        LEFT JOIN order_book_trades obt ON p.order_book = obt.pool_id AND obt.timestamp >= ${fromTime}
        GROUP BY p.coin, p.order_book
        HAVING COUNT(obt.id) > 0
        ORDER BY total_volume DESC
      `;
    } else {
      return await this.sql`
        SELECT 
          p.coin as symbol,
          COALESCE(SUM(CAST(obt.quantity AS DECIMAL) * CAST(obt.price AS DECIMAL)), 0) as total_volume,
          COUNT(obt.id) as total_trades,
          0 as unique_traders,
          COALESCE(MIN(CAST(obt.price AS DECIMAL)), 0) as low_price,
          COALESCE(MAX(CAST(obt.price AS DECIMAL)), 0) as high_price,
          COALESCE(AVG(CAST(obt.price AS DECIMAL)), 0) as avg_price
        FROM pools p
        LEFT JOIN order_book_trades obt ON p.order_book = obt.pool_id
        GROUP BY p.coin, p.order_book
        HAVING COUNT(obt.id) > 0
        ORDER BY total_volume DESC
      `;
    }
  }

  async getPools() {
    return await this.sql`
      SELECT * FROM pools
      ORDER BY coin
    `;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }


  async getHourlyTradingStats(hourStart: number, hourEnd: number) {
    return await this.sql`
      SELECT 
        p.coin as symbol,
        COALESCE(SUM(t.quantity * t.price), 0) as volume_1h,
        COUNT(t.id) as trades_1h,
        COUNT(DISTINCT t.user) as unique_traders_1h,
        COALESCE(AVG(t.price), 0) as avg_price_1h,
        COALESCE(MIN(t.price), 0) as low_1h,
        COALESCE(MAX(t.price), 0) as high_1h,
        COALESCE(
          (SELECT price FROM order_book_trades tt 
           WHERE tt.pool_id = p.order_book AND tt.timestamp >= ${hourStart} AND tt.timestamp < ${hourEnd}
           ORDER BY tt.timestamp ASC LIMIT 1), 0
        ) as open_1h,
        COALESCE(
          (SELECT price FROM order_book_trades tt 
           WHERE tt.pool_id = p.order_book AND tt.timestamp >= ${hourStart} AND tt.timestamp < ${hourEnd}
           ORDER BY tt.timestamp DESC LIMIT 1), 0
        ) as close_1h
      FROM pools p
      LEFT JOIN order_book_trades t ON p.order_book = t.pool_id 
        AND t.timestamp >= ${hourStart} AND t.timestamp < ${hourEnd}
      GROUP BY p.coin, p.order_book
      HAVING COUNT(t.id) > 0
      ORDER BY volume_1h DESC
    `;
  }

  async saveHourlyMetrics(hourlyStats: any[], timestamp: number) {
    if (hourlyStats.length === 0) return;
    
    const metricsData = hourlyStats.map(stat => ({
      symbol: stat.symbol,
      timestamp,
      volume: stat.volume_1h,
      trades: stat.trades_1h,
      unique_traders: stat.unique_traders_1h,
      avg_price: stat.avg_price_1h,
      high: stat.high_1h,
      low: stat.low_1h,
      open: stat.open_1h,
      close: stat.close_1h
    }));

    return await this.sql`
      INSERT INTO hourly_metrics ${this.sql(metricsData)}
      ON CONFLICT (symbol, timestamp) DO UPDATE SET
        volume = EXCLUDED.volume,
        trades = EXCLUDED.trades,
        unique_traders = EXCLUDED.unique_traders,
        avg_price = EXCLUDED.avg_price,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        open = EXCLUDED.open,
        close = EXCLUDED.close
    `;
  }


  async getPriceHistory(symbol: string, hours: number = 24) {
    const fromTimestamp = Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000);
    
    return await this.sql`
      SELECT timestamp, open, high, low, close, volume, trades
      FROM hourly_metrics
      WHERE symbol = ${symbol} AND timestamp >= ${fromTimestamp}
      ORDER BY timestamp ASC
    `;
  }

  // Leaderboard methods
  async saveLeaderboardSnapshots(snapshots: any[]) {
    if (snapshots.length === 0) return;
    
    return await this.sql`
      INSERT INTO leaderboard_snapshots ${this.sql(snapshots)}
      ON CONFLICT (user_id, leaderboard_type, period, calculation_timestamp) DO UPDATE SET
        value = EXCLUDED.value,
        percentage = EXCLUDED.percentage,
        portfolio_value = EXCLUDED.portfolio_value,
        rank_position = EXCLUDED.rank_position,
        total_participants = EXCLUDED.total_participants
    `;
  }



  // User positions management (Binance-aligned)
  async upsertUserPosition(userId: string, symbol: string, positionData: any) {
    return await this.sql`
      INSERT INTO user_positions (
        user_id, symbol, quantity, total_cost, avg_cost,
        realized_pnl, trade_count, last_trade_time, updated_at
      ) VALUES (
        ${userId}, ${symbol}, ${positionData.quantity}, ${positionData.totalCost},
        ${positionData.avgCost}, ${positionData.realizedPnl}, 
        ${positionData.tradeCount || 1}, ${positionData.lastTradeTime}, 
        EXTRACT(EPOCH FROM NOW())
      )
      ON CONFLICT (user_id, symbol) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        total_cost = EXCLUDED.total_cost,
        avg_cost = EXCLUDED.avg_cost,
        realized_pnl = EXCLUDED.realized_pnl,
        trade_count = EXCLUDED.trade_count,
        last_trade_time = EXCLUDED.last_trade_time,
        updated_at = EXCLUDED.updated_at
    `;
  }



  // Leaderboard metadata management





  // Growth and Activity Analytics Methods

  async getCumulativeNewUsers(period: string, interval: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    const intervalSeconds = this.getIntervalSeconds(interval);
    
    const data = await this.sql`
      WITH user_first_trades AS (
        SELECT 
          o.user,
          MIN(obt.timestamp) as first_trade_time
        FROM order_book_trades obt
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE ${hours ? `obt.timestamp >= ${fromTime}` : '1=1'}
        GROUP BY o.user
      ),
      time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}'
          ) as period_start
      ),
      user_counts AS (
        SELECT 
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          COUNT(uft.user) FILTER (WHERE uft.first_trade_time >= EXTRACT(epoch FROM ts.period_start) 
            AND uft.first_trade_time < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')) as new_users
        FROM time_series ts
        LEFT JOIN user_first_trades uft ON uft.first_trade_time >= EXTRACT(epoch FROM ts.period_start)
        GROUP BY ts.period_start
        ORDER BY ts.period_start
      )
      SELECT 
        timestamp,
        date,
        new_users,
        SUM(new_users) OVER (ORDER BY timestamp) as cumulative_users,
        CASE 
          WHEN LAG(SUM(new_users) OVER (ORDER BY timestamp)) OVER (ORDER BY timestamp) > 0
          THEN ROUND(((SUM(new_users) OVER (ORDER BY timestamp) - LAG(SUM(new_users) OVER (ORDER BY timestamp)) OVER (ORDER BY timestamp)) * 100.0 / LAG(SUM(new_users) OVER (ORDER BY timestamp)) OVER (ORDER BY timestamp)), 2)
          ELSE 0
        END as growth_rate
      FROM user_counts
    `;

    // Get summary data
    const summaryResult = await this.sql`
      WITH user_first_trades AS (
        SELECT 
          o.user,
          MIN(obt.timestamp) as first_trade_time
        FROM order_book_trades obt
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        GROUP BY o.user
      ),
      period_users AS (
        SELECT COUNT(*) as new_users_in_period
        FROM user_first_trades
        WHERE first_trade_time >= ${fromTime}
      )
      SELECT 
        (SELECT COUNT(DISTINCT o.user) FROM orders o) as total_users,
        pu.new_users_in_period,
        CASE WHEN ${period} != 'all' 
        THEN pu.new_users_in_period / GREATEST(1, ${hours === 24 ? 1 : hours ? Math.floor(hours / 24) : 30})
        ELSE 0 END as avg_daily_growth,
        CASE WHEN (SELECT COUNT(DISTINCT o.user) FROM orders o WHERE o.timestamp < ${fromTime}) > 0
        THEN ROUND((pu.new_users_in_period * 100.0 / (SELECT COUNT(DISTINCT o.user) FROM orders o WHERE o.timestamp < ${fromTime})), 2)
        ELSE 0 END as growth_rate
      FROM period_users pu
    `;

    return {
      data,
      summary: summaryResult[0]
    };
  }

  async getTradesCountAnalytics(period: string, interval: string, symbol?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Define interval string for SQL
    const intervalStr = interval === 'hourly' ? '1 hour' : 
                       interval === 'daily' ? '1 day' : 
                       interval === 'weekly' ? '1 week' : '1 month';

    let data;
    if (symbol) {
      data = await this.sql`
        WITH time_series AS (
          SELECT 
            generate_series(
              to_timestamp(${fromTime}),
              CURRENT_TIMESTAMP,
              interval '1 hour'
            ) as period_start
        ),
        trade_stats AS (
          SELECT 
            EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
            ts.period_start::date as date,
            COUNT(obt.id) as trade_count,
            COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as volume,
            COALESCE(AVG(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as avg_trade_size,
            COUNT(DISTINCT CASE WHEN o.user IS NOT NULL THEN o.user END) as unique_traders
          FROM time_series ts
          LEFT JOIN order_book_trades obt ON obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval ${intervalStr})
          LEFT JOIN pools p ON obt.pool_id = p.order_book
          LEFT JOIN orders o ON obt.pool_id = o.pool_id
          WHERE p.coin = ${symbol}
          GROUP BY ts.period_start
          ORDER BY ts.period_start
        )
        SELECT * FROM trade_stats
      `;
    } else {
      data = await this.sql`
        WITH time_series AS (
          SELECT 
            generate_series(
              to_timestamp(${fromTime}),
              CURRENT_TIMESTAMP,
              interval '1 hour'
            ) as period_start
        ),
        trade_stats AS (
          SELECT 
            EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
            ts.period_start::date as date,
            COUNT(obt.id) as trade_count,
            COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as volume,
            COALESCE(AVG(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as avg_trade_size,
            COUNT(DISTINCT CASE WHEN o.user IS NOT NULL THEN o.user END) as unique_traders
          FROM time_series ts
          LEFT JOIN order_book_trades obt ON obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval ${intervalStr})
          LEFT JOIN orders o ON obt.pool_id = o.pool_id
          GROUP BY ts.period_start
          ORDER BY ts.period_start
        )
        SELECT * FROM trade_stats
      `;
    }

    // Get summary
    let summaryResult;
    if (symbol) {
      summaryResult = await this.sql`
        SELECT 
          COUNT(obt.id) as total_trades,
          COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as total_volume,
          CASE WHEN ${period} != 'all' 
          THEN COUNT(obt.id) / GREATEST(1, ${hours === 24 ? 1 : hours ? Math.floor(hours / 24) : 30})
          ELSE 0 END as avg_daily_trades,
          COALESCE(MAX(daily_trades.trade_count), 0) as peak_daily_trades
        FROM order_book_trades obt
        LEFT JOIN pools p ON obt.pool_id = p.order_book
        LEFT JOIN orders o ON obt.pool_id = o.pool_id
        WHERE obt.timestamp >= ${fromTime} AND p.coin = ${symbol}
        CROSS JOIN (
          SELECT COALESCE(COUNT(*), 0) as trade_count
          FROM order_book_trades obt2
          WHERE obt2.timestamp >= ${fromTime}
          GROUP BY DATE(to_timestamp(obt2.timestamp))
          ORDER BY trade_count DESC
          LIMIT 1
        ) daily_trades
      `;
    } else {
      summaryResult = await this.sql`
        SELECT 
          COUNT(obt.id) as total_trades,
          COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as total_volume,
          CASE WHEN ${period} != 'all' 
          THEN COUNT(obt.id) / GREATEST(1, ${hours === 24 ? 1 : hours ? Math.floor(hours / 24) : 30})
          ELSE 0 END as avg_daily_trades,
          COALESCE(MAX(daily_trades.trade_count), 0) as peak_daily_trades
        FROM order_book_trades obt
        LEFT JOIN orders o ON obt.pool_id = o.pool_id
        WHERE obt.timestamp >= ${fromTime}
        CROSS JOIN (
          SELECT COALESCE(COUNT(*), 0) as trade_count
          FROM order_book_trades obt2
          WHERE obt2.timestamp >= ${fromTime}
          GROUP BY DATE(to_timestamp(obt2.timestamp))
          ORDER BY trade_count DESC
          LIMIT 1
        ) daily_trades
      `;
    }

    return {
      data,
      summary: summaryResult[0]
    };
  }

  async getInflowsAnalytics(period: string, interval: string, currency: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;

    // For DEX, inflows can be measured by deposit events and new trading activity
    const data = await this.sql`
      WITH time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}'
          ) as period_start
      ),
      inflow_stats AS (
        SELECT 
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          -- Calculate deposits (assuming balance increases = deposits)
          COALESCE(SUM(
            CASE WHEN b.amount > LAG(b.amount, 1, 0) OVER (PARTITION BY b.user ORDER BY ts.period_start)
            THEN CAST(b.amount - LAG(b.amount, 1, 0) OVER (PARTITION BY b.user ORDER BY ts.period_start) AS DECIMAL)
            ELSE 0 END
          ), 0) as deposits,
          -- Trading volume as capital flow
          COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as trading_volume,
          COUNT(DISTINCT b.user) as unique_depositors
        FROM time_series ts
        LEFT JOIN balances b ON b.id IS NOT NULL -- Approximation for balance changes
        LEFT JOIN order_book_trades obt ON obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
          AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
        GROUP BY ts.period_start
        ORDER BY ts.period_start
      )
      SELECT 
        timestamp,
        date,
        deposits + trading_volume as total_inflow,
        deposits,
        trading_volume,
        deposits - LAG(deposits, 1, 0) OVER (ORDER BY timestamp) as net_flow,
        unique_depositors
      FROM inflow_stats
    `;

    // Get summary
    const summaryResult = await this.sql`
      SELECT 
        SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)) as total_inflows,
        AVG(daily_volume.volume) as avg_daily_inflow,
        MAX(daily_volume.volume) as peak_daily_inflow,
        CASE 
          WHEN AVG(daily_volume.volume) > LAG(AVG(daily_volume.volume)) OVER (ORDER BY 1) THEN 'positive'
          WHEN AVG(daily_volume.volume) < LAG(AVG(daily_volume.volume)) OVER (ORDER BY 1) THEN 'negative'
          ELSE 'neutral'
        END as net_inflow_trend
      FROM order_book_trades obt
      WHERE obt.timestamp >= ${fromTime}
      CROSS JOIN (
        SELECT 
          DATE(to_timestamp(obt2.timestamp)) as trade_date,
          SUM(CAST(obt2.price AS DECIMAL) * CAST(obt2.quantity AS DECIMAL)) as volume
        FROM order_book_trades obt2
        WHERE obt2.timestamp >= ${fromTime}
        GROUP BY DATE(to_timestamp(obt2.timestamp))
      ) daily_volume
    `;

    return {
      data,
      summary: summaryResult[0]
    };
  }

  async getUniqueTraders(period: string, interval: string, minTrades: number) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;

    const data = await this.sql`
      WITH time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}'
          ) as period_start
      ),
      trader_stats AS (
        SELECT 
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
          ) as unique_traders,
          -- New traders (first time trading in this period)
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
            AND NOT EXISTS (
              SELECT 1 FROM order_book_trades obt2 
              INNER JOIN orders o2 ON obt2.pool_id = o2.pool_id 
              WHERE o2.user = o.user AND obt2.timestamp < EXTRACT(epoch FROM ts.period_start)
            )
          ) as new_traders,
          -- Returning traders
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
            AND EXISTS (
              SELECT 1 FROM order_book_trades obt2 
              INNER JOIN orders o2 ON obt2.pool_id = o2.pool_id 
              WHERE o2.user = o.user AND obt2.timestamp < EXTRACT(epoch FROM ts.period_start)
            )
          ) as returning_traders
        FROM time_series ts
        LEFT JOIN order_book_trades obt ON TRUE
        LEFT JOIN orders o ON obt.pool_id = o.pool_id
        GROUP BY ts.period_start
        HAVING COUNT(DISTINCT obt.id) >= ${minTrades} OR COUNT(DISTINCT obt.id) = 0
        ORDER BY ts.period_start
      )
      SELECT 
        timestamp,
        date,
        unique_traders,
        new_traders,
        returning_traders,
        CASE WHEN unique_traders > 0 
        THEN ROUND((returning_traders * 100.0 / unique_traders), 2)
        ELSE 0 END as retention_rate
      FROM trader_stats
    `;

    // Get summary
    const summaryResult = await this.sql`
      WITH trader_activity AS (
        SELECT 
          o.user,
          COUNT(DISTINCT obt.id) as trade_count,
          COUNT(DISTINCT DATE(to_timestamp(obt.timestamp))) as active_days
        FROM order_book_trades obt
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE ${hours ? `obt.timestamp >= ${fromTime}` : '1=1'}
        GROUP BY o.user
        HAVING COUNT(DISTINCT obt.id) >= ${minTrades}
      )
      SELECT 
        COUNT(DISTINCT user) as total_unique_traders,
        AVG(active_days) as avg_daily_active_traders,
        MAX(daily_traders.trader_count) as peak_daily_traders,
        AVG(CASE WHEN active_days > 1 THEN 1.0 ELSE 0.0 END) * 100 as overall_retention_rate
      FROM trader_activity
      CROSS JOIN (
        SELECT COUNT(DISTINCT o.user) as trader_count
        FROM order_book_trades obt
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE obt.timestamp >= ${fromTime}
        GROUP BY DATE(to_timestamp(obt.timestamp))
        ORDER BY trader_count DESC
        LIMIT 1
      ) daily_traders
    `;

    return {
      data,
      summary: summaryResult[0]
    };
  }

  async getSlippageAnalytics(period: string, interval: string, symbol?: string, tradeSize?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    let symbolCondition = '';
    if (symbol) {
      symbolCondition = `AND p.coin = '${symbol}'`;
    }

    let sizeCondition = '';
    if (tradeSize && tradeSize !== 'all') {
      // Define trade size thresholds (in USD equivalent)
      const thresholds = {
        small: { min: 0, max: 1000 },
        medium: { min: 1000, max: 10000 },
        large: { min: 10000, max: Number.MAX_SAFE_INTEGER }
      };
      const threshold = thresholds[tradeSize as keyof typeof thresholds];
      if (threshold) {
        sizeCondition = `AND (CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)) BETWEEN ${threshold.min} AND ${threshold.max}`;
      }
    }

    // Slippage calculation: compare execution price to mid-market price at time of trade
    const data = await this.sql`
      WITH time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${interval === '5min' ? '5 minutes' : interval === 'hourly' ? '1 hour' : '1 day'}'
          ) as period_start
      ),
      trade_slippage AS (
        SELECT 
          obt.timestamp,
          obt.price as execution_price,
          -- Approximate mid-market price using average of nearby trades
          AVG(CAST(obt2.price AS DECIMAL)) OVER (
            PARTITION BY obt.pool_id 
            ORDER BY obt2.timestamp 
            RANGE BETWEEN INTERVAL '1 minute' PRECEDING AND INTERVAL '1 minute' FOLLOWING
          ) as mid_price,
          CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL) as trade_value,
          obt.side
        FROM order_book_trades obt
        INNER JOIN order_book_trades obt2 ON obt.pool_id = obt2.pool_id
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        ${symbol ? this.sql`INNER JOIN pools p ON o.pool_id = p.order_book` : this.sql``}
        WHERE obt.timestamp >= ${fromTime}
        ${this.sql.unsafe(symbolCondition)}
        ${this.sql.unsafe(sizeCondition)}
      ),
      slippage_stats AS (
        SELECT 
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          AVG(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as avg_slippage,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as median_slippage,
          MAX(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as max_slippage,
          STDDEV(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as slippage_std_dev,
          COUNT(*) as trade_count,
          COUNT(*) FILTER (WHERE ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price > 0.01) as impacted_trades
        FROM time_series ts
        LEFT JOIN trade_slippage ts_data ON ts_data.timestamp >= EXTRACT(epoch FROM ts.period_start) 
          AND ts_data.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === '5min' ? '5 minutes' : interval === 'hourly' ? '1 hour' : '1 day'}')
        GROUP BY ts.period_start
        ORDER BY ts.period_start
      )
      SELECT 
        timestamp,
        date,
        ROUND(COALESCE(avg_slippage, 0), 4) as avg_slippage,
        ROUND(COALESCE(median_slippage, 0), 4) as median_slippage,
        ROUND(COALESCE(max_slippage, 0), 4) as max_slippage,
        ROUND(COALESCE(slippage_std_dev, 0), 4) as slippage_std_dev,
        trade_count,
        impacted_trades,
        CASE WHEN trade_count > 0 
        THEN ROUND((impacted_trades * 100.0 / trade_count), 2)
        ELSE 0 END as impact_rate
      FROM slippage_stats
    `;

    // Get summary and quality assessment
    const summaryResult = await this.sql`
      WITH all_slippage AS (
        SELECT 
          ABS(CAST(obt.price AS DECIMAL) - avg_price.mid_price) / avg_price.mid_price * 100 as slippage_pct
        FROM order_book_trades obt
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        ${symbol ? this.sql`INNER JOIN pools p ON o.pool_id = p.order_book` : this.sql``}
        CROSS JOIN (
          SELECT AVG(CAST(price AS DECIMAL)) as mid_price 
          FROM order_book_trades 
          WHERE timestamp >= ${fromTime}
        ) avg_price
        WHERE obt.timestamp >= ${fromTime}
        ${this.sql.unsafe(symbolCondition)}
        ${this.sql.unsafe(sizeCondition)}
      )
      SELECT 
        ROUND(AVG(slippage_pct), 4) as avg_slippage,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY slippage_pct), 4) as median_slippage,
        CASE 
          WHEN AVG(slippage_pct) < 0.1 THEN 'excellent'
          WHEN AVG(slippage_pct) < 0.5 THEN 'good'
          WHEN AVG(slippage_pct) < 1.0 THEN 'fair'
          ELSE 'poor'
        END as slippage_quality,
        ROUND((COUNT(*) FILTER (WHERE slippage_pct > 1.0) * 100.0 / COUNT(*)), 2) as impact_rate,
        CASE 
          WHEN AVG(slippage_pct) < 0.2 THEN 95
          WHEN AVG(slippage_pct) < 0.5 THEN 85
          WHEN AVG(slippage_pct) < 1.0 THEN 70
          ELSE 50
        END as liquidity_score
      FROM all_slippage
    `;

    const summary = summaryResult[0];
    const insights = {
      description: summary?.slippage_quality === 'excellent' 
        ? 'Market showing excellent liquidity with minimal slippage'
        : summary?.slippage_quality === 'good'
        ? 'Market showing good liquidity conditions'
        : summary?.slippage_quality === 'fair'
        ? 'Market showing moderate slippage, monitor large trades'
        : 'Market showing high slippage, consider improving liquidity',
      recommendation: summary?.avg_slippage > 1.0
        ? 'Consider incentivizing market makers to improve liquidity'
        : 'Monitor large trade slippage and maintain current liquidity levels'
    };

    return {
      data,
      summary,
      insights
    };
  }

  private getPeriodHours(period: string): number | null {
    switch (period) {
      case '1h': return 1;
      case '24h': return 24;
      case '7d': return 168;
      case '30d': return 720;
      case '90d': return 2160;
      case '1y': return 8760;
      case 'all': return null;
      default: return 24;
    }
  }

  private getIntervalSeconds(interval: string): number {
    switch (interval) {
      case 'hourly': return 3600;
      case 'daily': return 86400;
      case 'weekly': return 604800;
      case 'monthly': return 2592000;
      default: return 86400;
    }
  }

  // Symbol Volume Time-Series Methods
  async getSymbolVolumeTimeSeries(period: string, interval: string, symbols?: string[]) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const symbolList = symbols.map(s => `'${s}'`).join(',');
      symbolFilter = `AND p.coin IN (${symbolList})`;
    }

    const intervalSQL = interval === 'hourly' ? '1 hour' : 
                       interval === 'daily' ? '1 day' : 
                       interval === 'weekly' ? '1 week' : 
                       interval === 'monthly' ? '1 month' : '1 hour';

    return await this.sql`
      WITH time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${intervalSQL}'
          ) as period_start
      ),
      symbol_volume_by_time AS (
        SELECT 
          p.coin as symbol,
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as volume,
          COUNT(obt.id) as trades,
          COUNT(DISTINCT CASE WHEN o.user IS NOT NULL THEN o.user END) as unique_traders,
          COALESCE(AVG(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as avg_trade_size
        FROM time_series ts
        LEFT JOIN order_book_trades obt ON 
          obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
          AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${intervalSQL}')
        LEFT JOIN pools p ON obt.pool_id = p.order_book
        LEFT JOIN orders o ON obt.pool_id = o.pool_id
        WHERE p.coin IS NOT NULL ${this.sql.unsafe(symbolFilter)}
        GROUP BY p.coin, ts.period_start
        ORDER BY p.coin, ts.period_start
      )
      SELECT 
        symbol,
        timestamp,
        date,
        volume,
        trades,
        unique_traders,
        avg_trade_size
      FROM symbol_volume_by_time
      WHERE volume > 0 OR trades > 0
    `;
  }

  async getSymbolVolumeSummary(period: string, symbols?: string[]) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const symbolList = symbols.map(s => `'${s}'`).join(',');
      symbolFilter = `AND p.coin IN (${symbolList})`;
    }

    return await this.sql`
      SELECT 
        p.coin as symbol,
        COALESCE(SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as total_volume,
        COUNT(obt.id) as total_trades,
        COUNT(DISTINCT CASE WHEN o.user IS NOT NULL THEN o.user END) as unique_traders,
        COALESCE(AVG(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as avg_trade_size,
        COALESCE(MAX(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)), 0) as largest_trade,
        MIN(obt.timestamp) as first_trade_time,
        MAX(obt.timestamp) as last_trade_time
      FROM order_book_trades obt
      LEFT JOIN pools p ON obt.pool_id = p.order_book
      LEFT JOIN orders o ON obt.pool_id = o.pool_id
      WHERE ${hours ? `obt.timestamp >= ${fromTime}` : '1=1'}
        AND p.coin IS NOT NULL
        ${this.sql.unsafe(symbolFilter)}
      GROUP BY p.coin
      HAVING SUM(CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)) > 0
      ORDER BY total_volume DESC
    `;
  }

  // Real Order Book Depth Methods
  async getOrderBookDepth() {
    return await this.sql`
      SELECT 
        pool_id,
        side,
        price,
        quantity,
        order_count,
        last_updated
      FROM order_book_depth
      ORDER BY pool_id, side, price DESC
    `;
  }


  async getTradesForLiquidity(fromTime: number) {
    return await this.sql`
      SELECT 
        pool_id,
        price,
        quantity,
        side,
        timestamp
      FROM order_book_trades
      WHERE timestamp >= ${fromTime}
      ORDER BY pool_id, timestamp DESC
    `;
  }

  async getOrderBookDepthByPool(poolId: string) {
    return await this.sql`
      SELECT 
        side,
        price,
        quantity,
        order_count,
        last_updated
      FROM order_book_depth
      WHERE pool_id = ${poolId}
      ORDER BY side, price DESC
    `;
  }

  async getCurrentSpread(poolId: string) {
    return await this.sql`
      SELECT 
        MAX(CASE WHEN side = 'buy' THEN price END) as best_bid,
        MIN(CASE WHEN side = 'sell' THEN price END) as best_ask
      FROM order_book_depth
      WHERE pool_id = ${poolId}
        AND quantity > 0
    `;
  }

  // Symbol liquidity time-series methods removed - order book snapshots no longer available

  // Symbol slippage time-series methods for enhanced analytics
  async getSymbolSlippageTimeSeries(period: string, interval: string, symbols?: string[], tradeSize?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Generate time series based on interval
    const intervalSeconds = this.getIntervalSeconds(interval);
    
    // Build symbol filter
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const poolIds = await this.sql`
        SELECT id FROM pools WHERE coin = ANY(${symbols})
      `;
      const poolIdsList = poolIds.map(p => p.id);
      if (poolIdsList.length > 0) {
        symbolFilter = `AND obt.pool_id = ANY(${poolIdsList})`;
      }
    }

    // Build trade size filter
    let sizeCondition = '';
    if (tradeSize && tradeSize !== 'all') {
      const thresholds = {
        small: { min: 0, max: 1000 },
        medium: { min: 1000, max: 10000 },
        large: { min: 10000, max: Number.MAX_SAFE_INTEGER }
      };
      const threshold = thresholds[tradeSize as keyof typeof thresholds];
      if (threshold) {
        sizeCondition = `AND (CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)) BETWEEN ${threshold.min} AND ${threshold.max}`;
      }
    }

    return await this.sql`
      WITH time_series AS (
        SELECT generate_series(
          ${fromTime}::bigint,
          EXTRACT(EPOCH FROM NOW())::bigint,
          ${intervalSeconds}
        ) AS timestamp
      ),
      trade_slippage AS (
        SELECT 
          obt.timestamp,
          p.coin as symbol,
          obt.pool_id,
          CAST(obt.price AS DECIMAL) as execution_price,
          -- Approximate mid-market price using average of nearby trades
          AVG(CAST(obt2.price AS DECIMAL)) OVER (
            PARTITION BY obt.pool_id 
            ORDER BY obt2.timestamp 
            RANGE BETWEEN INTERVAL '1 minute' PRECEDING AND INTERVAL '1 minute' FOLLOWING
          ) as mid_price,
          CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL) as trade_value,
          obt.side,
          obt.quantity
        FROM order_book_trades obt
        INNER JOIN order_book_trades obt2 ON obt.pool_id = obt2.pool_id
        INNER JOIN pools p ON obt.pool_id = p.id
        WHERE obt.timestamp >= ${fromTime}
          ${symbolFilter ? this.sql.unsafe(symbolFilter) : this.sql``}
          ${sizeCondition ? this.sql.unsafe(sizeCondition) : this.sql``}
      ),
      slippage_by_symbol AS (
        SELECT 
          ts.timestamp,
          TO_TIMESTAMP(ts.timestamp)::date as date,
          ts_data.symbol,
          ts_data.pool_id,
          AVG(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as avg_slippage,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as median_slippage,
          MAX(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as max_slippage,
          STDDEV(ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price * 100) as slippage_std_dev,
          COUNT(*) as trade_count,
          COUNT(*) FILTER (WHERE ABS(ts_data.execution_price - ts_data.mid_price) / ts_data.mid_price > 0.01) as impacted_trades,
          AVG(ts_data.trade_value) as avg_trade_value,
          COUNT(DISTINCT CASE WHEN ts_data.side = 'buy' THEN 1 END) as buy_trades,
          COUNT(DISTINCT CASE WHEN ts_data.side = 'sell' THEN 1 END) as sell_trades
        FROM time_series ts
        LEFT JOIN trade_slippage ts_data ON (
          ts_data.timestamp >= ts.timestamp 
          AND ts_data.timestamp < ts.timestamp + ${intervalSeconds}
        )
        WHERE ts_data.symbol IS NOT NULL
        GROUP BY ts.timestamp, ts_data.symbol, ts_data.pool_id
      )
      SELECT 
        timestamp,
        date,
        symbol,
        pool_id,
        ROUND(COALESCE(avg_slippage, 0), 4) as avg_slippage,
        ROUND(COALESCE(median_slippage, 0), 4) as median_slippage,
        ROUND(COALESCE(max_slippage, 0), 4) as max_slippage,
        ROUND(COALESCE(slippage_std_dev, 0), 4) as slippage_std_dev,
        trade_count,
        impacted_trades,
        CASE WHEN trade_count > 0 
        THEN ROUND((impacted_trades * 100.0 / trade_count), 2)
        ELSE 0 END as impact_rate,
        ROUND(COALESCE(avg_trade_value, 0), 2) as avg_trade_value,
        buy_trades,
        sell_trades,
        CASE 
          WHEN avg_slippage < 0.1 THEN 'excellent'
          WHEN avg_slippage < 0.5 THEN 'good'
          WHEN avg_slippage < 1.0 THEN 'fair'
          ELSE 'poor'
        END as slippage_quality
      FROM slippage_by_symbol
      ORDER BY symbol, timestamp
    `;
  }

  async getSymbolSlippageSummary(period: string, symbols?: string[], tradeSize?: string) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Build symbol filter
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const poolIds = await this.sql`
        SELECT id FROM pools WHERE coin = ANY(${symbols})
      `;
      const poolIdsList = poolIds.map(p => p.id);
      if (poolIdsList.length > 0) {
        symbolFilter = `AND obt.pool_id = ANY(${poolIdsList})`;
      }
    }

    // Build trade size filter
    let sizeCondition = '';
    if (tradeSize && tradeSize !== 'all') {
      const thresholds = {
        small: { min: 0, max: 1000 },
        medium: { min: 1000, max: 10000 },
        large: { min: 10000, max: Number.MAX_SAFE_INTEGER }
      };
      const threshold = thresholds[tradeSize as keyof typeof thresholds];
      if (threshold) {
        sizeCondition = `AND (CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)) BETWEEN ${threshold.min} AND ${threshold.max}`;
      }
    }

    return await this.sql`
      WITH symbol_slippage AS (
        SELECT 
          p.coin as symbol,
          obt.pool_id,
          ABS(CAST(obt.price AS DECIMAL) - avg_price.mid_price) / avg_price.mid_price * 100 as slippage_pct,
          CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL) as trade_value,
          obt.side,
          obt.timestamp
        FROM order_book_trades obt
        INNER JOIN pools p ON obt.pool_id = p.id
        CROSS JOIN (
          SELECT 
            obt2.pool_id,
            AVG(CAST(obt2.price AS DECIMAL)) as mid_price 
          FROM order_book_trades obt2
          WHERE obt2.timestamp >= ${fromTime}
          GROUP BY obt2.pool_id
        ) avg_price ON avg_price.pool_id = obt.pool_id
        WHERE obt.timestamp >= ${fromTime}
          ${symbolFilter ? this.sql.unsafe(symbolFilter) : this.sql``}
          ${sizeCondition ? this.sql.unsafe(sizeCondition) : this.sql``}
      )
      SELECT 
        symbol,
        pool_id,
        ROUND(AVG(slippage_pct), 4) as avg_slippage,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY slippage_pct), 4) as median_slippage,
        ROUND(MAX(slippage_pct), 4) as max_slippage,
        ROUND(STDDEV(slippage_pct), 4) as slippage_std_dev,
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE slippage_pct > 1.0) as impacted_trades,
        ROUND((COUNT(*) FILTER (WHERE slippage_pct > 1.0) * 100.0 / COUNT(*)), 2) as impact_rate,
        ROUND(AVG(trade_value), 2) as avg_trade_value,
        ROUND(MIN(trade_value), 2) as min_trade_value,
        ROUND(MAX(trade_value), 2) as max_trade_value,
        COUNT(*) FILTER (WHERE side = 'buy') as buy_trades,
        COUNT(*) FILTER (WHERE side = 'sell') as sell_trades,
        MIN(timestamp) as first_trade_time,
        MAX(timestamp) as last_trade_time,
        CASE 
          WHEN AVG(slippage_pct) < 0.1 THEN 'excellent'
          WHEN AVG(slippage_pct) < 0.5 THEN 'good'
          WHEN AVG(slippage_pct) < 1.0 THEN 'fair'
          ELSE 'poor'
        END as slippage_quality,
        CASE 
          WHEN AVG(slippage_pct) < 0.2 THEN 95
          WHEN AVG(slippage_pct) < 0.5 THEN 85
          WHEN AVG(slippage_pct) < 1.0 THEN 70
          ELSE 50
        END as liquidity_score
      FROM symbol_slippage
      GROUP BY symbol, pool_id
      ORDER BY avg_slippage ASC
    `;
  }

  // Symbol inflow/outflow time-series methods for enhanced analytics
  async getSymbolInflowTimeSeries(period: string, interval: string, symbols?: string[], currency: string = 'USD') {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Generate time series based on interval
    const intervalSeconds = this.getIntervalSeconds(interval);
    
    // Build symbol filter
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const poolIds = await this.sql`
        SELECT id FROM pools WHERE coin = ANY(${symbols})
      `;
      const poolIdsList = poolIds.map(p => p.id);
      if (poolIdsList.length > 0) {
        symbolFilter = `AND obt.pool_id = ANY(${poolIdsList})`;
      }
    }

    return await this.sql`
      WITH time_series AS (
        SELECT generate_series(
          ${fromTime}::bigint,
          EXTRACT(EPOCH FROM NOW())::bigint,
          ${intervalSeconds}
        ) AS timestamp
      ),
      symbol_flows AS (
        SELECT 
          obt.timestamp,
          p.coin as symbol,
          obt.pool_id,
          CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL) as trade_value,
          obt.side,
          o.user as trader,
          -- Categorize as inflow (buy) or outflow (sell) from market perspective
          CASE 
            WHEN obt.side = 'buy' THEN CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)
            ELSE 0 
          END as inflow_value,
          CASE 
            WHEN obt.side = 'sell' THEN CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)
            ELSE 0 
          END as outflow_value
        FROM order_book_trades obt
        INNER JOIN pools p ON obt.pool_id = p.id
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE obt.timestamp >= ${fromTime}
          ${symbolFilter ? this.sql.unsafe(symbolFilter) : this.sql``}
      ),
      symbol_flow_stats AS (
        SELECT 
          ts.timestamp,
          TO_TIMESTAMP(ts.timestamp)::date as date,
          sf.symbol,
          sf.pool_id,
          SUM(sf.inflow_value) as total_inflow,
          SUM(sf.outflow_value) as total_outflow,
          SUM(sf.trade_value) as total_volume,
          SUM(sf.inflow_value) - SUM(sf.outflow_value) as net_flow,
          COUNT(*) as trade_count,
          COUNT(DISTINCT sf.trader) as unique_traders,
          COUNT(*) FILTER (WHERE sf.side = 'buy') as buy_trades,
          COUNT(*) FILTER (WHERE sf.side = 'sell') as sell_trades,
          AVG(sf.trade_value) as avg_trade_size,
          MIN(sf.trade_value) as min_trade_size,
          MAX(sf.trade_value) as max_trade_size
        FROM time_series ts
        LEFT JOIN symbol_flows sf ON (
          sf.timestamp >= ts.timestamp 
          AND sf.timestamp < ts.timestamp + ${intervalSeconds}
        )
        WHERE sf.symbol IS NOT NULL
        GROUP BY ts.timestamp, sf.symbol, sf.pool_id
      )
      SELECT 
        timestamp,
        date,
        symbol,
        pool_id,
        ROUND(COALESCE(total_inflow, 0), 2) as total_inflow,
        ROUND(COALESCE(total_outflow, 0), 2) as total_outflow,
        ROUND(COALESCE(total_volume, 0), 2) as total_volume,
        ROUND(COALESCE(net_flow, 0), 2) as net_flow,
        trade_count,
        unique_traders,
        buy_trades,
        sell_trades,
        ROUND(COALESCE(avg_trade_size, 0), 2) as avg_trade_size,
        ROUND(COALESCE(min_trade_size, 0), 2) as min_trade_size,
        ROUND(COALESCE(max_trade_size, 0), 2) as max_trade_size,
        CASE 
          WHEN net_flow > total_volume * 0.1 THEN 'strong_inflow'
          WHEN net_flow > 0 THEN 'inflow'
          WHEN net_flow < -total_volume * 0.1 THEN 'strong_outflow'
          WHEN net_flow < 0 THEN 'outflow'
          ELSE 'balanced'
        END as flow_direction
      FROM symbol_flow_stats
      ORDER BY symbol, timestamp
    `;
  }

  async getSymbolInflowSummary(period: string, symbols?: string[], currency: string = 'USD') {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Build symbol filter
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const poolIds = await this.sql`
        SELECT id FROM pools WHERE coin = ANY(${symbols})
      `;
      const poolIdsList = poolIds.map(p => p.id);
      if (poolIdsList.length > 0) {
        symbolFilter = `AND obt.pool_id = ANY(${poolIdsList})`;
      }
    }

    return await this.sql`
      WITH symbol_flows AS (
        SELECT 
          p.coin as symbol,
          obt.pool_id,
          CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL) as trade_value,
          obt.side,
          obt.timestamp,
          o.user as trader,
          CASE 
            WHEN obt.side = 'buy' THEN CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)
            ELSE 0 
          END as inflow_value,
          CASE 
            WHEN obt.side = 'sell' THEN CAST(obt.price AS DECIMAL) * CAST(obt.quantity AS DECIMAL)
            ELSE 0 
          END as outflow_value
        FROM order_book_trades obt
        INNER JOIN pools p ON obt.pool_id = p.id
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE obt.timestamp >= ${fromTime}
          ${symbolFilter ? this.sql.unsafe(symbolFilter) : this.sql``}
      )
      SELECT 
        symbol,
        pool_id,
        ROUND(SUM(inflow_value), 2) as total_inflow,
        ROUND(SUM(outflow_value), 2) as total_outflow,
        ROUND(SUM(trade_value), 2) as total_volume,
        ROUND(SUM(inflow_value) - SUM(outflow_value), 2) as net_flow,
        COUNT(*) as total_trades,
        COUNT(DISTINCT trader) as unique_traders,
        COUNT(*) FILTER (WHERE side = 'buy') as buy_trades,
        COUNT(*) FILTER (WHERE side = 'sell') as sell_trades,
        ROUND(AVG(trade_value), 2) as avg_trade_size,
        ROUND(MIN(trade_value), 2) as min_trade_size,
        ROUND(MAX(trade_value), 2) as max_trade_size,
        MIN(timestamp) as first_trade_time,
        MAX(timestamp) as last_trade_time,
        CASE 
          WHEN SUM(inflow_value) - SUM(outflow_value) > SUM(trade_value) * 0.2 THEN 'strong_inflow'
          WHEN SUM(inflow_value) - SUM(outflow_value) > 0 THEN 'inflow'
          WHEN SUM(inflow_value) - SUM(outflow_value) < -SUM(trade_value) * 0.2 THEN 'strong_outflow'
          WHEN SUM(inflow_value) - SUM(outflow_value) < 0 THEN 'outflow'
          ELSE 'balanced'
        END as flow_direction,
        ROUND(
          (SUM(inflow_value) - SUM(outflow_value)) / NULLIF(SUM(trade_value), 0) * 100, 2
        ) as flow_percentage,
        CASE 
          WHEN COUNT(*) > 1000 THEN 'high'
          WHEN COUNT(*) > 100 THEN 'medium'
          ELSE 'low'
        END as activity_level,
        ROUND(
          SUM(inflow_value) / NULLIF(COUNT(*) FILTER (WHERE side = 'buy'), 0), 2
        ) as avg_inflow_per_trade,
        ROUND(
          SUM(outflow_value) / NULLIF(COUNT(*) FILTER (WHERE side = 'sell'), 0), 2
        ) as avg_outflow_per_trade
      FROM symbol_flows
      GROUP BY symbol, pool_id
      ORDER BY ABS(net_flow) DESC
    `;
  }

  async getSymbolLiquiditySummary(period: string, symbols?: string[]) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    
    // Build symbol filter
    let symbolFilter = '';
    if (symbols && symbols.length > 0) {
      const poolIds = await this.sql`
        SELECT id FROM pools WHERE coin = ANY(${symbols})
      `;
      const poolIdsList = poolIds.map(p => p.id);
      if (poolIdsList.length > 0) {
        symbolFilter = `AND p.id = ANY(${poolIdsList})`;
      }
    }

    return await this.sql`
      WITH current_liquidity AS (
        SELECT DISTINCT ON (d.pool_id, d.side)
          d.pool_id,
          p.coin as symbol,
          d.side,
          d.price,
          d.quantity,
          d.order_count
        FROM order_book_depth d
        JOIN pools p ON d.pool_id = p.id
        WHERE d.quantity > 0
          ${symbolFilter ? this.sql.unsafe(symbolFilter) : this.sql``}
        ORDER BY d.pool_id, d.side, d.price DESC
      ),
      symbol_metrics AS (
        SELECT 
          symbol,
          pool_id,
          SUM(CASE WHEN side = 'buy' THEN price * quantity ELSE 0 END) as bid_depth,
          SUM(CASE WHEN side = 'sell' THEN price * quantity ELSE 0 END) as ask_depth,
          SUM(CASE WHEN side = 'buy' THEN order_count ELSE 0 END) as bid_orders,
          SUM(CASE WHEN side = 'sell' THEN order_count ELSE 0 END) as ask_orders,
          MAX(CASE WHEN side = 'buy' THEN price END) as best_bid,
          MIN(CASE WHEN side = 'sell' THEN price END) as best_ask
        FROM current_liquidity
        GROUP BY symbol, pool_id
      ),
      recent_trades AS (
        SELECT 
          p.coin as symbol,
          COUNT(*) as recent_trades,
          AVG(t.price * t.quantity) as avg_trade_volume,
          MIN(t.timestamp) as first_trade_time,
          MAX(t.timestamp) as last_trade_time
        FROM order_book_trades t
        JOIN pools p ON t.pool_id = p.id
        WHERE t.timestamp >= ${fromTime}
          ${symbolFilter ? this.sql.unsafe(symbolFilter.replace('p.id', 't.pool_id')) : this.sql``}
        GROUP BY p.coin
      )
      SELECT 
        m.symbol,
        m.pool_id,
        m.bid_depth,
        m.ask_depth,
        (m.bid_depth + m.ask_depth) as total_depth,
        m.bid_orders,
        m.ask_orders,
        m.best_bid,
        m.best_ask,
        CASE 
          WHEN m.best_bid > 0 AND m.best_ask > 0 
          THEN ((m.best_ask - m.best_bid) / m.best_bid * 100)
          ELSE 0 
        END as spread_percentage,
        COALESCE(t.recent_trades, 0) as recent_trades,
        COALESCE(t.avg_trade_volume, 0) as avg_trade_volume,
        t.first_trade_time,
        t.last_trade_time
      FROM symbol_metrics m
      LEFT JOIN recent_trades t ON m.symbol = t.symbol
      ORDER BY (m.bid_depth + m.ask_depth) DESC
    `;
  }

  async getSymbolUniqueTraders(period: string, interval: string, symbols?: string[], minTrades: number = 1) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;
    const intervalSeconds = this.getIntervalSeconds(interval);

    const data = await this.sql`
      WITH time_series AS (
        SELECT 
          generate_series(
            to_timestamp(${fromTime}),
            CURRENT_TIMESTAMP,
            interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}'
          ) as period_start
      ),
      symbol_trader_stats AS (
        SELECT 
          EXTRACT(epoch FROM ts.period_start)::bigint as timestamp,
          ts.period_start::date as date,
          s.symbol,
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
          ) as unique_traders,
          -- New traders (first time trading this symbol in this period)
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
            AND NOT EXISTS (
              SELECT 1 FROM order_book_trades obt2 
              INNER JOIN orders o2 ON obt2.pool_id = o2.pool_id 
              INNER JOIN symbols s2 ON o2.pool_id = s2.pool_id
              WHERE o2.user = o.user AND s2.symbol = s.symbol 
              AND obt2.timestamp < EXTRACT(epoch FROM ts.period_start)
            )
          ) as new_traders,
          -- Returning traders  
          COUNT(DISTINCT o.user) FILTER (
            WHERE obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
            AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
            AND EXISTS (
              SELECT 1 FROM order_book_trades obt2 
              INNER JOIN orders o2 ON obt2.pool_id = o2.pool_id 
              INNER JOIN symbols s2 ON o2.pool_id = s2.pool_id
              WHERE o2.user = o.user AND s2.symbol = s.symbol 
              AND obt2.timestamp < EXTRACT(epoch FROM ts.period_start)
            )
          ) as returning_traders,
          COUNT(DISTINCT obt.id) as total_trades,
          SUM(obt.size * obt.price) as total_volume
        FROM time_series ts
        CROSS JOIN (
          SELECT DISTINCT symbol, pool_id FROM symbols 
          ${symbols && symbols.length > 0 ? this.sql`WHERE symbol = ANY(${symbols})` : this.sql``}
        ) s
        LEFT JOIN order_book_trades obt ON obt.pool_id = s.pool_id
          AND obt.timestamp >= EXTRACT(epoch FROM ts.period_start) 
          AND obt.timestamp < EXTRACT(epoch FROM ts.period_start + interval '${interval === 'hourly' ? '1 hour' : interval === 'daily' ? '1 day' : interval === 'weekly' ? '1 week' : '1 month'}')
        LEFT JOIN orders o ON obt.pool_id = o.pool_id
        GROUP BY ts.period_start, s.symbol
        ORDER BY ts.period_start, s.symbol
      )
      SELECT 
        timestamp,
        date,
        symbol,
        unique_traders,
        new_traders,
        returning_traders,
        total_trades,
        total_volume,
        CASE WHEN unique_traders > 0 
        THEN ROUND((returning_traders * 100.0 / unique_traders), 2)
        ELSE 0 END as retention_rate
      FROM symbol_trader_stats
      WHERE unique_traders > 0 OR ${minTrades} = 0
    `;

    return { data };
  }

  async getSymbolUniqueTradersSummary(period: string, symbols?: string[], minTrades: number = 1) {
    const hours = this.getPeriodHours(period);
    const fromTime = hours ? Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000) : 0;

    const data = await this.sql`
      WITH symbol_trader_activity AS (
        SELECT 
          s.symbol,
          s.pool_id,
          o.user,
          COUNT(DISTINCT obt.id) as trade_count,
          COUNT(DISTINCT DATE(to_timestamp(obt.timestamp))) as active_days,
          SUM(obt.size * obt.price) as total_volume,
          MIN(obt.timestamp) as first_trade_time,
          MAX(obt.timestamp) as last_trade_time
        FROM symbols s
        INNER JOIN order_book_trades obt ON obt.pool_id = s.pool_id
        INNER JOIN orders o ON obt.pool_id = o.pool_id
        WHERE ${hours ? this.sql`obt.timestamp >= ${fromTime}` : this.sql`1=1`}
        ${symbols && symbols.length > 0 ? this.sql`AND s.symbol = ANY(${symbols})` : this.sql``}
        GROUP BY s.symbol, s.pool_id, o.user
        HAVING COUNT(DISTINCT obt.id) >= ${minTrades}
      ),
      symbol_metrics AS (
        SELECT 
          symbol,
          pool_id,
          COUNT(DISTINCT user) as unique_traders,
          -- New vs returning traders classification
          COUNT(DISTINCT user) FILTER (
            WHERE first_trade_time >= ${fromTime}
          ) as new_traders_in_period,
          COUNT(DISTINCT user) FILTER (
            WHERE first_trade_time < ${fromTime}
          ) as returning_traders_in_period,
          AVG(active_days) as avg_active_days,
          AVG(trade_count) as avg_trades_per_trader,
          SUM(total_volume) as total_symbol_volume,
          AVG(total_volume) as avg_volume_per_trader,
          MIN(first_trade_time) as symbol_first_trade_time,
          MAX(last_trade_time) as symbol_last_trade_time,
          -- Activity level classification
          CASE 
            WHEN COUNT(DISTINCT user) >= 100 THEN 'very_high'
            WHEN COUNT(DISTINCT user) >= 50 THEN 'high'
            WHEN COUNT(DISTINCT user) >= 20 THEN 'medium'
            WHEN COUNT(DISTINCT user) >= 5 THEN 'low'
            ELSE 'very_low'
          END as activity_level,
          -- Retention assessment
          CASE WHEN COUNT(DISTINCT user) > 0 
          THEN ROUND((COUNT(DISTINCT user) FILTER (WHERE first_trade_time < ${fromTime}) * 100.0 / COUNT(DISTINCT user)), 2)
          ELSE 0 END as retention_rate
        FROM symbol_trader_activity
        GROUP BY symbol, pool_id
      )
      SELECT 
        symbol,
        pool_id,
        unique_traders,
        new_traders_in_period,
        returning_traders_in_period,
        avg_active_days,
        avg_trades_per_trader,
        total_symbol_volume,
        avg_volume_per_trader,
        activity_level,
        retention_rate,
        symbol_first_trade_time,
        symbol_last_trade_time
      FROM symbol_metrics
      ORDER BY unique_traders DESC
    `;

    return data;
  }

  async close() {
    await this.sql.end();
  }
}