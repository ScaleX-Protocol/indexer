-- =====================================================================
-- Leaderboard Infrastructure for Fresh Deployments
-- Creates all tables and views needed for leaderboard functionality
-- =====================================================================

-- =====================================================================
-- 1. CREATE MISSING SOURCE TABLE
-- =====================================================================

-- Create hourly_pnl_metrics table (required by leaderboard views)
CREATE TABLE IF NOT EXISTS analytics.hourly_pnl_metrics (
    bucket TIMESTAMPTZ NOT NULL,
    user_id TEXT NOT NULL,
    total_pnl NUMERIC DEFAULT 0,
    total_realized_pnl NUMERIC DEFAULT 0,
    total_unrealized_pnl NUMERIC DEFAULT 0,
    trades_count INTEGER DEFAULT 0,
    volume_traded NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (bucket, user_id)
);

-- Convert to hypertable
SELECT create_hypertable('analytics.hourly_pnl_metrics', 'bucket', if_not_exists => TRUE);

-- =====================================================================
-- 2. BASIC LEADERBOARD VIEWS (WITHOUT CONTINUOUS AGGREGATES)
-- =====================================================================
-- Note: Using simple views instead of continuous aggregates to avoid
-- transaction block issues during docker-compose initialization

-- 24h PNL leaderboard view
CREATE OR REPLACE VIEW analytics.pnl_leaderboard_24h AS
SELECT 
    user_id,
    SUM(total_pnl) as total_pnl,
    SUM(total_realized_pnl) as realized_pnl,
    SUM(total_unrealized_pnl) as unrealized_pnl,
    SUM(trades_count) as trading_sessions,
    AVG(total_pnl) as avg_pnl_per_session,
    ROW_NUMBER() OVER (ORDER BY SUM(total_pnl) DESC) as rank,
    CASE 
        WHEN SUM(total_pnl) > 0 THEN 'profitable'
        WHEN SUM(total_pnl) = 0 THEN 'breakeven'
        ELSE 'loss'
    END as performance_status
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '24 hours'
GROUP BY user_id
HAVING SUM(total_pnl) IS NOT NULL
ORDER BY total_pnl DESC;

-- 7d PNL leaderboard view
CREATE OR REPLACE VIEW analytics.pnl_leaderboard_7d AS
SELECT 
    user_id,
    SUM(total_pnl) as total_pnl,
    SUM(total_realized_pnl) as realized_pnl,
    SUM(total_unrealized_pnl) as unrealized_pnl,
    SUM(trades_count) as trading_sessions,
    AVG(total_pnl) as avg_pnl_per_session,
    ROW_NUMBER() OVER (ORDER BY SUM(total_pnl) DESC) as rank
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING SUM(total_pnl) IS NOT NULL
ORDER BY total_pnl DESC;

-- 30d PNL leaderboard view
CREATE OR REPLACE VIEW analytics.pnl_leaderboard_30d AS
SELECT 
    user_id,
    SUM(total_pnl) as total_pnl,
    SUM(total_realized_pnl) as realized_pnl,
    SUM(total_unrealized_pnl) as unrealized_pnl,
    SUM(trades_count) as trading_sessions,
    AVG(total_pnl) as avg_pnl_per_session,
    ROW_NUMBER() OVER (ORDER BY SUM(total_pnl) DESC) as rank
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '30 days'
GROUP BY user_id
HAVING SUM(total_pnl) IS NOT NULL
ORDER BY total_pnl DESC;

-- =====================================================================
-- 3. VOLUME LEADERBOARD VIEWS
-- =====================================================================

-- 24h Volume leaderboard view
CREATE OR REPLACE VIEW analytics.volume_leaderboard_24h AS
SELECT 
    user_id,
    SUM(total_volume) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(total_volume / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_hours,
    ROW_NUMBER() OVER (ORDER BY SUM(total_volume) DESC) as rank,
    CASE 
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.daily_user_activity
WHERE bucket >= NOW() - INTERVAL '24 hours'
GROUP BY user_id
HAVING SUM(total_volume) > 0
ORDER BY total_volume DESC;

-- 7d Volume leaderboard view
CREATE OR REPLACE VIEW analytics.volume_leaderboard_7d AS
SELECT 
    user_id,
    SUM(total_volume) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(total_volume / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_days,
    ROW_NUMBER() OVER (ORDER BY SUM(total_volume) DESC) as rank,
    CASE 
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.daily_user_activity
WHERE bucket >= NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING SUM(total_volume) > 0
ORDER BY total_volume DESC;

-- 30d Volume leaderboard view
CREATE OR REPLACE VIEW analytics.volume_leaderboard_30d AS
SELECT 
    user_id,
    SUM(total_volume) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(total_volume / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_days,
    ROW_NUMBER() OVER (ORDER BY SUM(total_volume) DESC) as rank,
    CASE 
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(total_volume / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.daily_user_activity
WHERE bucket >= NOW() - INTERVAL '30 days'
GROUP BY user_id
HAVING SUM(total_volume) > 0
ORDER BY total_volume DESC;

-- =====================================================================
-- 4. PERFORMANCE INDEXES
-- =====================================================================

-- Indexes for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_hourly_pnl_metrics_bucket_pnl
ON analytics.hourly_pnl_metrics (bucket DESC, total_pnl DESC);

CREATE INDEX IF NOT EXISTS idx_hourly_pnl_metrics_user_bucket  
ON analytics.hourly_pnl_metrics (user_id, bucket DESC);

-- =====================================================================
-- 5. MONITORING VIEW
-- =====================================================================

-- Monitor leaderboard performance
CREATE OR REPLACE VIEW analytics.leaderboard_performance_stats AS
SELECT 
    'pnl_24h' as leaderboard_type,
    COUNT(*) as total_entries,
    AVG(total_pnl) as avg_pnl,
    MIN(total_pnl) as min_pnl,
    MAX(total_pnl) as max_pnl,
    NOW() as last_updated
FROM analytics.pnl_leaderboard_24h
UNION ALL
SELECT 
    'volume_24h' as leaderboard_type,
    COUNT(*) as total_entries,
    AVG(total_volume) as avg_pnl,
    MIN(total_volume) as min_pnl,
    MAX(total_volume) as max_pnl,
    NOW() as last_updated
FROM analytics.volume_leaderboard_24h;

-- =====================================================================
-- INITIALIZATION COMPLETE
-- =====================================================================

DO $$
BEGIN
    RAISE NOTICE '🏆 Leaderboard Infrastructure Created!';
    RAISE NOTICE '📊 PNL Leaderboards: 24h, 7d, 30d views ready';
    RAISE NOTICE '📈 Volume Leaderboards: 24h, 7d, 30d views ready';
    RAISE NOTICE '⚡ Performance: Optimized with indexes';
    RAISE NOTICE '💡 Note: Views will be empty until hourly_pnl_metrics is populated';
    RAISE NOTICE '🎯 Status: Fresh deployment leaderboard infrastructure complete';
END $$;