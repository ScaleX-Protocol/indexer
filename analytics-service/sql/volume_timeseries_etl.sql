-- ================================================
-- Volume Time-Series ETL Schema & Processing
-- ================================================
-- 150x performance improvement for volume analytics
-- Based on ETL_OPTIMIZATION_ANALYSIS.md Section 7

CREATE TABLE IF NOT EXISTS volume_timeseries_processed (
  symbol VARCHAR(50) NOT NULL,
  time_bucket TIMESTAMPTZ NOT NULL,
  interval_type VARCHAR(20) NOT NULL, -- '5m', '15m', '1h', '4h', '1d'
  volume DECIMAL(20,8) DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  unique_traders INTEGER DEFAULT 0,
  buy_volume DECIMAL(20,8) DEFAULT 0,
  sell_volume DECIMAL(20,8) DEFAULT 0,
  buy_trades INTEGER DEFAULT 0,
  sell_trades INTEGER DEFAULT 0,
  volume_weighted_price DECIMAL(20,8) DEFAULT 0,
  open_price DECIMAL(20,8) DEFAULT 0,
  high_price DECIMAL(20,8) DEFAULT 0,
  low_price DECIMAL(20,8) DEFAULT 0,
  close_price DECIMAL(20,8) DEFAULT 0,
  price_change DECIMAL(20,8) DEFAULT 0,
  price_change_percent DECIMAL(10,4) DEFAULT 0,
  volume_sma_20 DECIMAL(20,8) DEFAULT 0, -- 20-period simple moving average
  volume_rsi DECIMAL(8,4) DEFAULT 50, -- Volume RSI indicator
  volume_trend VARCHAR(20) DEFAULT 'neutral', -- 'increasing', 'decreasing', 'neutral'
  volatility DECIMAL(10,6) DEFAULT 0, -- Price volatility for the period
  large_trade_count INTEGER DEFAULT 0, -- Trades > average volume
  whale_trade_count INTEGER DEFAULT 0, -- Trades > 10x average volume
  market_dominance DECIMAL(8,4) DEFAULT 0, -- % of total market volume
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, time_bucket, interval_type)
);

