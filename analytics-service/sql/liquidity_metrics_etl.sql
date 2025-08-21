-- ==========================================
-- Liquidity Metrics ETL Schema & Processor
-- ==========================================
-- This implements the ETL solution from ETL_OPTIMIZATION_ANALYSIS.md
-- Section 5: Liquidity Depth Processing

-- Create the TimescaleDB table for pre-computed liquidity metrics
CREATE TABLE IF NOT EXISTS liquidity_metrics_processed (
  symbol VARCHAR(50) NOT NULL,
  snapshot_time TIMESTAMPTZ NOT NULL,
  bid_depth DECIMAL(20,8) DEFAULT 0,
  ask_depth DECIMAL(20,8) DEFAULT 0,
  total_depth DECIMAL(20,8) DEFAULT 0,
  best_bid DECIMAL(20,8) DEFAULT 0,
  best_ask DECIMAL(20,8) DEFAULT 0,
  spread_bps DECIMAL(10,4) DEFAULT 0,
  bid_orders INTEGER DEFAULT 0,
  ask_orders INTEGER DEFAULT 0,
  liquidity_score DECIMAL(8,2) DEFAULT 0,
  liquidity_rating VARCHAR(20),
  recent_trades INTEGER DEFAULT 0,
  avg_trade_volume DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, snapshot_time)
);

-- Create hypertable for time-series optimization
SELECT create_hypertable('liquidity_metrics_processed', 'snapshot_time', 
  if_not_exists => true, migrate_data => true);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_liquidity_metrics_symbol_time 
  ON liquidity_metrics_processed (symbol, snapshot_time DESC);

CREATE INDEX IF NOT EXISTS idx_liquidity_metrics_score 
  ON liquidity_metrics_processed (liquidity_score DESC, snapshot_time DESC);

-- ETL Processing Function
CREATE OR REPLACE FUNCTION process_liquidity_metrics()
RETURNS VOID AS $$
BEGIN
  -- Pre-compute liquidity metrics from current order book depth
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
      AVG(t.price * t.quantity) as avg_trade_volume
    FROM order_book_trades t
    JOIN pools p ON t.pool_id = p.id
    WHERE t.timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '5 minutes')
    GROUP BY p.coin
  ),
  liquidity_calcs AS (
    SELECT 
      sm.*,
      (sm.bid_depth + sm.ask_depth) as total_depth,
      CASE 
        WHEN sm.best_bid > 0 AND sm.best_ask > 0 
        THEN ((sm.best_ask - sm.best_bid) / sm.best_bid * 10000)
        ELSE 0 
      END as spread_bps,
      -- Liquidity score calculation (0-100 scale)
      CASE 
        WHEN (sm.bid_depth + sm.ask_depth) > 100000 THEN 
          GREATEST(0, LEAST(100, 90 - ((sm.best_ask - sm.best_bid) / NULLIF(sm.best_bid, 0) * 1000)))
        WHEN (sm.bid_depth + sm.ask_depth) > 50000 THEN 
          GREATEST(0, LEAST(100, 70 - ((sm.best_ask - sm.best_bid) / NULLIF(sm.best_bid, 0) * 1000)))
        WHEN (sm.bid_depth + sm.ask_depth) > 10000 THEN 
          GREATEST(0, LEAST(100, 50 - ((sm.best_ask - sm.best_bid) / NULLIF(sm.best_bid, 0) * 1000)))
        ELSE 
          GREATEST(0, LEAST(100, 30 - ((sm.best_ask - sm.best_bid) / NULLIF(sm.best_bid, 0) * 1000)))
      END as liquidity_score,
      COALESCE(rt.recent_trades, 0) as recent_trades,
      COALESCE(rt.avg_trade_volume, 0) as avg_trade_volume
    FROM symbol_metrics sm
    LEFT JOIN recent_trades rt ON sm.symbol = rt.symbol
    WHERE sm.bid_depth IS NOT NULL AND sm.ask_depth IS NOT NULL
  )
  INSERT INTO liquidity_metrics_processed (
    symbol, snapshot_time, bid_depth, ask_depth, total_depth,
    best_bid, best_ask, spread_bps, bid_orders, ask_orders,
    liquidity_score, liquidity_rating, recent_trades, avg_trade_volume
  )
  SELECT 
    symbol,
    date_trunc('minute', NOW()) as snapshot_time, -- Round to nearest minute
    bid_depth,
    ask_depth,
    total_depth,
    best_bid,
    best_ask,
    spread_bps,
    bid_orders,
    ask_orders,
    liquidity_score,
    CASE 
      WHEN liquidity_score >= 80 THEN 'Excellent'
      WHEN liquidity_score >= 60 THEN 'Good'
      WHEN liquidity_score >= 40 THEN 'Moderate'
      WHEN liquidity_score >= 20 THEN 'Low'
      ELSE 'Very Low'
    END as liquidity_rating,
    recent_trades,
    avg_trade_volume
  FROM liquidity_calcs
  ON CONFLICT (symbol, snapshot_time) DO UPDATE SET
    bid_depth = EXCLUDED.bid_depth,
    ask_depth = EXCLUDED.ask_depth,
    total_depth = EXCLUDED.total_depth,
    best_bid = EXCLUDED.best_bid,
    best_ask = EXCLUDED.best_ask,
    spread_bps = EXCLUDED.spread_bps,
    bid_orders = EXCLUDED.bid_orders,
    ask_orders = EXCLUDED.ask_orders,
    liquidity_score = EXCLUDED.liquidity_score,
    liquidity_rating = EXCLUDED.liquidity_rating,
    recent_trades = EXCLUDED.recent_trades,
    avg_trade_volume = EXCLUDED.avg_trade_volume,
    created_at = NOW();

  -- Clean up old data (keep last 7 days)
  DELETE FROM liquidity_metrics_processed 
  WHERE snapshot_time < NOW() - INTERVAL '7 days';

END;
$$ LANGUAGE plpgsql;

-- Create continuous aggregate for better performance
CREATE MATERIALIZED VIEW IF NOT EXISTS liquidity_metrics_hourly
WITH (timescaledb.continuous) AS
SELECT 
  symbol,
  time_bucket('1 hour', snapshot_time) AS hour_bucket,
  AVG(bid_depth) as avg_bid_depth,
  AVG(ask_depth) as avg_ask_depth,
  AVG(total_depth) as avg_total_depth,
  AVG(spread_bps) as avg_spread_bps,
  AVG(liquidity_score) as avg_liquidity_score,
  COUNT(*) as data_points
FROM liquidity_metrics_processed
GROUP BY symbol, hour_bucket;

-- Add refresh policy for continuous aggregate
SELECT add_continuous_aggregate_policy('liquidity_metrics_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true);

-- Comments for documentation
COMMENT ON TABLE liquidity_metrics_processed IS 'Pre-computed liquidity metrics for 100-400x API performance improvement';
COMMENT ON FUNCTION process_liquidity_metrics() IS 'ETL function to process liquidity metrics from order_book_depth table every minute';