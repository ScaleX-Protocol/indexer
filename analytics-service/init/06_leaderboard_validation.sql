-- =====================================================================
-- Leaderboard Validation Script for Fresh Deployments
-- Ensures all leaderboard components are properly initialized
-- =====================================================================

-- =====================================================================
-- 1. VALIDATE REQUIRED TABLES EXIST
-- =====================================================================

DO $$
DECLARE
    missing_tables TEXT[] := ARRAY[]::TEXT[];
    required_table TEXT;
BEGIN
    RAISE NOTICE '🔍 Validating required tables for leaderboards...';
    
    -- Check required tables
    FOR required_table IN 
        SELECT unnest(ARRAY['hourly_pnl_metrics', 'daily_user_activity', 'startup_data_jobs', 'positions'])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'analytics' AND table_name = required_table
        ) THEN
            missing_tables := array_append(missing_tables, required_table);
        END IF;
    END LOOP;
    
    IF array_length(missing_tables, 1) > 0 THEN
        RAISE NOTICE '❌ Missing required tables: %', array_to_string(missing_tables, ', ');
        RAISE NOTICE '💡 Run previous initialization scripts first';
    ELSE
        RAISE NOTICE '✅ All required tables exist';
    END IF;
END $$;

-- =====================================================================
-- 2. VALIDATE LEADERBOARD VIEWS EXIST AND ARE QUERYABLE
-- =====================================================================

DO $$
DECLARE
    view_name TEXT;
    view_count INTEGER;
    error_views TEXT[] := ARRAY[]::TEXT[];
BEGIN
    RAISE NOTICE '🔍 Validating leaderboard views...';
    
    -- Test each leaderboard view
    FOR view_name IN 
        SELECT unnest(ARRAY[
            'pnl_leaderboard_24h', 'pnl_leaderboard_7d', 'pnl_leaderboard_30d',
            'volume_leaderboard_24h', 'volume_leaderboard_7d', 'volume_leaderboard_30d'
        ])
    LOOP
        BEGIN
            EXECUTE format('SELECT COUNT(*) FROM analytics.%I', view_name) INTO view_count;
            RAISE NOTICE '✅ %: % entries', view_name, view_count;
        EXCEPTION WHEN OTHERS THEN
            error_views := array_append(error_views, view_name);
            RAISE NOTICE '❌ %: ERROR - %', view_name, SQLERRM;
        END;
    END LOOP;
    
    IF array_length(error_views, 1) > 0 THEN
        RAISE NOTICE '⚠️ Views with errors: %', array_to_string(error_views, ', ');
        RAISE NOTICE '💡 Run migration 004_ensure_30d_leaderboard_coverage.sql to fix';
    ELSE
        RAISE NOTICE '✅ All leaderboard views are queryable';
    END IF;
END $$;

-- =====================================================================
-- 3. CREATE STARTUP VALIDATION FUNCTION
-- =====================================================================

CREATE OR REPLACE FUNCTION analytics.validate_leaderboard_readiness()
RETURNS TABLE (
    check_name TEXT,
    status TEXT,
    details TEXT,
    recommendation TEXT
) AS $$
DECLARE
    pnl_data_days INTEGER := 0;
    pnl_users INTEGER := 0;
    vol_30d_count INTEGER := 0;
    startup_job_status TEXT := 'not_found';
BEGIN
    -- Check PNL data coverage
    SELECT 
        EXTRACT(DAYS FROM (NOW() - MIN(bucket)))::INTEGER,
        COUNT(DISTINCT user_id)
    INTO pnl_data_days, pnl_users
    FROM analytics.hourly_pnl_metrics;
    
    -- Check 30d volume leaderboard
    SELECT COUNT(*) INTO vol_30d_count FROM analytics.volume_leaderboard_30d;
    
    -- Check startup job status
    SELECT status INTO startup_job_status 
    FROM analytics.startup_data_jobs 
    WHERE job_name = 'initial_pnl_backfill' 
    ORDER BY started_at DESC 
    LIMIT 1;
    
    -- Return validation results
    RETURN QUERY VALUES
        (
            'PNL Data Coverage',
            CASE WHEN pnl_data_days >= 30 THEN 'PASS' ELSE 'FAIL' END,
            format('%s days, %s users', COALESCE(pnl_data_days, 0), COALESCE(pnl_users, 0)),
            CASE WHEN pnl_data_days < 30 THEN 'Restart service to trigger 35-day backfill' ELSE 'Sufficient for all leaderboards' END
        ),
        (
            '30d Volume Leaderboard',
            CASE WHEN vol_30d_count > 0 THEN 'PASS' ELSE 'FAIL' END,
            format('%s entries', vol_30d_count),
            CASE WHEN vol_30d_count = 0 THEN 'Check data population and view schema' ELSE 'Working correctly' END
        ),
        (
            'Startup Job Status',
            CASE WHEN startup_job_status = 'completed' THEN 'PASS' ELSE 'FAIL' END,
            COALESCE(startup_job_status, 'not_found'),
            CASE WHEN startup_job_status != 'completed' THEN 'Wait for startup job or restart service' ELSE 'Completed successfully' END
        );
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 4. CREATE MONITORING DASHBOARD VIEW
-- =====================================================================

