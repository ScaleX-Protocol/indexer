# GTX CLOB Development Guide

Complete guide for running the entire microservices system in development mode.

## Prerequisites

Make sure you have the following installed:

```bash
# Node.js 18+
node --version  # Should be 18+

# Docker and Docker Compose
docker --version
docker-compose --version

# Git
git --version
```

## Quick Start Development Setup

### 1. Initial Setup

```bash
# Clone the repository (if not already done)
cd /Users/renaka/Documents/learn/eth/gtx/clob/clob-indexer

# Make the script executable
chmod +x ./scripts/microservices.sh

# Setup environment files and dependencies
./scripts/microservices.sh setup
```

### 2. Install Dependencies for All Services

```bash
# Install main indexer dependencies
npm install

# Install WebSocket service dependencies
cd websocket-service
npm install
cd ..

# Install Analytics service dependencies
cd analytics-service
npm install
cd ..
```

### 3. Start Development Environment

```bash
# Start all services in development mode with monitoring tools
./scripts/microservices.sh dev
```

This will start:
- PostgreSQL database (indexer data)
- TimescaleDB (analytics time-series data)
- Redis message queue
- CLOB Indexer (core service)
- WebSocket Service
- Analytics Service
- Nginx reverse proxy
- Prometheus monitoring
- Grafana dashboards
- Redis Commander (for debugging)

### 4. Verify Everything is Running

```bash
# Check service status
./scripts/microservices.sh status
```

You should see all services as "healthy".

## Development URLs

Once everything is running, you'll have access to:

| Service | URL | Purpose |
|---------|-----|---------|
| **WebSocket** | `wss://core-devnet.gtxdex.xyz/ws` | Real-time market data |
| **Analytics API** | `http://localhost:3001/api` | Portfolio & market APIs |
| **WebSocket Health** | `http://localhost:8080/health` | WebSocket service health |
| **Analytics Health** | `http://localhost:3001/health` | Analytics service health |
| **PostgreSQL** | `localhost:5433` | Main indexer database |
| **TimescaleDB** | `localhost:5434` | Analytics time-series database |
| **Grafana** | `http://localhost:3000` | Monitoring dashboards (admin/admin) |
| **Prometheus** | `http://localhost:9090` | Metrics collection |
| **Redis Commander** | `http://localhost:8081` | Redis debugging |
| **Nginx Proxy** | `http://localhost:80` | Load balancer |

## Development Workflow

### Option 1: Full Docker Development
```bash
# Start all services
./scripts/microservices.sh dev

# View logs from all services
./scripts/microservices.sh logs

# View logs from specific service
./scripts/microservices.sh logs websocket-service
./scripts/microservices.sh logs analytics-service
```

### Option 2: Hybrid Development (Infrastructure + Local Services)

Start infrastructure only:
```bash
# Start only databases and supporting services
docker-compose -f docker-compose.yml up -d postgres timescaledb redis prometheus grafana redis-commander
```

Then run services locally for faster development:

```bash
# Terminal 1: Run indexer locally
npm run dev

# Terminal 2: Run WebSocket service locally
cd websocket-service
npm run dev

# Terminal 3: Run Analytics service locally
cd analytics-service
npm run dev
```

### Option 3: Individual Service Development

If you want to work on just one service:

```bash
# Start infrastructure
docker-compose -f docker-compose.yml up -d postgres timescaledb redis

# Start only the indexer (for event publishing)
npm run dev

# Then start your target service locally
cd websocket-service && npm run dev
# OR
cd analytics-service && npm run dev
```

## Environment Configuration

### Main Indexer (.env)
```bash
# Core indexer configuration
PONDER_DATABASE_URL=postgresql://postgres:password@localhost:5433/ponder
REDIS_URL=redis://localhost:6380
ENABLE_EVENT_PUBLISHING=true
ENABLE_WEBSOCKET=false  # Use separate websocket service
```

### WebSocket Service (websocket-service/.env)
```bash
PORT=42080
HEALTH_PORT=8080
REDIS_URL=redis://localhost:6380
DATABASE_URL=postgresql://postgres:password@localhost:5433/ponder
CONSUMER_GROUP=websocket-consumers
CONSUMER_ID=ws-consumer-dev-1
BATCH_SIZE=10
POLL_INTERVAL=1000
```

### Analytics Service (analytics-service/.env)
```bash
PORT=3001
REDIS_URL=redis://localhost:6380
DATABASE_URL=postgresql://postgres:password@localhost:5433/ponder
TIMESCALE_DATABASE_URL=postgresql://postgres:password@localhost:5434/analytics
CONSUMER_GROUP=analytics-consumers
CONSUMER_ID=analytics-consumer-dev-1
ANALYTICS_BATCH_SIZE=5
ANALYTICS_POLL_INTERVAL=5000
CACHE_TTL=300
ENABLE_DAILY_SNAPSHOTS=true
ENABLE_HOURLY_AGGREGATION=true
ENABLE_CACHE_REFRESH=true
```

