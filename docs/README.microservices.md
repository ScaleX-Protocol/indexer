# ScaleX CLOB Microservices Architecture

This document describes the microservices architecture for the ScaleX CLOB (Central Limit Order Book) system.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Analytics     │    │   WebSocket     │    │   CLOB Indexer  │
│   Service       │    │   Service       │    │   (Core)        │
│   Port: 3001    │    │   Port: 42080   │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  Redis Streams  │
                    │  (Message Queue)│
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │  PostgreSQL     │
                    │  (Shared DB)    │
                    └─────────────────┘
```

## Services

### 1. CLOB Indexer (Core Service)
- **Purpose**: Blockchain event indexing and database writes
- **Responsibilities**:
  - Index blockchain events (orders, trades, balances)
  - Process smart contract events
  - Publish events to Redis Streams
  - Maintain database consistency
- **Technology**: Ponder.js, TypeScript, PostgreSQL

### 2. WebSocket Service
- **Purpose**: Real-time market data streaming
- **Port**: 42080 (WebSocket), 8080 (Health)
- **Responsibilities**:
  - Consume events from Redis Streams
  - Broadcast real-time data to WebSocket clients
  - Handle user-specific streams (balance updates, execution reports)
  - Support public streams (trades, depth, klines)
- **Technology**: WebSocket, ioredis, TypeScript

### 3. Analytics Service
- **Purpose**: Portfolio and market analytics
- **Port**: 3001
- **Responsibilities**:
  - Portfolio calculations and tracking
  - Market metrics and statistics
  - Trading analytics and insights
  - API endpoints for dashboards
- **Technology**: Hono, PostgreSQL, Redis, Node-cron

## Event Streams

### Redis Streams Configuration
- **trades**: Trade execution events
- **balances**: Balance update events  
- **orders**: Order lifecycle events
- **depth**: Order book depth changes
- **klines**: Candlestick data updates
- **execution_reports**: User-specific execution reports

### Consumer Groups
- **websocket-consumers**: WebSocket service consumers
- **analytics-consumers**: Analytics service consumers

## Database Strategy

### Shared PostgreSQL Database
- **Indexer**: Write-only access (master)
- **WebSocket**: Read-only access for depth queries
- **Analytics**: Read-only access for calculations
- **Connection Pools**: Service-specific pool sizes

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)
- Git

### 1. Environment Setup
```bash
# Clone and setup
git clone <repository>
cd clob-indexer

# Setup environment files
./scripts/microservices.sh setup
```

### 2. Build Services
```bash
# Build all services
./scripts/microservices.sh build
```

### 3. Start Services
```bash
# Start all services
./scripts/microservices.sh start
```

### 4. Verify Services
```bash
# Check status
./scripts/microservices.sh status
```

## Service Endpoints

### WebSocket Service
- **WebSocket**: `wss://core-devnet.scalex.money/ws`
- **User WebSocket**: `wss://core-devnet.scalex.money/ws/{userId}`
- **Health**: `http://localhost:8080/health`

### Analytics Service
- **API Base**: `http://localhost:3001/api`
- **Health**: `http://localhost:3001/health`

### API Endpoints

#### Portfolio APIs
```
GET /api/portfolio/{address}              # Portfolio overview
GET /api/portfolio/{address}/performance  # Performance metrics
GET /api/portfolio/{address}/allocation   # Asset allocation
GET /api/portfolio/{address}/history      # Portfolio history
```

#### Market Analytics APIs
```
GET /api/market/overview                  # Market overview
GET /api/market/symbol/{symbol}           # Symbol metrics
GET /api/market/volume                    # Trading volume
GET /api/market/liquidity                 # Liquidity metrics
GET /api/market/makers                    # Market makers
GET /api/market/sentiment                 # Market sentiment
```

## WebSocket Streams

### Public Streams
```javascript
// Subscribe to trade stream
{
  "method": "SUBSCRIBE",
  "params": ["btcusdt@trade"],
  "id": 1
}

// Subscribe to depth stream
{
  "method": "SUBSCRIBE", 
  "params": ["btcusdt@depth"],
  "id": 2
}

// Subscribe to kline stream
{
  "method": "SUBSCRIBE",
  "params": ["btcusdt@kline_1m"],
  "id": 3
}
```

### User Streams
Connect to `wss://core-devnet.scalex.money/ws/{userAddress}` to receive:
- Balance updates
- Execution reports
- Order status changes

## Monitoring and Observability

### Health Checks
- **WebSocket Service**: `http://localhost:8080/health`
- **Analytics Service**: `http://localhost:3001/health`
- **Nginx**: `http://localhost:80/health`

### Monitoring Stack
- **Prometheus**: `http://localhost:9090` (metrics collection)
- **Grafana**: `http://localhost:3000` (dashboards, admin/admin)
- **Redis Commander**: `http://localhost:8081` (dev mode only)

### Log Management
```bash
# View all logs
./scripts/microservices.sh logs

# View specific service logs
./scripts/microservices.sh logs websocket-service
./scripts/microservices.sh logs analytics-service
```

## Development

### Local Development
```bash
# Start with development tools
./scripts/microservices.sh dev

# This includes:
# - All services
# - Redis Commander for debugging
# - Hot reload capabilities
```

### Service Development
```bash
# WebSocket service
cd websocket-service
npm run dev

# Analytics service  
cd analytics-service
npm run dev
```

### Environment Variables

#### WebSocket Service
```bash
PORT=42080
REDIS_URL=redis://localhost:6380
DATABASE_URL=postgresql://user:pass@localhost:5432/ponder
CONSUMER_GROUP=websocket-consumers
BATCH_SIZE=10
POLL_INTERVAL=1000
```

#### Analytics Service
```bash
PORT=3001
REDIS_URL=redis://localhost:6380
DATABASE_URL=postgresql://user:pass@localhost:5432/ponder
CONSUMER_GROUP=analytics-consumers
ANALYTICS_BATCH_SIZE=5
ANALYTICS_POLL_INTERVAL=5000
```

## Deployment

### Production Deployment
```bash
# Production build
docker-compose -f docker-compose.yml build

# Deploy with resource limits
docker-compose -f docker-compose.yml up -d
```

### Scaling Services
```bash
# Scale WebSocket service
docker-compose -f docker-compose.yml up -d --scale websocket-service=3

# Scale Analytics service
docker-compose -f docker-compose.yml up -d --scale analytics-service=2
```

## Troubleshooting

### Common Issues

1. **Redis Connection Issues**
   ```bash
   # Check Redis status
   docker-compose -f docker-compose.yml exec redis redis-cli ping
   ```

2. **Database Connection Issues**
   ```bash
   # Check PostgreSQL status
   docker-compose -f docker-compose.yml exec postgres pg_isready
   ```

3. **Service Health Issues**
   ```bash
   # Check service status
   ./scripts/microservices.sh status
   ```

4. **Event Processing Issues**
   ```bash
   # Check Redis Streams
   docker-compose -f docker-compose.yml exec redis redis-cli XINFO GROUPS trades
   ```

### Log Analysis
```bash
# Check for errors in logs
./scripts/microservices.sh logs | grep ERROR

# Monitor specific service
./scripts/microservices.sh logs websocket-service | tail -f
```

## Performance Tuning

### Redis Configuration
- Adjust `BATCH_SIZE` for event processing throughput
- Tune `POLL_INTERVAL` for latency vs CPU usage
- Configure memory limits for Redis

### Database Optimization
- Connection pool sizing per service
- Query optimization for analytics
- Read replica setup for scaling

### WebSocket Optimization
- Connection limits and rate limiting
- Message compression
- Keep-alive settings

## Security Considerations

### Network Security
- Service-to-service communication over private network
- Rate limiting on public endpoints
- CORS configuration

### Database Security
- Read-only access for non-indexer services
- Connection encryption
- Query timeout limits

### Redis Security
- Memory limit configuration
- Connection authentication
- Stream ACLs if needed