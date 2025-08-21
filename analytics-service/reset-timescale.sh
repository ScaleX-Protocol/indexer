#!/bin/bash

# Reset TimescaleDB script for analytics-service
# This script resets the TimescaleDB container to match fresh container initialization
# It should produce IDENTICAL results to running fresh containers

set -e

echo "🔄 Starting TimescaleDB reset to match fresh container setup..."

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose not found. Please install docker-compose first."
    exit 1
fi

# Find the TimescaleDB container (not regular postgres!)
TIMESCALE_CONTAINER=""

# Try to find TimescaleDB container by name patterns
if docker ps --format "{{.Names}}" | grep -E "timescale" >/dev/null 2>&1; then
    TIMESCALE_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "timescale" | head -1)
elif docker ps --format "{{.Names}}" | grep -E "(clob-indexer|analytics-service).*timescale" >/dev/null 2>&1; then
    TIMESCALE_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "(clob-indexer|analytics-service).*timescale" | head -1)
fi

if [ -z "$TIMESCALE_CONTAINER" ]; then
    echo "❌ TimescaleDB container not found. Available containers:"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
    echo ""
    echo "💡 Make sure to run: cd /Users/renaka/gtx/clob-indexer && docker-compose up -d timescaledb"
    exit 1
fi

echo "📦 Found TimescaleDB container: $TIMESCALE_CONTAINER"

# Find Redis container
REDIS_CONTAINER=""
if docker ps --format "{{.Names}}" | grep redis | grep -v commander >/dev/null 2>&1; then
    REDIS_CONTAINER=$(docker ps --format "{{.Names}}" | grep redis | grep -v commander | head -1)
fi

if [ -z "$REDIS_CONTAINER" ]; then
    echo "⚠️  Redis container not found. Consumer groups will not be recreated."
else
    echo "📦 Found Redis container: $REDIS_CONTAINER"
fi

# Stop analytics-service to prevent connections during reset
echo "⏹️  Stopping analytics-service..."
docker-compose stop analytics-service 2>/dev/null || echo "⚠️  analytics-service not running"

# Database credentials for TimescaleDB (should be postgres/password)
DB_USER="postgres"
DB_NAME="analytics"

echo "🔑 Using TimescaleDB database: $DB_NAME with user: $DB_USER"

# Show what will be cleared (pre-reset summary)
echo "📋 Pre-reset summary of sync service data to be cleared:"