## Testing the System

### 1. Test WebSocket Connection

```bash
# Use the existing websocket client
npm run ws-client
```

Or test manually:
```javascript
const ws = new WebSocket('wss://core-devnet.gtxdex.xyz/ws');

ws.onopen = () => {
  // Subscribe to trade stream
  ws.send(JSON.stringify({
    method: 'SUBSCRIBE',
    params: ['gswethgsusdc@trade'],
    id: 1
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

### 2. Test Analytics APIs

```bash
# Test market overview
curl http://localhost:3001/api/market/overview

# Test portfolio (replace with actual address)
curl http://localhost:3001/api/portfolio/0x1234567890123456789012345678901234567890

# Test analytics reports
curl http://localhost:3001/api/reports/largest-trade-count
curl http://localhost:3001/api/reports/largest-volume
curl http://localhost:3001/api/analytics/cumulative-users
curl http://localhost:3001/api/analytics/trades-count

# Test health
curl http://localhost:3001/health
```

### 3. Test Event Flow

1. **Trigger an event** in the indexer (order placement, trade, etc.)
2. **Check Redis Streams** in Redis Commander (`http://localhost:8081`)
3. **Verify WebSocket broadcast** using the WebSocket client
4. **Check analytics processing** in the analytics service logs

### 4. Monitor Events in Redis

```bash
# Access Redis CLI
docker-compose -f docker-compose.yml exec redis redis-cli

# Check stream info
XINFO GROUPS trades
XINFO GROUPS balances

# Read latest messages
XREAD COUNT 5 STREAMS trades $
```

## Development Tools

### Debugging Redis Streams

```bash
# View Redis Commander
open http://localhost:8081

# Or use Redis CLI
docker-compose -f docker-compose.yml exec redis redis-cli

# Check consumer groups
XINFO GROUPS trades
XINFO CONSUMERS trades websocket-consumers

# Monitor real-time
MONITOR
```

### Database Access

```bash
# Access main PostgreSQL (indexer data)
docker-compose -f docker-compose.yml exec postgres psql -U postgres -d ponder

# View indexer tables
\dt

# Check recent orders
SELECT * FROM orders ORDER BY timestamp DESC LIMIT 10;

# Check recent trades  
SELECT * FROM order_book_trades ORDER BY timestamp DESC LIMIT 10;

# Access TimescaleDB (analytics data)
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics

# Switch to analytics schema
\c analytics
SET search_path TO analytics;

# View analytics tables and hypertables
\dt analytics.*

# Check recent analytics trades
SELECT * FROM analytics.trades ORDER BY timestamp DESC LIMIT 10;

# Check continuous aggregates
SELECT * FROM analytics.daily_trading_metrics ORDER BY bucket DESC LIMIT 5;

# View hypertable info
SELECT * FROM timescaledb_information.hypertables;
```

### Log Monitoring

```bash
# Follow all logs
./scripts/microservices.sh logs

# Follow specific service logs
docker-compose -f docker-compose.yml logs -f websocket-service
docker-compose -f docker-compose.yml logs -f analytics-service

# Grep for errors
./scripts/microservices.sh logs | grep ERROR
```

## Common Development Issues

### 1. Port Conflicts
If ports are already in use:
```bash
# Check what's using ports
lsof -i :42080  # WebSocket
lsof -i :3001   # Analytics
lsof -i :5432   # PostgreSQL
lsof -i :6380   # Redis

# Kill processes if needed
kill -9 <PID>
```

### 2. Database Connection Issues
```bash
# Reset databases
docker-compose -f docker-compose.yml down -v
docker-compose -f docker-compose.yml up -d postgres timescaledb

# Wait for databases to be ready
docker-compose -f docker-compose.yml exec postgres pg_isready
docker-compose -f docker-compose.yml exec timescaledb pg_isready

# Check TimescaleDB extension is loaded
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"
```

### 3. Redis Connection Issues
```bash
# Reset Redis
docker-compose -f docker-compose.yml restart redis

# Check Redis is working
docker-compose -f docker-compose.yml exec redis redis-cli ping
```

### 4. Service Not Receiving Events
```bash
# Check if indexer is publishing events
./scripts/microservices.sh logs clob-indexer | grep "publish"

# Check Redis streams have data
docker-compose -f docker-compose.yml exec redis redis-cli XLEN trades

# Check consumer groups are created
docker-compose -f docker-compose.yml exec redis redis-cli XINFO GROUPS trades
```

## TimescaleDB Analytics Features

### Analytics Database Schema

The analytics service uses TimescaleDB for high-performance time-series analytics:

**Hypertables (Time-Partitioned):**
- `analytics.trades` - All trade events with FIFO PnL tracking
- `analytics.balances` - User balance history 
- `analytics.portfolio_snapshots` - Daily portfolio valuations
- `analytics.market_metrics` - Hourly market statistics
- `analytics.leaderboards` - User rankings over time

