-- Create continuous aggregates for real-time analytics
-- These replace the cron job aggregations with automatic materialized views

-- Hourly trading metrics continuous aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.hourly_trading_metrics
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 hour', timestamp) AS bucket,
    symbol,
    SUM(quote_qty) AS volume,
    COUNT(*) AS trades_count,
    COUNT(DISTINCT user_id) AS unique_traders,
    AVG(price) AS avg_price,
    MAX(price) AS high_price,
    MIN(price) AS low_price,
    FIRST(price, timestamp) AS open_price,
    LAST(price, timestamp) AS close_price
FROM analytics.trades
GROUP BY bucket, symbol;

-- Daily trading metrics continuous aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_trading_metrics
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 day', timestamp) AS bucket,
    symbol,
    SUM(quote_qty) AS volume,
    COUNT(*) AS trades_count,
    COUNT(DISTINCT user_id) AS unique_traders,
    AVG(price) AS avg_price,
    MAX(price) AS high_price,
    MIN(price) AS low_price,
    FIRST(price, timestamp) AS open_price,
    LAST(price, timestamp) AS close_price
FROM analytics.trades
GROUP BY bucket, symbol;

-- Daily user activity metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_user_activity
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 day', timestamp) AS bucket,
    user_id,
    COUNT(*) AS trades_count,
    SUM(quote_qty) AS total_volume,
    COUNT(DISTINCT symbol) AS symbols_traded,
    SUM(commission) AS total_fees_paid
FROM analytics.trades
GROUP BY bucket, user_id;

-- Hourly PnL metrics for leaderboards
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.hourly_pnl_metrics
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 hour', updated_at) AS bucket,
    user_id,
    SUM(realized_pnl) AS total_realized_pnl,
    SUM(unrealized_pnl) AS total_unrealized_pnl,
    SUM(realized_pnl + unrealized_pnl) AS total_pnl
FROM analytics.positions
GROUP BY bucket, user_id;

-- Daily new users (first trade ever)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_new_users
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 day', first_trade_time) AS bucket,
    COUNT(*) AS new_users_count
FROM (
    SELECT 
        user_id,
        MIN(timestamp) AS first_trade_time
    FROM analytics.trades
    GROUP BY user_id
) first_trades
GROUP BY bucket;

-- Set up refresh policies for continuous aggregates
-- Refresh every 5 minutes for hourly data
SELECT add_continuous_aggregate_policy('analytics.hourly_trading_metrics',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('analytics.hourly_pnl_metrics',
    start_offset => INTERVAL '2 hours', 
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE);

-- Refresh every 30 minutes for daily data  
SELECT add_continuous_aggregate_policy('analytics.daily_trading_metrics',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '30 minutes', 
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('analytics.daily_user_activity',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes', 
    if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('analytics.daily_new_users',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE);