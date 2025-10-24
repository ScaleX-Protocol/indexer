-- Migration: Create historical liquidity snapshot tables
-- This solves the problem that orderBookDepth only stores current state

-- 1. Detailed liquidity snapshots (raw order book depth at specific times)
CREATE TABLE IF NOT EXISTS analytics.liquidity_snapshots (
    snapshot_timestamp INTEGER NOT NULL,
    pool_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL, -- 'Buy' or 'Sell'
    price NUMERIC NOT NULL,
    quantity NUMERIC NOT NULL,
    order_count INTEGER NOT NULL DEFAULT 0,
    liquidity_value NUMERIC NOT NULL, -- price * quantity (normalized)
    interval_type TEXT NOT NULL DEFAULT 'hourly', -- 'hourly', 'daily', etc
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key must include partitioning column for TimescaleDB
    PRIMARY KEY (snapshot_timestamp, pool_id, side, interval_type)
);

-- 2. Aggregated liquidity snapshots (for faster queries)
CREATE TABLE IF NOT EXISTS analytics.liquidity_snapshots_aggregated (
    snapshot_timestamp INTEGER NOT NULL,
    pool_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    bid_liquidity NUMERIC NOT NULL DEFAULT 0,
    ask_liquidity NUMERIC NOT NULL DEFAULT 0,
    total_liquidity NUMERIC NOT NULL DEFAULT 0,
    bid_orders INTEGER NOT NULL DEFAULT 0,
    ask_orders INTEGER NOT NULL DEFAULT 0,
    best_bid NUMERIC DEFAULT 0,
    best_ask NUMERIC DEFAULT 0,
    spread DECIMAL(10,6) DEFAULT 0,
    interval_type TEXT NOT NULL DEFAULT 'hourly',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key must include partitioning column for TimescaleDB
    PRIMARY KEY (snapshot_timestamp, pool_id, interval_type)
);

-- Convert to TimescaleDB hypertables for time-series performance
SELECT create_hypertable(
    'analytics.liquidity_snapshots', 
    'snapshot_timestamp',
    chunk_time_interval => 86400,  -- 1 day chunks
    if_not_exists => TRUE
);

SELECT create_hypertable(
    'analytics.liquidity_snapshots_aggregated', 
    'snapshot_timestamp',
    chunk_time_interval => 86400,  -- 1 day chunks  
    if_not_exists => TRUE
);

-- Indexes for fast time-series queries
CREATE INDEX IF NOT EXISTS idx_liquidity_snapshots_time_pool 
ON analytics.liquidity_snapshots(snapshot_timestamp, pool_id);

CREATE INDEX IF NOT EXISTS idx_liquidity_snapshots_symbol_time 
ON analytics.liquidity_snapshots(symbol, snapshot_timestamp);

CREATE INDEX IF NOT EXISTS idx_liquidity_snapshots_agg_time_symbol 
ON analytics.liquidity_snapshots_aggregated(snapshot_timestamp, symbol);

CREATE INDEX IF NOT EXISTS idx_liquidity_snapshots_agg_pool_time 
ON analytics.liquidity_snapshots_aggregated(pool_id, snapshot_timestamp);

-- Note: Compression and retention policies can be added later if needed
-- They require columnstore extension which may not be available in all setups

COMMENT ON TABLE analytics.liquidity_snapshots IS 
'Historical order book depth snapshots taken periodically. Solves the problem that orderBookDepth only stores current state.';

COMMENT ON TABLE analytics.liquidity_snapshots_aggregated IS 
'Aggregated liquidity metrics per pool/timestamp for fast historical queries.';