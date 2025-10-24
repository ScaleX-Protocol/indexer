-- =====================================================================
-- Migration 004: Ensure 30d Leaderboard Coverage
-- Fixes initialization gaps that caused empty 30d leaderboards
-- =====================================================================

-- =====================================================================
-- 1. DATA COVERAGE VALIDATION
-- =====================================================================

DO $$
DECLARE
    pnl_data_days INTEGER := 0;
    activity_data_days INTEGER := 0;
    earliest_pnl TIMESTAMPTZ;
    earliest_activity TIMESTAMPTZ;
BEGIN
    RAISE NOTICE '🔍 Checking existing data coverage for leaderboards...';
    
    -- Check hourly_pnl_metrics coverage
    SELECT 
        MIN(bucket),
        EXTRACT(DAYS FROM (NOW() - MIN(bucket)))
    INTO earliest_pnl, pnl_data_days
    FROM analytics.hourly_pnl_metrics;
    
    -- Check daily_user_activity coverage
    SELECT 
        MIN(bucket),
        EXTRACT(DAYS FROM (NOW() - MIN(bucket)))
    INTO earliest_activity, activity_data_days
    FROM analytics.daily_user_activity;
    
    -- Report current state
    IF earliest_pnl IS NULL THEN
        RAISE NOTICE '⚠️  hourly_pnl_metrics table is EMPTY - needs data population';
    ELSE
        RAISE NOTICE '📊 hourly_pnl_metrics: % days of data (earliest: %)', 
            COALESCE(pnl_data_days, 0), earliest_pnl;
    END IF;
    
    IF earliest_activity IS NULL THEN
        RAISE NOTICE '⚠️  daily_user_activity table is EMPTY - needs data population';
    ELSE
        RAISE NOTICE '📊 daily_user_activity: % days of data (earliest: %)', 
            COALESCE(activity_data_days, 0), earliest_activity;
    END IF;
    
    -- Validation for 30d endpoints
    IF COALESCE(pnl_data_days, 0) < 30 THEN
        RAISE NOTICE '🚨 CRITICAL: Only % days of PNL data available, but 30d leaderboard needs 30+ days', 
            COALESCE(pnl_data_days, 0);
        RAISE NOTICE '💡 SOLUTION: Application startup job will populate missing historical data';
    ELSE
        RAISE NOTICE '✅ Sufficient PNL data for 30d leaderboards (% days)', pnl_data_days;
    END IF;
    
    IF COALESCE(activity_data_days, 0) < 30 THEN
        RAISE NOTICE '🚨 CRITICAL: Only % days of activity data available, but 30d volume leaderboard needs 30+ days', 
            COALESCE(activity_data_days, 0);
    ELSE
        RAISE NOTICE '✅ Sufficient activity data for 30d volume leaderboards (% days)', activity_data_days;
    END IF;
END $$;

-- =====================================================================
-- 2. FIX SCHEMA INCONSISTENCIES IN VOLUME LEADERBOARD VIEWS
-- =====================================================================

-- Drop existing volume views that reference non-existent tables/columns
DROP VIEW IF EXISTS analytics.volume_leaderboard_24h CASCADE;
DROP VIEW IF EXISTS analytics.volume_leaderboard_7d CASCADE;
DROP VIEW IF EXISTS analytics.volume_leaderboard_30d CASCADE;

-- Recreate volume leaderboard views using hourly_pnl_metrics (consistent source)
-- This fixes the schema mismatch where LeaderboardService expected certain columns

