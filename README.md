# 📊 ScaleX CLOB DEX Indexer

> 🚀 Supercharge your DEX experience with real-time order book data indexing

A high-performance blockchain indexer powered by [Ponder](https://ponder.sh) that processes events from the ScaleX CLOB DEX (Central Limit Order Book Decentralized Exchange). It also exposes a real‑time WebSocket API so front‑ends can stream depth, trades, tickers, and personal order reports without polling.

## 🌟 Overview

This indexer is the backbone of the ScaleX CLOB DEX, processing and storing on-chain events in real-time. It maintains a structured database of all trading activities and market data for seamless DeFi operations.

## 🔧 Core Components

### 🎯 Event Handlers

- **🏊‍♂️ PoolManager**

  - Pool creation & configuration
  - Trading pair setup

- **📚 OrderBook**

  - 📝 Order placement
  - ⚡ Order matching
  - 🗑️ Order cancellation
  - 🔄 Order updates

- **💰 BalanceManager**
  - 📥 Deposits
  - 📤 Withdrawals
  - 🔁 Transfers
  - 💸 Fee distribution

## 🔌 Real-time WebSocket Gateway

The indexer spins up a WebSocket gateway on **wss://core-devnet.scalex.money**.

### 📡 Market Streams

| Stream Name             | Description                           |
| ----------------------- | ------------------------------------- |
| `<symbol>@depth`        | Full order book deltas                |
| `<symbol>@depth5@100ms` | Top 5 bids/asks snapshot every 100 ms |
| `<symbol>@trade`        | Individual trade ticks                |
| `<symbol>@kline_1m`     | Candlestick data for 1m interval      |
| `<symbol>@miniTicker`   | 24 h summary: last, high, low, volume |

Subscribe using:

```json
{
	"method": "SUBSCRIBE",
	"params": ["ethusdc@depth"],
	"id": 1
}
```

Unsubscribe with:

```json
{
	"method": "UNSUBSCRIBE",
	"params": ["ethusdc@depth"],
	"id": 2
}
```

List subscriptions:

```json
{ "method": "LIST_SUBSCRIPTIONS", "id": 3 }
```

### 👤 User Streams (per wallet)

Connect to:

```
wss://core-devnet.scalex.money/ws/<walletAddress>
```

No subscription message is required. You will automatically receive:

#### 📥 executionReport

Sent when your order is created, filled, or canceled.

```json
{
	"e": "executionReport",
	"E": 1747466880,
	"s": "MWETHMUSDC",
	"i": "157",
	"S": "SELL",
	"o": "MARKET",
	"x": "TRADE",
	"X": "FILLED",
	"q": "1000000000000000000",
	"z": "1000000000000000000",
	"p": "0",
	"L": "1900000000",
	"T": 1747466880
}
```

| Field | Description                                  |
| ----- | -------------------------------------------- |
| s     | Symbol (e.g. MWETHMUSDC)                     |
| i     | Order ID                                     |
| S     | Side (BUY/SELL)                              |
| o     | Order type (MARKET/LIMIT)                    |
| x     | Execution type (NEW, TRADE, CANCELED)        |
| X     | Order status (NEW, FILLED, PARTIALLY_FILLED) |
| q     | Total order quantity                         |
| z     | Cumulative filled quantity                   |
| p     | Limit price (if applicable)                  |
| L     | Last executed price                          |
| T     | Timestamp                                    |

#### 💰 balanceUpdate

Sent when balances change (deposit, withdrawal, fill, lock/unlock).

```json
{
	"e": "balanceUpdate",
	"E": 1747466880,
	"a": "0x9a9f...",
	"b": "2149644000",
	"l": "0"
}
```

| Field | Description                            |
| ----- | -------------------------------------- |
| a     | Token address                          |
| b     | Available balance (stringified bigint) |
| l     | Locked balance (stringified bigint)    |

### 📦 Typical Workflow

1. Connect to wss://core-devnet.scalex.money/ws/<wallet>
2. Place an order → receive executionReport (NEW)
3. Order fills → receive executionReport (TRADE) and balanceUpdate
4. Cancel an order → receive executionReport (CANCELED)

### 🧪 Example with CLI

```bash
pnpm ts-node websocket-client.ts
> subscribe gswethgsusdc@depth
> subscribe gswethgsusdc@trade
> user 0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae
```

### 📥 REST API Endpoints

#### Order Book Snapshot

```bash
curl 'http://localhost:42080/api/v3/depth?symbol=ethusdc&limit=20'
```

#### Kline/Candlestick Data

The indexer provides candlestick data through two endpoints:

```bash
# Get historical kline data
curl 'http://localhost:42080/api/kline?symbol=ethusdc&interval=1m&startTime=1746466880000&endTime=1747466880000&limit=500'

# Get mock kline data for testing
curl 'http://localhost:42080/api/kline/mocks?symbol=ethusdc&interval=1m'
```

**Parameters:**

- `symbol` (required): Trading pair (e.g., 'ethusdc')
- `interval` (optional): Time interval - '1m', '5m', '30m', '1h', '1d' (default: '1m')
- `startTime` (optional): Start time in milliseconds (default: 0)
- `endTime` (optional): End time in milliseconds (default: current time)
- `limit` (optional): Maximum number of records (default: 1000)

The kline data follows the standard format:

```
[
  [
    1747466820000,      // Open time (ms)
    "1850.00",          // Open
    "1855.25",          // High
    "1849.50",          // Low
    "1852.75",          // Close
    "12.35",            // Volume
    1747466879999,      // Close time (ms)
    "22865.71",         // Quote asset volume
    98,                 // Number of trades
    "6.18",             // Taker buy base asset volume
    "11432.85",         // Taker buy quote asset volume
    "0"                 // Unused field
  ],
  // More kline data...
]
```

| What you can stream   | Subscribe with                              | Notes                                    |
| --------------------- | ------------------------------------------- | ---------------------------------------- |
| Order‑book deltas     | `<symbol>@depth` or `<symbol>@depth5@100ms` | Emits every time bids or asks change.    |
| Live trades           | `<symbol>@trade`                            | Tick‑by‑tick last price.                 |
| 1‑minute candlesticks | `<symbol>@kline_1m`                         | Any interval supported: 1m, 5m, 1h, 1d … |
| 24 h mini‑ticker      | `<symbol>@miniTicker`                       | Last price / high / low / volume widget. |

## 🔬 Testing and Monitoring Tools

This project includes tools for stress testing WebSocket connections and monitoring system performance in real-time.

### 🚀 WebSocket Stress Test

The stress test tool allows you to simulate multiple WebSocket clients connecting to your server, subscribing to streams, and optionally connecting to user-specific WebSockets.

#### Usage

```bash
# Basic usage with 10 clients
pnpm ws-stress-test

# Specify number of clients
pnpm ws-stress-test --clients 50

# Set test duration in seconds
pnpm ws-stress-test --clients 20 --duration 60

# Custom WebSocket URL
pnpm ws-stress-test --url wss://your-websocket-server.com

# Subscribe to specific streams
pnpm ws-stress-test --streams "ethusdc@trade,ethusdc@depth,ethusdc@kline_1m"

# Add delay between client connections (in ms)
pnpm ws-stress-test --delay 200

# Connect to user WebSockets with wallet addresses from a file
plea
```

#### User WebSocket Testing

To test user-specific WebSockets, create a text file with one wallet address per line:

```
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
0x70997970C51812dc3A010C7d01b50e0d17dc79C8
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
```

Then run the stress test with the `--users` flag:

```bash
pnpm ws-stress-test --users ./user-addresses.txt --clients 10
```

The stress test will cycle through the addresses if there are more clients than addresses.

### 📊 Metrics Dashboard

The metrics dashboard provides real-time monitoring of system performance, database record counts, and WebSocket connection statistics.

#### Usage

```bash
# Start the metrics dashboard
pnpm metrics:dashboard

# Watch metrics in real-time (requires ENABLE_SYSTEM_MONITOR=true)
pnpm metrics:watch

# Check current metrics
pnpm metrics
```

#### Configuring System Monitoring

The system monitor is built into the main Ponder process and can be configured with environment variables:

```bash
# Enable system monitoring (disabled by default)
ENABLE_SYSTEM_MONITOR=true pnpm dev

# Enable with custom interval (30 seconds by default)
ENABLE_SYSTEM_MONITOR=true SYSTEM_MONITOR_INTERVAL=30 pnpm dev
```

**Environment Variables:**
- `ENABLE_SYSTEM_MONITOR`: Set to `true` to enable metrics collection (default: `false`)
- `SYSTEM_MONITOR_INTERVAL`: Collection interval in seconds (default: `30`)

**Recommended intervals (use multiples of 10 for best synchronization):**
- **Development/Testing**: 10, 20, or 30 seconds for responsive monitoring
- **Production**: 30, 60, or 120 seconds to reduce overhead
- **Avoid**: Non-multiples of 10 (e.g., 15, 25, 45) as they cause timing misalignment

When enabled, metrics are automatically logged to `logs/system-metrics.log` and can be viewed with the dashboard.

> **Note**: For accurate WebSocket metrics, use the integrated monitoring (`ENABLE_SYSTEM_MONITOR=true pnpm dev`) rather than running the system monitor separately (`pnpm monitor`), since WebSocket connections are only visible within the same process.

#### Dashboard Features

- System metrics: CPU usage, memory usage, network connections
- Database statistics: Record counts for orders, trades, balances
- WebSocket metrics: Active connections, messages per second, subscription types
- Performance trends: Memory growth, message throughput

#### Monitoring During Stress Tests

For optimal monitoring during stress tests, run these commands in separate terminals:

```bash
# Terminal 1: Start the indexer with monitoring enabled
ENABLE_SYSTEM_MONITOR=true SYSTEM_MONITOR_INTERVAL=10 pnpm dev

# Terminal 2: Launch the metrics dashboard
pnpm metrics:dashboard

# Terminal 3: Run the stress test
pnpm ws-stress-test --clients 50 --duration 300 --users ./user-addresses.txt
```

This setup allows you to observe how the system performs under load and identify potential bottlenecks or performance issues.

### 🔄 Combining Tools for Development

During development, you can use these tools together to:

1. Run the indexer with monitoring: `ENABLE_SYSTEM_MONITOR=true pnpm dev`
2. Launch the dashboard with `pnpm metrics:dashboard`
3. Run stress tests with `pnpm ws-stress-test`
4. Use the WebSocket client for manual testing with `pnpm ws-client`

This workflow helps ensure your WebSocket server can handle the expected load and provides visibility into system performance.

**User streams**  
Open a second socket to `wss://core-devnet.scalex.money/ws/<walletAddress>` to receive:

- `executionReport` – order status & fills
- `balanceUpdate` – deposits, withdrawals, fee distributions

No REST auth is required; simply connect to the address‑specific socket.

**Example with the bundled CLI**

```text
pnpm ts-node websocket-client.ts
> subscribe ethusdc@depth
> subscribe ethusdc@trade
> list
```

### 📊 Data Models

- **🏊‍♂️ Pools**: Trading pair configs
- **📝 Orders**: Live & historical orders
- **🤝 Trades**: Executed trades
- **📈 OrderBookTrades**: Detailed executions
- **💎 Balances**: User token holdings
- **📊 Candlestick Data**:
  ```
  📈 1m  |  📊 5m  |  📉 30m  |  📈 1h  |  📊 1d
  ```

## 🗄️ Database Schema

### 🏊‍♂️ Pools

```typescript
{
  id: hex,                  // 🏷️ Pool address
  coin: string,            // 💱 Trading pair (ETH/USDC)
  orderBook: hex,          // 📚 OrderBook contract
  baseCurrency: hex,       // 🔵 Base token
  quoteCurrency: hex,      // 🟡 Quote token
  lotSize: bigint,         // 📏 Min order size
  maxOrderAmount: bigint,  // 🔝 Max order size
  timestamp: integer       // ⏰ Creation time
}
```

### 📝 Orders

```typescript
{
  id: string,              // 🆔 Unique ID
  poolId: hex,            // 🏊‍♂️ Pool address
  orderId: bigint,        // 🔢 Chain order ID
  user: hex,              // 👤 User address
  side: string,           // 📗 Buy / 📕 Sell
  timestamp: integer,     // ⏰ Order time
  price: bigint,          // 💰 Price
  quantity: bigint,       // 📦 Quantity
  filled: bigint,         // ✅ Filled amount
  type: string,           // 🎯 Market/Limit
  status: string,         // 📊 Order status
  expiry: integer        // ⌛ Expiration
}
```

## 🚀 Quick Start

1. 📦 Install dependencies:

```bash
pnpm install
```

2. ⚙️ Setup environment:

```bash
cp .env.example .env
```

3. 🏃‍♂️ Launch indexer:

```bash
pnpm dev
```

4. 🛰 Start the WebSocket CLI (optional):

```bash
pnpm ts-node websocket-client.ts
```

## 👨‍💻 Development

Key files for customization:

- 🏊‍♂️ `src/poolManager.ts`
- 📚 `src/index.ts` (OrderBook events)
- 💰 `src/balanceManager.ts`

Schema modifications: 🔧 `ponder.schema.ts`