CREATE OR REPLACE VIEW analytics.leaderboard_health_dashboard AS
SELECT 
    NOW() as check_time,
    
    -- Data Coverage
    (SELECT COUNT(*) FROM analytics.hourly_pnl_metrics) as total_pnl_records,
    (SELECT COUNT(DISTINCT user_id) FROM analytics.hourly_pnl_metrics) as unique_users,
    (SELECT EXTRACT(DAYS FROM (NOW() - MIN(bucket))) FROM analytics.hourly_pnl_metrics) as days_of_data,
    
    -- Leaderboard Counts
    (SELECT COUNT(*) FROM analytics.pnl_leaderboard_30d) as pnl_30d_users,
    (SELECT COUNT(*) FROM analytics.volume_leaderboard_30d) as volume_30d_users,
    
    -- Startup Jobs
    (SELECT status FROM analytics.startup_data_jobs WHERE job_name = 'initial_pnl_backfill' ORDER BY started_at DESC LIMIT 1) as latest_backfill_status,
    (SELECT records_processed FROM analytics.startup_data_jobs WHERE job_name = 'initial_pnl_backfill' ORDER BY started_at DESC LIMIT 1) as latest_backfill_records,
    
    -- Overall Health Assessment
    CASE 
        WHEN (SELECT COUNT(*) FROM analytics.volume_leaderboard_30d) > 0 
         AND (SELECT EXTRACT(DAYS FROM (NOW() - MIN(bucket))) FROM analytics.hourly_pnl_metrics) >= 30
        THEN '✅ HEALTHY'
        WHEN (SELECT COUNT(*) FROM analytics.hourly_pnl_metrics) = 0
        THEN '❌ NO DATA'
        WHEN (SELECT EXTRACT(DAYS FROM (NOW() - MIN(bucket))) FROM analytics.hourly_pnl_metrics) < 30
        THEN '⚠️ INSUFFICIENT DATA'
        ELSE '⚠️ NEEDS ATTENTION'
    END as overall_health;

-- =====================================================================
-- 5. RUN INITIAL VALIDATION
-- =====================================================================

-- Display validation results
SELECT * FROM analytics.validate_leaderboard_readiness();

-- Display dashboard
SELECT * FROM analytics.leaderboard_health_dashboard;

-- =====================================================================
-- VALIDATION COMPLETE
-- =====================================================================

DO $$
DECLARE
    health_status TEXT;
BEGIN
    SELECT overall_health INTO health_status FROM analytics.leaderboard_health_dashboard;
    
    RAISE NOTICE '🏁 Leaderboard Validation Complete!';
    RAISE NOTICE '';
    RAISE NOTICE 'Overall Health: %', health_status;
    RAISE NOTICE '';
    RAISE NOTICE '📊 To monitor leaderboard health:';
    RAISE NOTICE '   SELECT * FROM analytics.leaderboard_health_dashboard;';
    RAISE NOTICE '';
    RAISE NOTICE '🔍 To run detailed validation:';
    RAISE NOTICE '   SELECT * FROM analytics.validate_leaderboard_readiness();';
    RAISE NOTICE '';
    
    IF health_status = '✅ HEALTHY' THEN
        RAISE NOTICE '🎉 All leaderboards should be working correctly!';
    ELSE
        RAISE NOTICE '⚠️ Some issues detected - check recommendations above';
        RAISE NOTICE '💡 Restart the analytics service to trigger data population';
    END IF;
END $$;