# Redis Streams Monitor CLI

Advanced monitoring CLI for Redis streams consumption in the CLOB Indexer project.

## Features

- **📊 Overview**: Monitor all streams at a glance
- **🔍 Stream Details**: Deep dive into specific stream metrics  
- **👥 Consumer Monitoring**: Track individual consumer performance
- **⏳ Pending Messages**: Identify bottlenecks and processing lag
- **🔄 Real-time Watch**: Live monitoring with auto-refresh
- **🎨 Rich UI**: Color-coded status indicators and formatted tables

## Installation

Install dependencies:
```bash
npm install cli-table3 commander
```

## Usage

### Basic Commands

#### 1. Overview of All Streams
```bash
npm run stream-monitor overview
```
Shows summary of all streams with message counts, consumer groups, and pending messages.

#### 2. Stream Details
```bash
npm run stream-monitor stream <stream-name>
```
Available streams: `trades`, `balances`, `orders`, `depth`, `klines`, `execution_reports`

Example:
```bash
npm run stream-monitor stream trades
```

#### 3. Consumer Details
```bash
npm run stream-monitor consumers <stream-name> <group-name>
```
Available groups: `websocket-consumers`, `analytics-consumers`

Example:
```bash
npm run stream-monitor consumers trades websocket-consumers
```

#### 4. Pending Messages
```bash
npm run stream-monitor pending <stream-name> <group-name>
npm run stream-monitor pending <stream-name> <group-name> --consumer <consumer-name>
```

Example:
```bash
npm run stream-monitor pending trades websocket-consumers
npm run stream-monitor pending trades websocket-consumers --consumer ws-consumer-1234567890
```

#### 5. Real-time Monitoring
```bash
npm run stream-monitor watch
npm run stream-monitor watch --interval 10  # Update every 10 seconds
```

### Advanced Usage Examples

#### Monitor specific stream in real-time
```bash
# Watch trades stream details
npm run stream-monitor stream trades

# Check for lagging consumers
npm run stream-monitor consumers orders analytics-consumers

# Find stuck messages
npm run stream-monitor pending execution_reports websocket-consumers
```

#### Troubleshooting Performance Issues
```bash
# 1. Check overall system health
npm run stream-monitor overview

# 2. Identify problematic streams
npm run stream-monitor watch

# 3. Dive into specific issues
npm run stream-monitor pending trades websocket-consumers
```

## Stream Architecture

### Streams
- **`trades`** - Trade execution events
- **`balances`** - Balance update events  
- **`orders`** - Order lifecycle events
- **`depth`** - Order book depth changes
- **`klines`** - Candlestick data updates
- **`execution_reports`** - User-specific execution reports

### Consumer Groups
- **`websocket-consumers`** - Consumes: all streams (WebSocket service)
- **`analytics-consumers`** - Consumes: trades, balances, orders, klines (Analytics service)

### Status Indicators
- ✅ **OK** - No pending messages, healthy processing
- ⚠️ **LAG** - Has pending messages, potential bottleneck
- ❌ **ERROR** - Stream not found or connection issue

## Configuration

The CLI uses the following environment variables:
- `REDIS_URL` - Redis connection URL (default: `redis://localhost:6380`)

## Metrics Interpretation

### Key Metrics
- **Messages**: Total messages in stream
- **Pending**: Messages waiting to be processed
- **Processing Rate**: `(Total - Pending) / Total * 100%`
- **Idle Time**: How long since consumer was active

### Performance Thresholds
- **Good**: < 100 pending messages, processing rate > 95%
- **Warning**: 100-1000 pending messages, processing rate 90-95%
- **Critical**: > 1000 pending messages, processing rate < 90%

## Troubleshooting

### Common Issues

#### High Pending Messages
```bash
# Check consumer health
npm run stream-monitor consumers <stream> <group>

# Identify stuck messages
npm run stream-monitor pending <stream> <group>
```

#### Consumer Not Processing
- Check if services are running (WebSocket, Analytics)
- Verify Redis connection
- Check service logs for errors

#### Stream Not Found
- Ensure Redis is running on correct port (6380)
- Verify streams are being created by publishers
- Check Redis URL configuration

### Debug Commands
```bash
# Test Redis connection
redis-cli -p 6380 ping

# Manual stream inspection
redis-cli -p 6380 XINFO STREAM trades
redis-cli -p 6380 XINFO GROUPS trades
redis-cli -p 6380 XPENDING trades websocket-consumers
```