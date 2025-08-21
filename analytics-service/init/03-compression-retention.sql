-- Configure compression policies to save storage space
-- Compress data older than 7 days

SELECT add_compression_policy('analytics.trades', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.balances', INTERVAL '7 days', if_not_exists => TRUE);  
SELECT add_compression_policy('analytics.portfolio_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.market_metrics', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.leaderboards', INTERVAL '7 days', if_not_exists => TRUE);

-- Compress continuous aggregates older than 1 day
SELECT add_compression_policy('analytics.hourly_trading_metrics', INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.daily_trading_metrics', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.daily_user_activity', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.hourly_pnl_metrics', INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_compression_policy('analytics.daily_new_users', INTERVAL '30 days', if_not_exists => TRUE);

-- Set up retention policies to automatically delete old data
-- Keep raw trades for 1 year, balances for 2 years, others for 6 months

SELECT add_retention_policy('analytics.trades', INTERVAL '1 year', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.balances', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.portfolio_snapshots', INTERVAL '1 year', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.market_metrics', INTERVAL '6 months', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.leaderboards', INTERVAL '6 months', if_not_exists => TRUE);

-- Keep continuous aggregates longer since they're compressed
SELECT add_retention_policy('analytics.hourly_trading_metrics', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.daily_trading_metrics', INTERVAL '5 years', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.daily_user_activity', INTERVAL '5 years', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.hourly_pnl_metrics', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('analytics.daily_new_users', INTERVAL '5 years', if_not_exists => TRUE);