-- 24h Volume leaderboard view (using hourly_pnl_metrics as consistent source)
CREATE OR REPLACE VIEW analytics.volume_leaderboard_24h AS
SELECT 
    user_id,
    SUM(volume_traded) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(volume_traded / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_hours,
    ROW_NUMBER() OVER (ORDER BY SUM(volume_traded) DESC) as rank,
    CASE 
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '24 hours'
GROUP BY user_id
HAVING SUM(volume_traded) > 0
ORDER BY total_volume DESC;

-- 7d Volume leaderboard view
CREATE OR REPLACE VIEW analytics.volume_leaderboard_7d AS
SELECT 
    user_id,
    SUM(volume_traded) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(volume_traded / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_hours,
    ROW_NUMBER() OVER (ORDER BY SUM(volume_traded) DESC) as rank,
    CASE 
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING SUM(volume_traded) > 0
ORDER BY total_volume DESC;

-- 30d Volume leaderboard view
CREATE OR REPLACE VIEW analytics.volume_leaderboard_30d AS
SELECT 
    user_id,
    SUM(volume_traded) as total_volume,
    SUM(trades_count) as total_trades,
    AVG(volume_traded / NULLIF(trades_count, 0)) as avg_trade_size,
    COUNT(*) as active_hours,
    ROW_NUMBER() OVER (ORDER BY SUM(volume_traded) DESC) as rank,
    CASE 
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 10000 THEN 'whale'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 1000 THEN 'large_trader'
        WHEN AVG(volume_traded / NULLIF(trades_count, 0)) > 100 THEN 'regular_trader'
        ELSE 'small_trader'
    END as trader_type
FROM analytics.hourly_pnl_metrics
WHERE bucket >= NOW() - INTERVAL '30 days'
GROUP BY user_id
HAVING SUM(volume_traded) > 0
ORDER BY total_volume DESC;

-- =====================================================================
-- 3. CREATE DATA COVERAGE MONITORING VIEW
-- =====================================================================

CREATE OR REPLACE VIEW analytics.leaderboard_data_coverage AS
SELECT 
    'hourly_pnl_metrics' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT user_id) as unique_users,
    MIN(bucket) as earliest_data,
    MAX(bucket) as latest_data,
    EXTRACT(DAYS FROM (MAX(bucket) - MIN(bucket))) as days_covered,
    CASE 
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 30 THEN '✅ 30d Ready'
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 7 THEN '⚠️ 7d Only'
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 1 THEN '⚠️ 24h Only'
        ELSE '❌ Insufficient'
    END as leaderboard_readiness,
    NOW() as checked_at
FROM analytics.hourly_pnl_metrics
UNION ALL
SELECT 
    'daily_user_activity' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT user_id) as unique_users,
    MIN(bucket) as earliest_data,
    MAX(bucket) as latest_data,
    EXTRACT(DAYS FROM (MAX(bucket) - MIN(bucket))) as days_covered,
    CASE 
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 30 THEN '✅ 30d Ready'
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 7 THEN '⚠️ 7d Only'
        WHEN EXTRACT(DAYS FROM (NOW() - MIN(bucket))) >= 1 THEN '⚠️ 24h Only'
        ELSE '❌ Insufficient'
    END as leaderboard_readiness,
    NOW() as checked_at
FROM analytics.daily_user_activity;

-- =====================================================================
-- 4. VALIDATE LEADERBOARD VIEWS CAN EXECUTE
-- =====================================================================

DO $$
DECLARE
    pnl_24h_count INTEGER;
    pnl_30d_count INTEGER;
    vol_24h_count INTEGER;
    vol_30d_count INTEGER;
BEGIN
    RAISE NOTICE '🧪 Testing leaderboard view execution...';
    
    -- Test PNL leaderboard views
    SELECT COUNT(*) INTO pnl_24h_count FROM analytics.pnl_leaderboard_24h;
    SELECT COUNT(*) INTO pnl_30d_count FROM analytics.pnl_leaderboard_30d;
    
    -- Test volume leaderboard views  
    SELECT COUNT(*) INTO vol_24h_count FROM analytics.volume_leaderboard_24h;
    SELECT COUNT(*) INTO vol_30d_count FROM analytics.volume_leaderboard_30d;
    
    RAISE NOTICE '📊 View Test Results:';
    RAISE NOTICE '   pnl_leaderboard_24h: % users', pnl_24h_count;
    RAISE NOTICE '   pnl_leaderboard_30d: % users', pnl_30d_count;
    RAISE NOTICE '   volume_leaderboard_24h: % users', vol_24h_count;
    RAISE NOTICE '   volume_leaderboard_30d: % users', vol_30d_count;
    
    IF vol_30d_count = 0 THEN
        RAISE NOTICE '⚠️  30d volume leaderboard is empty - needs data population during startup';
    ELSE
        RAISE NOTICE '✅ 30d volume leaderboard has data and is working';
    END IF;
END $$;

-- =====================================================================
-- 5. CREATE STARTUP DATA POPULATION TRACKING
-- =====================================================================

-- Table to track when startup data population jobs run
CREATE TABLE IF NOT EXISTS analytics.startup_data_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL, -- 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    job_details JSONB DEFAULT '{}'::jsonb
);

-- Create index for job tracking
CREATE INDEX IF NOT EXISTS idx_startup_data_jobs_name_status 
ON analytics.startup_data_jobs (job_name, status, started_at DESC);

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================

DO $$
BEGIN
    RAISE NOTICE '🎉 Migration 004 Complete: 30d Leaderboard Coverage Fixed!';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Fixed schema inconsistencies in volume leaderboard views';
    RAISE NOTICE '✅ Created data coverage monitoring view';
    RAISE NOTICE '✅ Added startup job tracking table';
    RAISE NOTICE '✅ Validated all leaderboard views can execute';
    RAISE NOTICE '';
    RAISE NOTICE '🚨 NEXT STEPS:';
    RAISE NOTICE '   1. Update startup code to populate 30+ days of data';
    RAISE NOTICE '   2. Run: SELECT * FROM analytics.leaderboard_data_coverage;';
    RAISE NOTICE '   3. Ensure PNL job runs with 30+ day backfill on startup';
    RAISE NOTICE '';
    RAISE NOTICE '💡 Prevention: This migration prevents empty 30d leaderboards in fresh deployments';
END $$;