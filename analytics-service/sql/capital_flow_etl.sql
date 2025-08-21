-- ================================================
-- Capital Flow Analytics ETL Schema & Processing
-- ================================================
-- Enables new capital flow functionality with real-time insights
-- Based on ETL_OPTIMIZATION_ANALYSIS.md Section 8

CREATE TABLE IF NOT EXISTS capital_flow_processed (
  symbol VARCHAR(50) NOT NULL,
  time_bucket TIMESTAMPTZ NOT NULL,
  period_type VARCHAR(20) NOT NULL, -- '1h', '4h', '1d', '1w'
  net_flow DECIMAL(20,8) DEFAULT 0, -- Positive = inflow, Negative = outflow
  inflow_volume DECIMAL(20,8) DEFAULT 0,
  outflow_volume DECIMAL(20,8) DEFAULT 0,
  large_inflows DECIMAL(20,8) DEFAULT 0, -- Transactions > 10k USD
  large_outflows DECIMAL(20,8) DEFAULT 0,
  whale_inflows DECIMAL(20,8) DEFAULT 0, -- Transactions > 100k USD
  whale_outflows DECIMAL(20,8) DEFAULT 0,
  retail_inflows DECIMAL(20,8) DEFAULT 0, -- Transactions < 1k USD
  retail_outflows DECIMAL(20,8) DEFAULT 0,
  institutional_flow DECIMAL(20,8) DEFAULT 0, -- Estimated institutional flow
  dex_flow DECIMAL(20,8) DEFAULT 0, -- DEX trading flow
  cex_flow DECIMAL(20,8) DEFAULT 0, -- CEX trading flow
  unique_inflow_addresses INTEGER DEFAULT 0,
  unique_outflow_addresses INTEGER DEFAULT 0,
  flow_concentration DECIMAL(8,4) DEFAULT 0, -- Gini coefficient of flow distribution
  flow_velocity DECIMAL(10,4) DEFAULT 0, -- Flow turnover rate
  price_correlation DECIMAL(8,4) DEFAULT 0, -- Correlation between flow and price
  flow_momentum VARCHAR(20) DEFAULT 'neutral', -- 'bullish', 'bearish', 'neutral'
  dominance_score DECIMAL(8,4) DEFAULT 0, -- Flow dominance vs other symbols
  smart_money_flow DECIMAL(20,8) DEFAULT 0, -- Estimated smart money flow
  flow_strength VARCHAR(20) DEFAULT 'weak', -- 'strong', 'medium', 'weak'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, time_bucket, period_type)
);