-- Create hypertable for time-series optimization
SELECT create_hypertable('volume_timeseries_processed', 'time_bucket', 
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_volume_symbol_interval ON volume_timeseries_processed (symbol, interval_type, time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_volume_time_desc ON volume_timeseries_processed (time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_volume_amount ON volume_timeseries_processed (volume DESC);
CREATE INDEX IF NOT EXISTS idx_volume_trend ON volume_timeseries_processed (volume_trend);

-- ================================================
-- Volume Time-Series ETL Processing Function
-- ================================================

CREATE OR REPLACE FUNCTION process_volume_timeseries()
RETURNS VOID AS $$
DECLARE
  processing_time TIMESTAMPTZ;
  current_5m TIMESTAMPTZ;
  current_15m TIMESTAMPTZ;
  current_1h TIMESTAMPTZ;
  current_4h TIMESTAMPTZ;
  current_1d TIMESTAMPTZ;
  total_processed INTEGER := 0;
  interval_record RECORD;
BEGIN
  processing_time := NOW();
  current_5m := date_trunc('minute', processing_time) - 
    (EXTRACT(minute FROM processing_time)::INTEGER % 5) * INTERVAL '1 minute';
  current_15m := date_trunc('minute', processing_time) - 
    (EXTRACT(minute FROM processing_time)::INTEGER % 15) * INTERVAL '1 minute';
  current_1h := date_trunc('hour', processing_time);
  current_4h := date_trunc('hour', processing_time) - 
    (EXTRACT(hour FROM processing_time)::INTEGER % 4) * INTERVAL '1 hour';
  current_1d := date_trunc('day', processing_time);
  
  RAISE NOTICE '[%] Starting volume time-series ETL processing...', processing_time;
  
  -- ================================================
  -- Process Multiple Time Intervals
  -- ================================================
  
  FOR interval_record IN 
    SELECT * FROM (VALUES 
      ('5m', current_5m, INTERVAL '5 minutes'),
      ('15m', current_15m, INTERVAL '15 minutes'),
      ('1h', current_1h, INTERVAL '1 hour'),
      ('4h', current_4h, INTERVAL '4 hours'),
      ('1d', current_1d, INTERVAL '1 day')
    ) AS intervals(interval_type, bucket_time, duration)
  LOOP
    
    -- Clear existing data for current bucket to handle reprocessing
    DELETE FROM volume_timeseries_processed 
    WHERE time_bucket = interval_record.bucket_time 
      AND interval_type = interval_record.interval_type;
    
    -- Process volume data for this interval
    INSERT INTO volume_timeseries_processed (
      symbol, time_bucket, interval_type, volume, trades_count, unique_traders,
      buy_volume, sell_volume, buy_trades, sell_trades, volume_weighted_price,
      open_price, high_price, low_price, close_price, price_change, price_change_percent,
      volume_sma_20, volume_rsi, volume_trend, volatility, large_trade_count, 
      whale_trade_count, market_dominance
    )
    WITH trade_data AS (
      SELECT 
        t.symbol,
        COUNT(*) as trades_count,
        COUNT(DISTINCT t.user_id) as unique_traders,
        SUM(t.quote_qty::DECIMAL) as volume,
        SUM(CASE WHEN t.is_buyer THEN t.quote_qty::DECIMAL ELSE 0 END) as buy_volume,
        SUM(CASE WHEN NOT t.is_buyer THEN t.quote_qty::DECIMAL ELSE 0 END) as sell_volume,
        SUM(CASE WHEN t.is_buyer THEN 1 ELSE 0 END) as buy_trades,
        SUM(CASE WHEN NOT t.is_buyer THEN 1 ELSE 0 END) as sell_trades,
        SUM(t.price::DECIMAL * t.quantity::DECIMAL) / NULLIF(SUM(t.quantity::DECIMAL), 0) as volume_weighted_price,
        FIRST(t.price::DECIMAL ORDER BY t.timestamp) as open_price,
        MAX(t.price::DECIMAL) as high_price,
        MIN(t.price::DECIMAL) as low_price,
        LAST(t.price::DECIMAL ORDER BY t.timestamp) as close_price,
        AVG(t.quote_qty::DECIMAL) as avg_trade_size,
        STDDEV(t.price::DECIMAL) as price_stddev
      FROM order_book_trades t
      WHERE t.timestamp >= interval_record.bucket_time - interval_record.duration
        AND t.timestamp < interval_record.bucket_time
        AND t.symbol IS NOT NULL
        AND t.price IS NOT NULL
        AND t.quantity IS NOT NULL
      GROUP BY t.symbol
      HAVING COUNT(*) > 0
    ),
    volume_history AS (
      SELECT 
        td.symbol,
        td.volume,
        -- Calculate 20-period volume SMA from historical data
        AVG(vtp.volume) OVER (
          PARTITION BY td.symbol 
          ORDER BY interval_record.bucket_time 
          ROWS BETWEEN 19 PRECEDING AND 1 PRECEDING
        ) as volume_sma_20,
        -- Calculate volume trend
        LAG(vtp.volume, 1) OVER (PARTITION BY td.symbol ORDER BY interval_record.bucket_time) as prev_volume,
        LAG(vtp.volume, 5) OVER (PARTITION BY td.symbol ORDER BY interval_record.bucket_time) as prev_5_volume,
        -- Get total market volume for dominance calculation
        SUM(td.volume) OVER () as total_market_volume
      FROM trade_data td
      LEFT JOIN volume_timeseries_processed vtp ON td.symbol = vtp.symbol
        AND vtp.interval_type = interval_record.interval_type
        AND vtp.time_bucket < interval_record.bucket_time
        AND vtp.time_bucket >= interval_record.bucket_time - interval_record.duration * 20
    )
    SELECT 
      td.symbol,
      interval_record.bucket_time as time_bucket,
      interval_record.interval_type as interval_type,
      td.volume,
      td.trades_count,
      td.unique_traders,
      td.buy_volume,
      td.sell_volume,
      td.buy_trades,
      td.sell_trades,
      td.volume_weighted_price,
      td.open_price,
      td.high_price,
      td.low_price,
      td.close_price,
      
      -- Price change calculations
      COALESCE(td.close_price - td.open_price, 0) as price_change,
      CASE 
        WHEN td.open_price > 0 THEN 
          ((td.close_price - td.open_price) / td.open_price * 100)
        ELSE 0 
      END as price_change_percent,
      
      -- Volume indicators
      COALESCE(vh.volume_sma_20, td.volume) as volume_sma_20,
      
      -- Volume RSI (simplified)
      CASE 
        WHEN vh.prev_volume > 0 THEN
          GREATEST(0, LEAST(100, 50 + (td.volume - vh.prev_volume) / vh.prev_volume * 50))
        ELSE 50
      END as volume_rsi,
      
      -- Volume trend analysis
      CASE 
        WHEN vh.prev_5_volume IS NULL THEN 'neutral'
        WHEN td.volume > vh.prev_5_volume * 1.2 THEN 'increasing'
        WHEN td.volume < vh.prev_5_volume * 0.8 THEN 'decreasing'
        ELSE 'neutral'
      END as volume_trend,
      
      -- Volatility (coefficient of variation)
      CASE 
        WHEN td.volume_weighted_price > 0 THEN 
          COALESCE(td.price_stddev / td.volume_weighted_price, 0)
        ELSE 0 
      END as volatility,
      
      -- Large trade analysis
      COUNT(CASE WHEN trade_size.quote_qty > td.avg_trade_size * 3 THEN 1 END) as large_trade_count,
      COUNT(CASE WHEN trade_size.quote_qty > td.avg_trade_size * 10 THEN 1 END) as whale_trade_count,
      
      -- Market dominance
      CASE 
        WHEN vh.total_market_volume > 0 THEN 
          (td.volume / vh.total_market_volume * 100)
        ELSE 0 
      END as market_dominance
      
    FROM trade_data td
    JOIN volume_history vh ON td.symbol = vh.symbol
    LEFT JOIN LATERAL (
      SELECT t2.quote_qty::DECIMAL
      FROM order_book_trades t2
      WHERE t2.symbol = td.symbol
        AND t2.timestamp >= interval_record.bucket_time - interval_record.duration
        AND t2.timestamp < interval_record.bucket_time
    ) trade_size ON true
    WHERE td.trades_count >= 1;
    
  END LOOP;
  
  GET DIAGNOSTICS total_processed = ROW_COUNT;
  
  RAISE NOTICE '[%] Volume time-series ETL completed. Processed % records across all intervals', 
    NOW(), total_processed;
    
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '[%] Volume time-series ETL failed: % - %', NOW(), SQLSTATE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- Helper Functions for Volume Analytics
-- ================================================

-- Get volume metrics for specific symbols and timeframes
CREATE OR REPLACE FUNCTION get_volume_metrics(
  p_symbols TEXT[] DEFAULT NULL,
  p_interval_type TEXT DEFAULT '1h',
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  symbol VARCHAR(50),
  time_bucket TIMESTAMPTZ,
  volume DECIMAL(20,8),
  trades_count INTEGER,
  volume_trend VARCHAR(20),
  price_change_percent DECIMAL(10,4),
  market_dominance DECIMAL(8,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vtp.symbol,
    vtp.time_bucket,
    vtp.volume,
    vtp.trades_count,
    vtp.volume_trend,
    vtp.price_change_percent,
    vtp.market_dominance
  FROM volume_timeseries_processed vtp
  WHERE (p_symbols IS NULL OR vtp.symbol = ANY(p_symbols))
    AND vtp.interval_type = p_interval_type
    AND vtp.time_bucket >= NOW() - INTERVAL '1 hour' * p_hours
  ORDER BY vtp.time_bucket DESC, vtp.volume DESC;
END;
$$ LANGUAGE plpgsql;

-- Get top volume symbols for a period
CREATE OR REPLACE FUNCTION get_top_volume_symbols(
  p_interval_type TEXT DEFAULT '1d',
  p_days INTEGER DEFAULT 7,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  symbol VARCHAR(50),
  total_volume DECIMAL(20,8),
  avg_volume DECIMAL(20,8),
  total_trades INTEGER,
  avg_price_change DECIMAL(10,4),
  volume_trend VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vtp.symbol,
    SUM(vtp.volume) as total_volume,
    AVG(vtp.volume) as avg_volume,
    SUM(vtp.trades_count) as total_trades,
    AVG(vtp.price_change_percent) as avg_price_change,
    MODE() WITHIN GROUP (ORDER BY vtp.volume_trend) as volume_trend
  FROM volume_timeseries_processed vtp
  WHERE vtp.interval_type = p_interval_type
    AND vtp.time_bucket >= NOW() - INTERVAL '1 day' * p_days
  GROUP BY vtp.symbol
  ORDER BY total_volume DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Get volume anomalies (unusual volume spikes)
CREATE OR REPLACE FUNCTION get_volume_anomalies(
  p_interval_type TEXT DEFAULT '1h',
  p_hours INTEGER DEFAULT 24,
  p_threshold DECIMAL DEFAULT 3.0
)
RETURNS TABLE (
  symbol VARCHAR(50),
  time_bucket TIMESTAMPTZ,
  volume DECIMAL(20,8),
  volume_sma_20 DECIMAL(20,8),
  volume_spike_ratio DECIMAL(8,2),
  whale_trade_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vtp.symbol,
    vtp.time_bucket,
    vtp.volume,
    vtp.volume_sma_20,
    CASE 
      WHEN vtp.volume_sma_20 > 0 THEN (vtp.volume / vtp.volume_sma_20)
      ELSE 0 
    END as volume_spike_ratio,
    vtp.whale_trade_count
  FROM volume_timeseries_processed vtp
  WHERE vtp.interval_type = p_interval_type
    AND vtp.time_bucket >= NOW() - INTERVAL '1 hour' * p_hours
    AND vtp.volume_sma_20 > 0
    AND (vtp.volume / vtp.volume_sma_20) >= p_threshold
  ORDER BY (vtp.volume / vtp.volume_sma_20) DESC;
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- Performance Monitoring
-- ================================================

COMMENT ON TABLE volume_timeseries_processed IS 
'Pre-computed volume time-series analytics for 150x performance improvement. Updates every 5 minutes via ETL.';

COMMENT ON FUNCTION process_volume_timeseries() IS 
'ETL function to process volume time-series data across multiple intervals. Provides 150x faster volume analytics API responses.';