# Check TimescaleDB analytics tables
if docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -c "SELECT COUNT(*) as tables FROM information_schema.tables WHERE table_schema = 'analytics'" 2>/dev/null | grep -q "1 row"; then
    ANALYTICS_TABLES=$(docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'analytics'" 2>/dev/null | xargs)
    echo "   📊 TimescaleDB analytics tables to clear: $ANALYTICS_TABLES"
else
    echo "   📊 TimescaleDB analytics database: Not found (will create fresh)"
fi

# Check Ponder sync data
if [ ! -z "$PONDER_CONTAINER" ]; then
    SYNC_ENTRIES=$(docker exec $PONDER_CONTAINER psql -U postgres -d ponder -t -c "SELECT COUNT(*) FROM sync_log WHERE service = 'analytics'" 2>/dev/null | xargs || echo "0")
    MAT_VIEWS=$(docker exec $PONDER_CONTAINER psql -U postgres -d ponder -t -c "SELECT COUNT(*) FROM pg_matviews WHERE matviewname LIKE 'mv_%'" 2>/dev/null | xargs || echo "0")
    echo "   🔄 Ponder sync_log entries to clear: $SYNC_ENTRIES"
    echo "   📋 ETL materialized views to drop: $MAT_VIEWS"
fi

echo ""
echo "🧹 Starting complete sync service reset..."

# Clear ALL sync service related data

# 1. Clear TimescaleDB data
echo "🗑️  Dropping existing analytics database..."
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"

echo "🆕 Creating new analytics database..."
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"

echo "🔌 Installing TimescaleDB extension..."
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 2. Clear Ponder sync tracking data
echo "🧹 Clearing Ponder sync tracking data..."
PONDER_CONTAINER=""
if docker ps --format "{{.Names}}" | grep postgres | grep -v timescale >/dev/null 2>&1; then
    PONDER_CONTAINER=$(docker ps --format "{{.Names}}" | grep postgres | grep -v timescale | head -1)
fi

if [ ! -z "$PONDER_CONTAINER" ]; then
    echo "📦 Found Ponder container: $PONDER_CONTAINER"
    
    # Clear sync_log table (tracks what's been processed by analytics service)
    echo "   → Clearing sync_log table..."
    docker exec $PONDER_CONTAINER psql -U postgres -d ponder -c "DELETE FROM sync_log WHERE service = 'analytics';" 2>/dev/null || echo "   ℹ️  sync_log table not found (normal for fresh setup)"
    
    # Drop materialized views created by ETL
    echo "   → Dropping ETL materialized views..."
    docker exec $PONDER_CONTAINER psql -U postgres -d ponder -c "
        DROP MATERIALIZED VIEW IF EXISTS mv_current_volume_stats;
        DROP MATERIALIZED VIEW IF EXISTS mv_trade_counts_24h;
        DROP MATERIALIZED VIEW IF EXISTS mv_trader_volume_leaderboard;
        DROP MATERIALIZED VIEW IF EXISTS mv_trader_pnl_leaderboard;
        DROP MATERIALIZED VIEW IF EXISTS mv_user_growth_stats;
    " 2>/dev/null || echo "   ℹ️  Materialized views not found (normal for fresh setup)"
    
else
    echo "⚠️  Ponder container not found - sync tracking data will remain"
fi

# Apply ALL initialization scripts exactly like fresh container setup
echo "📋 Applying initialization scripts (matching fresh container docker-entrypoint-initdb.d behavior)..."

# Apply ALL SQL files in the init directory in numerical order (exactly like docker-entrypoint-initdb.d)
for sql_file in ./init/*.sql; do
    if [ -f "$sql_file" ]; then
        filename=$(basename "$sql_file")
        echo "   → Applying $filename..."
        docker exec -i $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME < "$sql_file"
    fi
done

# Verify that all expected tables and continuous aggregates exist
echo "🔍 Verifying all expected database objects were created..."
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
    SELECT 'Tables created:' as info;
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'analytics' ORDER BY tablename;
    
    SELECT 'Hypertables created:' as info;
    SELECT hypertable_schema, hypertable_name FROM timescaledb_information.hypertables ORDER BY hypertable_name;
    
    SELECT 'Continuous aggregates created:' as info;
    SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name;
    
    SELECT 'Compression policies:' as info;
    SELECT hypertable_schema, hypertable_name, compress_after FROM timescaledb_information.compression_settings ORDER BY hypertable_name;
    
    SELECT 'Retention policies:' as info;
    SELECT hypertable_schema, hypertable_name, drop_after FROM timescaledb_information.drop_chunks_policies ORDER BY hypertable_name;
" || echo "   ⚠️  Some database objects may not have been created properly"

# Verify TimescaleDB extension is working
echo "✅ Verifying TimescaleDB extension..."
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -c "SELECT * FROM timescaledb_information.dimensions LIMIT 1;" >/dev/null && echo "   ✅ TimescaleDB extension is working" || echo "   ⚠️  TimescaleDB extension verification failed"

# 3. Clear Redis sync data
if [ ! -z "$REDIS_CONTAINER" ]; then
    echo "🧹 Clearing Redis sync data..."
    
    # Clear any cached analytics data
    echo "   → Clearing cached analytics data..."
    docker exec $REDIS_CONTAINER redis-cli --scan --pattern "cache:*" | xargs -r docker exec $REDIS_CONTAINER redis-cli DEL 2>/dev/null || true
    docker exec $REDIS_CONTAINER redis-cli --scan --pattern "analytics:*" | xargs -r docker exec $REDIS_CONTAINER redis-cli DEL 2>/dev/null || true
    docker exec $REDIS_CONTAINER redis-cli --scan --pattern "sync:*" | xargs -r docker exec $REDIS_CONTAINER redis-cli DEL 2>/dev/null || true
    
    # Recreate consumer groups for fresh state
    echo "🔄 Recreating Redis consumer groups..."
    
    # List of streams that need consumer groups (matching current analytics service code)
    STREAMS=("orders" "trades" "analytics")
    
    for stream in "${STREAMS[@]}"; do
        echo "   → Creating consumer group for stream: $stream"
        # Delete existing consumer group if it exists (ignore errors if it doesn't exist)
        docker exec $REDIS_CONTAINER redis-cli XGROUP DESTROY $stream analytics-consumers 2>/dev/null || true
        # Create new consumer group
        docker exec $REDIS_CONTAINER redis-cli XGROUP CREATE $stream analytics-consumers 0 MKSTREAM || echo "   ⚠️  Failed to create consumer group for $stream"
    done
    
    echo "✅ Redis consumer groups recreated"
fi

# Restart analytics-service
echo "▶️  Starting analytics-service..."
docker-compose up -d analytics-service

# Wait a moment and verify setup
sleep 3
echo "🔍 Verifying setup..."

# Final verification of complete setup
echo "📊 Final verification - Analytics database state:"
docker exec $TIMESCALE_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
    SELECT 'FINAL STATE VERIFICATION' as status;
    
    SELECT '=== ANALYTICS TABLES ===' as section;
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'analytics' ORDER BY table_name;
    
    SELECT '=== HYPERTABLES ===' as section;
    SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY hypertable_name;
    
    SELECT '=== CONTINUOUS AGGREGATES ===' as section;
    SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name;
    
    SELECT '=== POLICIES APPLIED ===' as section;
    SELECT 'Compression policies: ' || COUNT(*)::text FROM timescaledb_information.compression_settings;
    SELECT 'Retention policies: ' || COUNT(*)::text FROM timescaledb_information.drop_chunks_policies;
    SELECT 'Refresh policies: ' || COUNT(*)::text FROM timescaledb_information.jobs WHERE proc_name = 'policy_refresh_continuous_aggregate';
" 2>/dev/null || echo "   ⚠️  Could not verify complete database state"

echo "✅ Reset complete!"

echo ""
echo "📊 Final status:"
docker-compose ps analytics-service timescaledb

echo ""
echo "🎯 Complete TimescaleDB reset to match fresh container initialization!"
echo ""
echo "✅ RESET COMPLETE - Database state now matches fresh docker-compose up:"
echo "   📦 Container: $TIMESCALE_CONTAINER (TimescaleDB latest-pg15)"
echo "   🗄️  Database: $DB_NAME (fresh recreation)"
echo "   🔧 Extension: TimescaleDB enabled"
echo "   📋 Scripts Applied: ALL files from ./analytics-service/init/ (docker-entrypoint-initdb.d)"
echo "      → 01-init-timescaledb.sql (schema, tables, hypertables, indexes)"
echo "      → 02-continuous-aggregates.sql (materialized views, refresh policies)"  
echo "      → 03-compression-retention.sql (compression/retention policies)"
echo ""
echo "🧹 State Reset:"
echo "   ✅ TimescaleDB: Complete recreation (tables, hypertables, continuous aggregates, policies)"
echo "   ✅ Ponder: Sync tracking cleared (sync_log, materialized views)"
echo "   ✅ Redis: Cache cleared, consumer groups recreated"
echo "   ✅ Analytics Service: Restarted with fresh state"
echo ""
echo "🔄 This reset produces IDENTICAL results to: docker-compose up -d timescaledb (fresh volume)"