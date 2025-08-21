-- Database Specialization Migration: Remove Duplicate Tables
-- This migration implements the database specialization strategy by removing
-- conflicting duplicate tables from TimescaleDB and keeping them only in Ponder

-- =============================================================================
-- PHASE 1: BACKUP AND ANALYSIS
-- =============================================================================

-- Create backup tables before dropping (safety measure)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = 'trades') THEN
        EXECUTE 'CREATE TABLE IF NOT EXISTS analytics.trades_backup_' || to_char(now(), 'YYYY_MM_DD_HH24_MI_SS') || ' AS SELECT * FROM analytics.trades';
        RAISE NOTICE 'Backup created for analytics.trades';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = 'balances') THEN
        EXECUTE 'CREATE TABLE IF NOT EXISTS analytics.balances_backup_' || to_char(now(), 'YYYY_MM_DD_HH24_MI_SS') || ' AS SELECT * FROM analytics.balances';
        RAISE NOTICE 'Backup created for analytics.balances';
    END IF;
END $$;

-- =============================================================================
-- PHASE 2: REMOVE DUPLICATE TABLES FROM TIMESCALEDB
-- =============================================================================

-- Drop analytics.trades (conflicts with ponder.trades)
-- Ponder schema: id:TEXT, chainId:INTEGER, transactionId:TEXT, poolId:HEX, orderId:TEXT, price:BIGINT, quantity:BIGINT, timestamp:INTEGER
-- TimescaleDB schema: id:BIGSERIAL, user_id:TEXT, symbol:TEXT, side:TEXT, quantity:DECIMAL, price:DECIMAL, timestamp:TIMESTAMPTZ
-- CONFLICT: Completely different schemas - TimescaleDB version should be removed

DROP TABLE IF EXISTS analytics.trades CASCADE;
RAISE NOTICE 'Removed analytics.trades (conflicted with ponder.trades)';

-- Drop analytics.balances (conflicts with ponder.balances) 
-- Ponder schema: id:TEXT, chainId:INTEGER, user:HEX, currency:HEX, amount:BIGINT, lockedAmount:BIGINT
-- TimescaleDB schema: id:BIGSERIAL, user_id:TEXT, symbol:TEXT, amount:DECIMAL, timestamp:TIMESTAMPTZ
-- CONFLICT: Different field names and types - TimescaleDB version should be removed

DROP TABLE IF EXISTS analytics.balances CASCADE;
RAISE NOTICE 'Removed analytics.balances (conflicted with ponder.balances)';

-- =============================================================================
-- PHASE 3: UPDATE SPECIALIZED TIMESCALEDB TABLES
-- =============================================================================

-- Keep and enhance analytics-specific tables that don't conflict with Ponder

-- Update positions table with better indexing for PnL calculations
DROP INDEX IF EXISTS analytics.idx_positions_user;
CREATE INDEX IF NOT EXISTS idx_positions_user_updated ON analytics.positions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_symbol_updated ON analytics.positions (symbol, updated_at DESC);

-- Update leaderboards table indexing for better performance
CREATE INDEX IF NOT EXISTS idx_leaderboards_type_period_rank ON analytics.leaderboards (type, period, rank, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboards_user_latest ON analytics.leaderboards (user_id, timestamp DESC);

-- Update market_metrics with better time-series indexing
CREATE INDEX IF NOT EXISTS idx_market_metrics_symbol_timestamp ON analytics.market_metrics (symbol, timestamp DESC);

-- Update portfolio_snapshots indexing
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_timestamp ON analytics.portfolio_snapshots (user_id, timestamp DESC);

-- =============================================================================
-- PHASE 4: CREATE VIEW-BASED ACCESS (OPTIONAL)
-- =============================================================================

-- Optional: Create views for backward compatibility if any code still references the removed tables
-- These views will query from Ponder database (requires dblink or foreign data wrapper)

-- Note: These views require cross-database access setup
-- For now, we'll comment them out and handle in application code

-- CREATE OR REPLACE VIEW analytics.trades_view AS
-- SELECT 
--     id::TEXT as trade_id,
--     'unknown'::TEXT as user_id,
--     'unknown'::TEXT as symbol, 
--     'unknown'::TEXT as side,
--     quantity::DECIMAL as quantity,
--     price::DECIMAL as price,
--     0::DECIMAL as quote_qty,
--     0::DECIMAL as commission,
--     'USDC'::TEXT as commission_asset,
--     false as is_maker,
--     true as is_buyer,
--     to_timestamp(timestamp) as timestamp,
--     id as trade_id,
--     orderId as order_id
-- FROM ponder.trades;

-- =============================================================================
-- PHASE 5: VERIFICATION
-- =============================================================================

-- Verify tables are properly removed
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = 'trades') THEN
        RAISE EXCEPTION 'ERROR: analytics.trades still exists after migration';
    ELSE
        RAISE NOTICE 'SUCCESS: analytics.trades properly removed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = 'balances') THEN
        RAISE EXCEPTION 'ERROR: analytics.balances still exists after migration';
    ELSE
        RAISE NOTICE 'SUCCESS: analytics.balances properly removed';
    END IF;
END $$;

-- List remaining analytics tables (should be specialized time-series tables only)
SELECT 
    table_name,
    CASE 
        WHEN table_name = 'positions' THEN 'PnL tracking'
        WHEN table_name = 'leaderboards' THEN 'Rankings and leaderboards'
        WHEN table_name = 'portfolio_snapshots' THEN 'Historical portfolio values'
        WHEN table_name = 'market_metrics' THEN 'Time-series market data'
        ELSE 'Other analytics table'
    END as purpose
FROM information_schema.tables 
WHERE table_schema = 'analytics' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- =============================================================================
-- PHASE 6: DATABASE RESPONSIBILITY SUMMARY
-- =============================================================================

/* 
DATABASE SPECIALIZATION COMPLETE:

PONDER DATABASE (Real-time Operational Data):
✅ trades              → Live trade executions (source of truth)
✅ balances            → Current user balances (source of truth)  
✅ order_book_depth    → Real-time liquidity data
✅ orders              → Active and historical orders
✅ pools               → Market definitions
✅ currencies          → Asset definitions
✅ order_book_trades   → Order book execution history

TIMESCALEDB (Analytics Time-series Data):
✅ analytics.positions           → PnL position tracking
✅ analytics.leaderboards        → Rankings and competitions
✅ analytics.portfolio_snapshots → Historical portfolio values
✅ analytics.market_metrics      → Aggregated market data

REMOVED DUPLICATES:
❌ analytics.trades    → Removed (use ponder.trades)
❌ analytics.balances  → Removed (use ponder.balances)

APPLICATION CHANGES REQUIRED:
1. Update AnalyticsService to use ponder.trades for trade data
2. Update AnalyticsService to use ponder.balances for balance data
3. Keep using TimescaleDB for PnL, leaderboards, and time-series analytics
4. Test all analytics endpoints to ensure they work with new schema
*/

RAISE NOTICE '=============================================================================';
RAISE NOTICE 'DATABASE SPECIALIZATION MIGRATION COMPLETED SUCCESSFULLY';
RAISE NOTICE 'Next step: Update application code to use specialized databases';
RAISE NOTICE '=============================================================================';