-- Create hypertable for time-series optimization
SELECT create_hypertable('capital_flow_processed', 'time_bucket', 
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_capital_flow_symbol_period ON capital_flow_processed (symbol, period_type, time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_capital_flow_net ON capital_flow_processed (net_flow DESC);
CREATE INDEX IF NOT EXISTS idx_capital_flow_momentum ON capital_flow_processed (flow_momentum);
CREATE INDEX IF NOT EXISTS idx_capital_flow_strength ON capital_flow_processed (flow_strength);

-- ================================================
-- Capital Flow ETL Processing Function
-- ================================================

CREATE OR REPLACE FUNCTION process_capital_flow_analytics()
RETURNS VOID AS $$
DECLARE
  processing_time TIMESTAMPTZ;
  current_1h TIMESTAMPTZ;
  current_4h TIMESTAMPTZ;
  current_1d TIMESTAMPTZ;
  current_1w TIMESTAMPTZ;
  total_processed INTEGER := 0;
  period_record RECORD;
BEGIN
  processing_time := NOW();
  current_1h := date_trunc('hour', processing_time);
  current_4h := date_trunc('hour', processing_time) - 
    (EXTRACT(hour FROM processing_time)::INTEGER % 4) * INTERVAL '1 hour';
  current_1d := date_trunc('day', processing_time);
  current_1w := date_trunc('week', processing_time);
  
  RAISE NOTICE '[%] Starting capital flow analytics ETL processing...', processing_time;
  
  -- ================================================
  -- Process Multiple Time Periods
  -- ================================================
  
  FOR period_record IN 
    SELECT * FROM (VALUES 
      ('1h', current_1h, INTERVAL '1 hour'),
      ('4h', current_4h, INTERVAL '4 hours'),
      ('1d', current_1d, INTERVAL '1 day'),
      ('1w', current_1w, INTERVAL '1 week')
    ) AS periods(period_type, bucket_time, duration)
  LOOP
    
    -- Clear existing data for current bucket to handle reprocessing
    DELETE FROM capital_flow_processed 
    WHERE time_bucket = period_record.bucket_time 
      AND period_type = period_record.period_type;
    
    -- Process capital flow data for this period
    INSERT INTO capital_flow_processed (
      symbol, time_bucket, period_type, net_flow, inflow_volume, outflow_volume,
      large_inflows, large_outflows, whale_inflows, whale_outflows,
      retail_inflows, retail_outflows, institutional_flow, dex_flow, cex_flow,
      unique_inflow_addresses, unique_outflow_addresses, flow_concentration,
      flow_velocity, price_correlation, flow_momentum, dominance_score,
      smart_money_flow, flow_strength\n    )\n    WITH trade_flows AS (\n      SELECT \n        t.symbol,\n        -- Calculate inflows and outflows based on trade direction and size\n        SUM(CASE \n          WHEN t.is_buyer THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as inflow_volume,\n        SUM(CASE \n          WHEN NOT t.is_buyer THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as outflow_volume,\n        \n        -- Large trades (> $10k)\n        SUM(CASE \n          WHEN t.is_buyer AND t.quote_qty::DECIMAL > 10000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as large_inflows,\n        SUM(CASE \n          WHEN NOT t.is_buyer AND t.quote_qty::DECIMAL > 10000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as large_outflows,\n        \n        -- Whale trades (> $100k)\n        SUM(CASE \n          WHEN t.is_buyer AND t.quote_qty::DECIMAL > 100000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as whale_inflows,\n        SUM(CASE \n          WHEN NOT t.is_buyer AND t.quote_qty::DECIMAL > 100000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as whale_outflows,\n        \n        -- Retail trades (< $1k)\n        SUM(CASE \n          WHEN t.is_buyer AND t.quote_qty::DECIMAL < 1000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as retail_inflows,\n        SUM(CASE \n          WHEN NOT t.is_buyer AND t.quote_qty::DECIMAL < 1000 THEN t.quote_qty::DECIMAL \n          ELSE 0 \n        END) as retail_outflows,\n        \n        -- Unique addresses (using user_id as proxy)\n        COUNT(DISTINCT CASE WHEN t.is_buyer THEN t.user_id END) as unique_inflow_addresses,\n        COUNT(DISTINCT CASE WHEN NOT t.is_buyer THEN t.user_id END) as unique_outflow_addresses,\n        \n        -- Institutional flow estimation (large, consistent traders)\n        SUM(CASE \n          WHEN inst_traders.is_institutional THEN \n            CASE WHEN t.is_buyer THEN t.quote_qty::DECIMAL ELSE -t.quote_qty::DECIMAL END\n          ELSE 0 \n        END) as institutional_flow,\n        \n        -- DEX vs CEX flow (simplified - assume all current trades are CEX)\n        0 as dex_flow,\n        SUM(CASE WHEN t.is_buyer THEN t.quote_qty::DECIMAL ELSE -t.quote_qty::DECIMAL END) as cex_flow,\n        \n        -- Price data for correlation\n        AVG(t.price::DECIMAL) as avg_price,\n        FIRST(t.price::DECIMAL ORDER BY t.timestamp) as open_price,\n        LAST(t.price::DECIMAL ORDER BY t.timestamp) as close_price,\n        \n        -- Flow velocity (turnover rate)\n        COUNT(*) as trade_count,\n        SUM(t.quote_qty::DECIMAL) as total_volume\n        \n      FROM order_book_trades t\n      LEFT JOIN LATERAL (\n        -- Identify institutional traders (high volume, consistent trading)\n        SELECT \n          (trader_stats.total_volume > 1000000 AND trader_stats.trade_count > 100) as is_institutional\n        FROM (\n          SELECT \n            SUM(t2.quote_qty::DECIMAL) as total_volume,\n            COUNT(*) as trade_count\n          FROM order_book_trades t2\n          WHERE t2.user_id = t.user_id\n            AND t2.timestamp >= period_record.bucket_time - period_record.duration * 7 -- Look back 7 periods\n        ) trader_stats\n      ) inst_traders ON true\n      WHERE t.timestamp >= period_record.bucket_time - period_record.duration\n        AND t.timestamp < period_record.bucket_time\n        AND t.symbol IS NOT NULL\n        AND t.price IS NOT NULL\n        AND t.quantity IS NOT NULL\n      GROUP BY t.symbol\n      HAVING COUNT(*) > 0\n    ),\n    flow_stats AS (\n      SELECT \n        tf.*,\n        (tf.inflow_volume - tf.outflow_volume) as net_flow,\n        \n        -- Flow concentration (Gini coefficient approximation)\n        CASE \n          WHEN tf.total_volume > 0 THEN\n            GREATEST(tf.whale_inflows + tf.whale_outflows, tf.large_inflows + tf.large_outflows) / tf.total_volume\n          ELSE 0\n        END as flow_concentration,\n        \n        -- Flow velocity\n        CASE \n          WHEN tf.total_volume > 0 THEN\n            tf.trade_count::DECIMAL / tf.total_volume * 1000 -- Normalized per 1k volume\n          ELSE 0\n        END as flow_velocity,\n        \n        -- Price correlation (simplified)\n        CASE \n          WHEN tf.open_price > 0 THEN\n            SIGN((tf.close_price - tf.open_price) / tf.open_price) * \n            SIGN(tf.inflow_volume - tf.outflow_volume)\n          ELSE 0\n        END as price_correlation,\n        \n        -- Smart money flow (institutional + whale flow)\n        tf.institutional_flow + (tf.whale_inflows - tf.whale_outflows) as smart_money_flow,\n        \n        -- Total market volume for dominance calculation\n        SUM(tf.total_volume) OVER () as total_market_volume\n        \n      FROM trade_flows tf\n    )\n    SELECT \n      fs.symbol,\n      period_record.bucket_time as time_bucket,\n      period_record.period_type as period_type,\n      fs.net_flow,\n      fs.inflow_volume,\n      fs.outflow_volume,\n      fs.large_inflows,\n      fs.large_outflows,\n      fs.whale_inflows,\n      fs.whale_outflows,\n      fs.retail_inflows,\n      fs.retail_outflows,\n      fs.institutional_flow,\n      fs.dex_flow,\n      fs.cex_flow,\n      fs.unique_inflow_addresses,\n      fs.unique_outflow_addresses,\n      fs.flow_concentration,\n      fs.flow_velocity,\n      fs.price_correlation,\n      \n      -- Flow momentum analysis\n      CASE \n        WHEN fs.net_flow > fs.total_volume * 0.1 THEN 'bullish'\n        WHEN fs.net_flow < -fs.total_volume * 0.1 THEN 'bearish'\n        ELSE 'neutral'\n      END as flow_momentum,\n      \n      -- Dominance score\n      CASE \n        WHEN fs.total_market_volume > 0 THEN\n          (fs.total_volume / fs.total_market_volume * 100)\n        ELSE 0\n      END as dominance_score,\n      \n      fs.smart_money_flow,\n      \n      -- Flow strength assessment\n      CASE \n        WHEN ABS(fs.net_flow) > fs.total_volume * 0.3 THEN 'strong'\n        WHEN ABS(fs.net_flow) > fs.total_volume * 0.1 THEN 'medium'\n        ELSE 'weak'\n      END as flow_strength\n      \n    FROM flow_stats fs\n    WHERE fs.total_volume > 0;\n    \n  END LOOP;\n  \n  GET DIAGNOSTICS total_processed = ROW_COUNT;\n  \n  RAISE NOTICE '[%] Capital flow analytics ETL completed. Processed % records across all periods', \n    NOW(), total_processed;\n    \nEXCEPTION\n  WHEN OTHERS THEN\n    RAISE EXCEPTION '[%] Capital flow analytics ETL failed: % - %', NOW(), SQLSTATE, SQLERRM;\nEND;\n$$ LANGUAGE plpgsql;\n\n-- ================================================\n-- Helper Functions for Capital Flow Analytics\n-- ================================================\n\n-- Get capital flow summary for symbols\nCREATE OR REPLACE FUNCTION get_capital_flow_summary(\n  p_symbols TEXT[] DEFAULT NULL,\n  p_period_type TEXT DEFAULT '1h',\n  p_hours INTEGER DEFAULT 24\n)\nRETURNS TABLE (\n  symbol VARCHAR(50),\n  time_bucket TIMESTAMPTZ,\n  net_flow DECIMAL(20,8),\n  flow_momentum VARCHAR(20),\n  flow_strength VARCHAR(20),\n  smart_money_flow DECIMAL(20,8),\n  whale_net_flow DECIMAL(20,8),\n  institutional_flow DECIMAL(20,8)\n) AS $$\nBEGIN\n  RETURN QUERY\n  SELECT \n    cf.symbol,\n    cf.time_bucket,\n    cf.net_flow,\n    cf.flow_momentum,\n    cf.flow_strength,\n    cf.smart_money_flow,\n    (cf.whale_inflows - cf.whale_outflows) as whale_net_flow,\n    cf.institutional_flow\n  FROM capital_flow_processed cf\n  WHERE (p_symbols IS NULL OR cf.symbol = ANY(p_symbols))\n    AND cf.period_type = p_period_type\n    AND cf.time_bucket >= NOW() - INTERVAL '1 hour' * p_hours\n  ORDER BY cf.time_bucket DESC, ABS(cf.net_flow) DESC;\nEND;\n$$ LANGUAGE plpgsql;\n\n-- Get top capital flow symbols\nCREATE OR REPLACE FUNCTION get_top_capital_flow_symbols(\n  p_period_type TEXT DEFAULT '1d',\n  p_days INTEGER DEFAULT 7,\n  p_flow_type TEXT DEFAULT 'net', -- 'net', 'inflow', 'outflow', 'smart_money'\n  p_limit INTEGER DEFAULT 20\n)\nRETURNS TABLE (\n  symbol VARCHAR(50),\n  total_net_flow DECIMAL(20,8),\n  avg_flow_strength VARCHAR(20),\n  smart_money_total DECIMAL(20,8),\n  whale_dominance DECIMAL(8,4),\n  flow_consistency DECIMAL(8,4)\n) AS $$\nBEGIN\n  RETURN QUERY\n  WITH flow_aggregated AS (\n    SELECT \n      cf.symbol,\n      SUM(cf.net_flow) as total_net_flow,\n      SUM(cf.smart_money_flow) as smart_money_total,\n      SUM(cf.whale_inflows + cf.whale_outflows) / NULLIF(SUM(cf.inflow_volume + cf.outflow_volume), 0) * 100 as whale_dominance,\n      STDDEV(cf.net_flow) / NULLIF(AVG(ABS(cf.net_flow)), 0) as flow_consistency,\n      MODE() WITHIN GROUP (ORDER BY cf.flow_strength) as avg_flow_strength\n    FROM capital_flow_processed cf\n    WHERE cf.period_type = p_period_type\n      AND cf.time_bucket >= NOW() - INTERVAL '1 day' * p_days\n    GROUP BY cf.symbol\n  )\n  SELECT \n    fa.symbol,\n    fa.total_net_flow,\n    fa.avg_flow_strength,\n    fa.smart_money_total,\n    COALESCE(fa.whale_dominance, 0) as whale_dominance,\n    COALESCE(fa.flow_consistency, 0) as flow_consistency\n  FROM flow_aggregated fa\n  ORDER BY \n    CASE p_flow_type\n      WHEN 'net' THEN ABS(fa.total_net_flow)\n      WHEN 'inflow' THEN GREATEST(fa.total_net_flow, 0)\n      WHEN 'outflow' THEN GREATEST(-fa.total_net_flow, 0)\n      WHEN 'smart_money' THEN ABS(fa.smart_money_total)\n      ELSE ABS(fa.total_net_flow)\n    END DESC\n  LIMIT p_limit;\nEND;\n$$ LANGUAGE plpgsql;\n\n-- Get capital flow alerts (unusual flows)\nCREATE OR REPLACE FUNCTION get_capital_flow_alerts(\n  p_period_type TEXT DEFAULT '1h',\n  p_hours INTEGER DEFAULT 24,\n  p_threshold_multiplier DECIMAL DEFAULT 3.0\n)\nRETURNS TABLE (\n  symbol VARCHAR(50),\n  time_bucket TIMESTAMPTZ,\n  net_flow DECIMAL(20,8),\n  flow_magnitude DECIMAL(8,2),\n  alert_type VARCHAR(50),\n  smart_money_flow DECIMAL(20,8)\n) AS $$\nBEGIN\n  RETURN QUERY\n  WITH flow_averages AS (\n    SELECT \n      symbol,\n      AVG(ABS(net_flow)) as avg_abs_flow,\n      STDDEV(net_flow) as flow_stddev\n    FROM capital_flow_processed\n    WHERE period_type = p_period_type\n      AND time_bucket >= NOW() - INTERVAL '1 day' * 7 -- Look back 7 days for baseline\n    GROUP BY symbol\n    HAVING COUNT(*) >= 10 -- Minimum data points for statistical significance\n  )\n  SELECT \n    cf.symbol,\n    cf.time_bucket,\n    cf.net_flow,\n    CASE \n      WHEN fa.avg_abs_flow > 0 THEN (ABS(cf.net_flow) / fa.avg_abs_flow)\n      ELSE 0\n    END as flow_magnitude,\n    CASE \n      WHEN cf.net_flow > 0 THEN 'Unusual Inflow'\n      ELSE 'Unusual Outflow'\n    END as alert_type,\n    cf.smart_money_flow\n  FROM capital_flow_processed cf\n  JOIN flow_averages fa ON cf.symbol = fa.symbol\n  WHERE cf.period_type = p_period_type\n    AND cf.time_bucket >= NOW() - INTERVAL '1 hour' * p_hours\n    AND ABS(cf.net_flow) > fa.avg_abs_flow * p_threshold_multiplier\n  ORDER BY (ABS(cf.net_flow) / fa.avg_abs_flow) DESC;\nEND;\n$$ LANGUAGE plpgsql;\n\n-- ================================================\n-- Performance Monitoring\n-- ================================================\n\nCOMMENT ON TABLE capital_flow_processed IS \n'Pre-computed capital flow analytics enabling new insights into market money flows. Updates hourly via ETL.';\n\nCOMMENT ON FUNCTION process_capital_flow_analytics() IS \n'ETL function to process capital flow analytics from trade data. Enables advanced money flow tracking and analysis.';