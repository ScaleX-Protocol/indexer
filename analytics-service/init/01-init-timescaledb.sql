-- Initialize TimescaleDB Extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create analytics database schema
CREATE SCHEMA IF NOT EXISTS analytics;

-- Create trades table as hypertable
CREATE TABLE IF NOT EXISTS analytics.trades (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL, -- 'buy' or 'sell'
    quantity DECIMAL(36, 18) NOT NULL,
    price DECIMAL(36, 18) NOT NULL,
    quote_qty DECIMAL(36, 18) NOT NULL,
    commission DECIMAL(36, 18) NOT NULL,
    commission_asset TEXT NOT NULL,
    is_maker BOOLEAN NOT NULL DEFAULT false,
    is_buyer BOOLEAN NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trade_id TEXT,
    order_id TEXT,
    PRIMARY KEY (timestamp, id),
    UNIQUE (trade_id, timestamp) -- Include timestamp in unique constraint for hypertable compatibility
);

-- Convert to hypertable (partitioned by time)
SELECT create_hypertable('analytics.trades', 'timestamp', if_not_exists => TRUE);

-- Create balances table as hypertable
CREATE TABLE IF NOT EXISTS analytics.balances (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (timestamp, id)
);

SELECT create_hypertable('analytics.balances', 'timestamp', if_not_exists => TRUE);

-- Create portfolio snapshots as hypertable
CREATE TABLE IF NOT EXISTS analytics.portfolio_snapshots (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    total_value DECIMAL(36, 18) NOT NULL,
    asset_values JSONB NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (timestamp, id)
);

SELECT create_hypertable('analytics.portfolio_snapshots', 'timestamp', if_not_exists => TRUE);

-- Create positions table for PnL tracking
CREATE TABLE IF NOT EXISTS analytics.positions (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    quantity DECIMAL(36, 18) NOT NULL DEFAULT 0,
    avg_cost DECIMAL(36, 18) NOT NULL DEFAULT 0,
    total_cost DECIMAL(36, 18) NOT NULL DEFAULT 0,
    realized_pnl DECIMAL(36, 18) NOT NULL DEFAULT 0,
    unrealized_pnl DECIMAL(36, 18) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, symbol)
);

-- Create market metrics as hypertable
CREATE TABLE IF NOT EXISTS analytics.market_metrics (
    id BIGSERIAL,
    symbol TEXT NOT NULL,
    volume_1h DECIMAL(36, 18) NOT NULL DEFAULT 0,
    trades_1h INTEGER NOT NULL DEFAULT 0,
    unique_traders_1h INTEGER NOT NULL DEFAULT 0,
    high_1h DECIMAL(36, 18),
    low_1h DECIMAL(36, 18),
    open_1h DECIMAL(36, 18),
    close_1h DECIMAL(36, 18),
    avg_price_1h DECIMAL(36, 18),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (timestamp, id)
);

SELECT create_hypertable('analytics.market_metrics', 'timestamp', if_not_exists => TRUE);

-- Create leaderboards table
CREATE TABLE IF NOT EXISTS analytics.leaderboards (
    id BIGSERIAL,
    type TEXT NOT NULL, -- 'pnl' or 'volume'
    period TEXT NOT NULL, -- '24h', '7d', '30d'
    user_id TEXT NOT NULL,
    value DECIMAL(36, 18) NOT NULL,
    rank INTEGER NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (timestamp, type, period, user_id) -- Put timestamp first for hypertable compatibility
);

SELECT create_hypertable('analytics.leaderboards', 'timestamp', if_not_exists => TRUE);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trades_user_symbol_time ON analytics.trades (user_id, symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol_time ON analytics.trades (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_balances_user_time ON analytics.balances (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_user_time ON analytics.portfolio_snapshots (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_positions_user ON analytics.positions (user_id);
CREATE INDEX IF NOT EXISTS idx_market_metrics_symbol_time ON analytics.market_metrics (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboards_type_period ON analytics.leaderboards (type, period, timestamp DESC);