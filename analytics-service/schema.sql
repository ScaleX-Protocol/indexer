-- Analytics Service Database Schema

-- Portfolio snapshots for historical tracking
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    total_value DECIMAL(18, 8) NOT NULL,
    asset_values JSONB NOT NULL,
    timestamp INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_timestamp 
ON portfolio_snapshots(user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_timestamp 
ON portfolio_snapshots(timestamp DESC);

-- Hourly metrics aggregation
CREATE TABLE IF NOT EXISTS hourly_metrics (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    timestamp INTEGER NOT NULL,
    volume DECIMAL(18, 8) DEFAULT 0,
    trades INTEGER DEFAULT 0,
    unique_traders INTEGER DEFAULT 0,
    avg_price DECIMAL(18, 8) DEFAULT 0,
    high DECIMAL(18, 8) DEFAULT 0,
    low DECIMAL(18, 8) DEFAULT 0,
    open DECIMAL(18, 8) DEFAULT 0,
    close DECIMAL(18, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_hourly_metrics_symbol_timestamp 
ON hourly_metrics(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_hourly_metrics_timestamp 
ON hourly_metrics(timestamp DESC);

-- Market sentiment tracking
CREATE TABLE IF NOT EXISTS market_sentiment_history (
    id SERIAL PRIMARY KEY,
    sentiment VARCHAR(20) NOT NULL,
    score INTEGER NOT NULL,
    indicators JSONB,
    hourly_volume DECIMAL(18, 8),
    hourly_trades INTEGER,
    active_symbols INTEGER,
    timestamp INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_sentiment_timestamp 
ON market_sentiment_history(timestamp DESC);

-- Analytics event retry queue (for failed event processing)
CREATE TABLE IF NOT EXISTS analytics_retry_queue (
    id SERIAL PRIMARY KEY,
    stream_name VARCHAR(100) NOT NULL,
    message_id VARCHAR(255) NOT NULL,
    message_data JSONB NOT NULL,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_created_retry 
ON analytics_retry_queue(created_at, retry_count);

-- Performance monitoring
CREATE TABLE IF NOT EXISTS performance_metrics (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(18, 8) NOT NULL,
    tags JSONB,
    timestamp INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_name_timestamp 
ON performance_metrics(metric_name, timestamp DESC);

-- User trading statistics aggregation
CREATE TABLE IF NOT EXISTS user_trading_stats (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    total_volume DECIMAL(18, 8) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    avg_trade_size DECIMAL(18, 8) DEFAULT 0,
    largest_trade DECIMAL(18, 8) DEFAULT 0,
    profit_loss DECIMAL(18, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_user_trading_stats_user_period 
ON user_trading_stats(user_id, period_start DESC);

-- Leaderboard snapshots for different periods and types
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    leaderboard_type VARCHAR(50) NOT NULL, -- 'pnl', 'volume', 'trades', 'portfolio_growth'
    period VARCHAR(10) NOT NULL, -- '24h', '7d', '30d', 'all_time'
    value DECIMAL(18, 8) NOT NULL, -- PNL amount, volume, trade count, etc.
    percentage DECIMAL(10, 4), -- PNL percentage, growth percentage
    portfolio_value DECIMAL(18, 8), -- Current portfolio value for context
    rank_position INTEGER NOT NULL,
    total_participants INTEGER NOT NULL,
    calculation_timestamp INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, leaderboard_type, period, calculation_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_type_period_rank 
ON leaderboard_snapshots(leaderboard_type, period, rank_position);

CREATE INDEX IF NOT EXISTS idx_leaderboard_calculation_timestamp 
ON leaderboard_snapshots(calculation_timestamp DESC);

-- User positions for accurate PNL calculation (Binance-aligned)
CREATE TABLE IF NOT EXISTS user_positions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    quantity DECIMAL(18, 8) NOT NULL DEFAULT 0,  -- Current holding (can be negative for short)
    total_cost DECIMAL(18, 8) NOT NULL DEFAULT 0, -- Total cost basis 
    avg_cost DECIMAL(18, 8) NOT NULL DEFAULT 0,   -- Average cost per unit (calculated)
    realized_pnl DECIMAL(18, 8) NOT NULL DEFAULT 0, -- Realized PnL from closes
    unrealized_pnl DECIMAL(18, 8) DEFAULT 0,     -- Current unrealized PnL
    unrealized_pnl_percent DECIMAL(10, 4) DEFAULT 0, -- Unrealized PnL percentage
    trade_count INTEGER DEFAULT 0,               -- Number of trades for this position
    commission_paid DECIMAL(18, 8) DEFAULT 0,    -- Total commission paid
    last_trade_time INTEGER,
    last_price_update INTEGER,                   -- Last time unrealized PnL was calculated
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_user_positions_user_symbol 
ON user_positions(user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_user_positions_symbol 
ON user_positions(symbol);

-- Leaderboard metadata for tracking calculation status
CREATE TABLE IF NOT EXISTS leaderboard_metadata (
    id SERIAL PRIMARY KEY,
    leaderboard_type VARCHAR(50) NOT NULL,
    period VARCHAR(10) NOT NULL,
    last_calculation INTEGER NOT NULL,
    next_calculation INTEGER NOT NULL,
    calculation_duration_ms INTEGER,
    total_users_processed INTEGER,
    status VARCHAR(20) DEFAULT 'completed', -- 'running', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(leaderboard_type, period)
);

-- Comments for maintenance
COMMENT ON TABLE portfolio_snapshots IS 'Daily portfolio value snapshots for historical analysis';
COMMENT ON TABLE hourly_metrics IS 'Aggregated trading metrics by symbol and hour';
COMMENT ON TABLE market_sentiment_history IS 'Historical market sentiment calculations';
COMMENT ON TABLE analytics_retry_queue IS 'Failed analytics events for retry processing';
COMMENT ON TABLE performance_metrics IS 'System performance and monitoring metrics';
COMMENT ON TABLE user_trading_stats IS 'Aggregated user trading statistics by period';
COMMENT ON TABLE leaderboard_snapshots IS 'Leaderboard rankings for different periods and metrics';
COMMENT ON TABLE user_positions IS 'Current user positions for accurate PNL calculations';
COMMENT ON TABLE leaderboard_metadata IS 'Leaderboard calculation tracking and status';