**Continuous Aggregates (Auto-Updating Views):**
- `hourly_trading_metrics` - Real-time hourly market data
- `daily_trading_metrics` - Daily market summaries
- `daily_user_activity` - User trading patterns
- `hourly_pnl_metrics` - PnL calculations for leaderboards
- `daily_new_users` - User growth tracking

### Analytics API Endpoints

```bash
# User Analytics Reports
curl http://localhost:3001/api/reports/largest-trade-count
curl http://localhost:3001/api/reports/largest-volume  
curl http://localhost:3001/api/reports/user-performance
curl http://localhost:3001/api/reports/pnl-leaders

# Growth Analytics
curl http://localhost:3001/api/analytics/cumulative-users
curl http://localhost:3001/api/analytics/trades-count
curl http://localhost:3001/api/analytics/inflows
curl http://localhost:3001/api/analytics/unique-traders
curl http://localhost:3001/api/analytics/slippage

# Leaderboards
curl http://localhost:3001/api/leaderboard/pnl/24h
curl http://localhost:3001/api/leaderboard/volume/7d
```

### TimescaleDB Performance Benefits

- **10-100x faster** time-range queries vs regular PostgreSQL
- **Automatic compression** reduces storage by 90%+ 
- **Real-time aggregates** via continuous aggregates
- **Retention policies** automatically manage data lifecycle
- **Parallel query execution** for analytics workloads

### Monitoring TimescaleDB

```bash
# Check hypertable stats
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "
SELECT 
  schemaname, 
  tablename, 
  approximate_row_count, 
  total_bytes 
FROM timescaledb_information.hypertables 
JOIN timescaledb_information.hypertable_approximate_row_count USING (hypertable_schema, hypertable_name)
JOIN timescaledb_information.hypertable_size USING (hypertable_schema, hypertable_name);"

# Check continuous aggregate refresh status
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "
SELECT 
  user_view_name, 
  completed_threshold, 
  refresh_lag
FROM timescaledb_information.continuous_aggregates;"

# Check compression ratios
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "
SELECT 
  schema_name, 
  table_name, 
  compression_enabled, 
  uncompressed_bytes, 
  compressed_bytes, 
  compression_ratio
FROM timescaledb_information.compression_stats;"
```

## Performance Tips for Development

### 1. Reduce Polling Intervals
In development, you can reduce polling intervals for faster feedback:

```bash
# In websocket-service/.env
POLL_INTERVAL=500  # Instead of 1000

# In analytics-service/.env  
ANALYTICS_POLL_INTERVAL=2000  # Instead of 5000
```

### 2. Increase Batch Sizes
For better performance with lots of events:

```bash
# In websocket-service/.env
BATCH_SIZE=20  # Instead of 10

# In analytics-service/.env
ANALYTICS_BATCH_SIZE=10  # Instead of 5
```

### 3. Enable Debug Logging
```bash
# Add to service .env files
LOG_LEVEL=debug
```

## Stopping Development Environment

```bash
# Stop all services
./scripts/microservices.sh stop

# Or stop and remove volumes (complete reset)
./scripts/microservices.sh clean
```

## Next Steps

Once your development environment is running:

1. **Test Event Flow**: Trigger some blockchain events and watch them flow through the system
2. **Develop Portfolio Features**: Add new portfolio calculations in the analytics service
3. **Enhance WebSocket**: Add new stream types or improve real-time performance
4. **Add Market Analytics**: Implement new market analysis features
5. **Build Frontend**: Create a dashboard that consumes the analytics APIs

## Troubleshooting Checklist

- [ ] All services show as "healthy" in status check
- [ ] PostgreSQL (indexer) is accessible and has data
- [ ] TimescaleDB (analytics) is accessible with TimescaleDB extension loaded
- [ ] Redis is running and streams are being created
- [ ] WebSocket accepts connections
- [ ] Analytics API responds to requests
- [ ] Events are flowing from indexer to consumers
- [ ] TimescaleDB continuous aggregates are refreshing
- [ ] No error messages in logs

### Common TimescaleDB Issues

```bash
# 1. TimescaleDB extension not loaded
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 2. Analytics service can't connect to TimescaleDB
# Check connection string in docker-compose.yml
# Ensure TIMESCALE_DATABASE_URL points to timescaledb:5432

# 3. Continuous aggregates not refreshing
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "
CALL refresh_continuous_aggregate('analytics.hourly_trading_metrics', NULL, NULL);
CALL refresh_continuous_aggregate('analytics.daily_trading_metrics', NULL, NULL);"

# 4. Check if data is being inserted
docker-compose -f docker-compose.yml exec timescaledb psql -U postgres -d analytics -c "
SELECT COUNT(*) as trade_count FROM analytics.trades WHERE timestamp >= NOW() - INTERVAL '1 hour';"
```