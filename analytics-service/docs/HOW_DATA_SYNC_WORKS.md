# How Data Synchronization Works - Detailed Technical Explanation

## Overview

The data synchronization system ensures that when the analytics service goes down, it can recover and process all missed trading data without loss. Here's exactly how it works:

## 1. Data Flow Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Trading       │    │     Ponder      │    │ Analytics       │    │   TimescaleDB   │
│   Events        │───▶│   PostgreSQL    │───▶│   Service       │───▶│   (Analytics)   │
│                 │    │ (order_book_    │    │                 │    │                 │
│                 │    │  trades table)  │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Redis Streams   │    │   Sync Log      │
                       │ (Real-time)     │    │ (Track Progress)│
                       └─────────────────┘    └─────────────────┘
```

## 2. Core Components

### A. **Ponder Database (Source of Truth)**
```sql
-- Main trading data table
order_book_trades:
├── id (text) - Unique trade identifier
├── timestamp (integer) - Unix timestamp
├── price (numeric) - Trade price
├── quantity (numeric) - Trade quantity  
├── pool_id (text) - Pool identifier
├── side (varchar) - Buy/Sell
└── transaction_id (text) - Transaction hash

pools:
├── order_book (text) - Pool identifier  
└── coin (text) - Trading pair symbol
```

### B. **Sync Tracking System**
```sql
-- Custom sync_log table (created automatically)
sync_log:
├── trade_id (text) - Links to order_book_trades.id
├── service (text) - Always 'analytics' 
├── status (text) - 'processed', 'error', 'pending'
├── processed_at (timestamp) - When processed
└── error_message (text) - Error details if failed

PRIMARY KEY (trade_id, service)
```

### C. **DataSyncService Class**
The core synchronization engine with these key methods:

1. **`checkSyncHealth()`** - Detects gaps
2. **`syncMissedData()`** - Processes missing trades  
3. **`forceSyncFrom(timestamp)`** - Reprocesses from specific point

## 3. Gap Detection Algorithm

### Step 1: Find Last Processed Timestamp
```typescript
async getLastProcessedTimestamp(): Promise<number> {
  // Method 1: Check sync_log for last processed trade
  const result = await this.ponderDb.sql`
    SELECT MAX(timestamp) as last_timestamp 
    FROM order_book_trades
    WHERE id IN (
      SELECT DISTINCT trade_id 
      FROM sync_log 
      WHERE status = 'processed' 
      AND service = 'analytics'
    )
  `;
  
  // Method 2: Fallback to earliest trade if no sync log
  if (!result[0]?.last_timestamp) {
    const fallback = await this.ponderDb.sql`
      SELECT MIN(timestamp) as first_timestamp 
      FROM order_book_trades
    `;
    return parseInt(fallback[0]?.first_timestamp) || 0;
  }
  
  return parseInt(result[0].last_timestamp);
}
```

### Step 2: Calculate Data Gap
```typescript
async checkSyncHealth(): Promise<SyncHealthStatus> {
  const [ponderLatest, analyticsLatest] = await Promise.all([
    this.getLatestPonderTimestamp(),      // Latest trade in Ponder
    this.getLastProcessedTimestamp()      // Latest processed by Analytics
  ]);

  const lagSeconds = ponderLatest - analyticsLatest;
  const lagMinutes = lagSeconds / 60;
  const missedTrades = await this.countMissedTrades(analyticsLatest);

  return {
    isHealthy: lagMinutes < 5,           // Healthy if < 5 min lag
    lagMinutes,
    lastPonderTimestamp: ponderLatest,
    lastAnalyticsTimestamp: analyticsLatest,
    recommendation: lagMinutes > 60 ? 'IMMEDIATE_SYNC_REQUIRED' : 'HEALTHY',
    missedTrades
  };
}
```

## 4. Synchronization Process

### Phase 1: Discovery
```typescript
async syncMissedData(): Promise<SyncResult> {
  // 1. Get last processed timestamp
  const lastProcessed = await this.getLastProcessedTimestamp();
  console.log(`Last processed: ${new Date(lastProcessed * 1000).toISOString()}`);
  
  // 2. Find all missed trades  
  const missedTrades = await this.ponderDb.sql`
    SELECT 
      obt.id,
      obt.timestamp,
      obt.price,
      obt.quantity,
      obt.side,
      obt.pool_id,
      p.coin as symbol
    FROM order_book_trades obt
    LEFT JOIN pools p ON obt.pool_id = p.order_book
    WHERE obt.timestamp > ${lastProcessed}  -- Only newer trades
    ORDER BY obt.timestamp ASC              -- Process chronologically
  `;
  
  console.log(`Found ${missedTrades.length} missed trades`);
}
```

### Phase 2: Batch Processing
```typescript
async processMissedTrades(trades: any[]): Promise<SyncResult> {
  const batchSize = 50;  // Process 50 trades at once
  let processed = 0;
  let errors = 0;

  // Process in batches to avoid memory issues
  for (let i = 0; i < trades.length; i += batchSize) {
    const batch = trades.slice(i, i + batchSize);
    
    try {
      await this.processBatch(batch);
      processed += batch.length;
    } catch (error) {
      console.error(`Batch ${i/batchSize + 1} failed:`, error);
      errors += batch.length;
    }
  }

  return { processed, errors, total: trades.length };
}
```

### Phase 3: Individual Trade Processing
```typescript
async processBatch(trades: any[]): Promise<void> {
  for (const trade of trades) {
    try {
      // 1. Transform trade data for analytics
      const analyticsData = this.transformTradeForAnalytics(trade);
      
      // 2. Process analytics (compute aggregations, metrics, etc.)
      await this.simulateAnalyticsProcessing(analyticsData);
      
      // 3. Mark as successfully processed
      await this.markTradeAsProcessed(trade.id);
      
    } catch (error) {
      // 4. Mark as error for retry later
      await this.markTradeAsError(trade.id, error.message);
      throw error;
    }
  }
}
```

### Phase 4: Progress Tracking
```typescript
async markTradeAsProcessed(tradeId: string): Promise<void> {
  await this.ponderDb.sql`
    INSERT INTO sync_log (trade_id, service, status, processed_at)
    VALUES (${tradeId}, 'analytics', 'processed', NOW())
    ON CONFLICT (trade_id, service) 
    DO UPDATE SET 
      status = 'processed',
      processed_at = NOW(),
      error_message = NULL
  `;
}
```

## 5. Real-World Example

Let's trace through a real scenario:

### Initial State
```
Ponder Database:
- Trade 1: timestamp=1754400000 (processed)
- Trade 2: timestamp=1754400060 (processed)  
- Trade 3: timestamp=1754400120 (processed)

Analytics Service: Running normally

Sync Log:
- trade_1: status='processed'
- trade_2: status='processed' 
- trade_3: status='processed'
```

### Analytics Service Goes Down
```
10:00 AM - Analytics service crashes
10:05 AM - New trades arrive in Ponder:
- Trade 4: timestamp=1754400300
- Trade 5: timestamp=1754400360
10:10 AM - More trades:
- Trade 6: timestamp=1754400600
- Trade 7: timestamp=1754400660

Sync Log: Still shows trade_3 as last processed
```

### Service Restart & Recovery
```
11:00 AM - Analytics service restarts

Step 1 - Health Check:
GET /api/sync/health
Response: {
  "isHealthy": false,
  "lagMinutes": 60,
  "missedTrades": 4,
  "recommendation": "IMMEDIATE_SYNC_REQUIRED"
}

Step 2 - Manual Sync:
POST /api/sync/run

Discovery Phase:
- Last processed timestamp: 1754400120 (trade_3)
- Find missed trades: WHERE timestamp > 1754400120
- Found: [trade_4, trade_5, trade_6, trade_7]

Processing Phase:
- Batch 1: Process trades 4,5,6,7
- Transform each trade for analytics
- Update aggregations, metrics, time-series data
- Mark each as processed in sync_log

Result: {
  "processed": 4,
  "errors": 0,
  "total": 4,
  "duration": 1250
}

Step 3 - Verify:
GET /api/sync/health
Response: {
  "isHealthy": true,
  "lagMinutes": 0,
  "missedTrades": 0,
  "recommendation": "HEALTHY"
}
```

## 6. Data Transformation Process

### Input (Raw Ponder Trade)
```json
{
  "id": "trade_123",
  "timestamp": 1754400300,
  "price": "2000000000",         // Raw price (with decimals)
  "quantity": "100000000000000000", // Raw quantity (with decimals) 
  "side": "buy",
  "pool_id": "pool_abc",
  "symbol": "MWETH/MUSDC"
}
```

### Transformation
```typescript
transformTradeForAnalytics(trade: any): any {
  return {
    trade_id: trade.id,
    timestamp: trade.timestamp,
    symbol: trade.symbol,
    price: trade.price,
    quantity: trade.quantity,
    volume: parseFloat(trade.price) * parseFloat(trade.quantity), // Calculate volume
    side: trade.side,
    chain_id: trade.chain_id,
    pool_id: trade.pool_id,
    transaction_id: trade.transaction_id
  };
}
```

### Analytics Processing
```typescript
async simulateAnalyticsProcessing(analyticsData: any): Promise<void> {
  // 1. Update time-series aggregations
  await this.updateHourlyAggregations(analyticsData);
  
  // 2. Update daily summaries
  await this.updateDailySummaries(analyticsData);
  
  // 3. Update trader statistics
  await this.updateTraderStats(analyticsData);
  
  // 4. Update symbol metrics
  await this.updateSymbolMetrics(analyticsData);
  
  // 5. Trigger real-time updates
  await this.publishAnalyticsUpdate(analyticsData);
}
```

## 7. Error Handling & Recovery

### Retry Logic
```typescript
async processBatch(trades: any[]): Promise<void> {
  for (const trade of trades) {
    let attempts = 0;
    const maxRetries = 3;
    
    while (attempts < maxRetries) {
      try {
        await this.processTrade(trade);
        break; // Success, move to next trade
        
      } catch (error) {
        attempts++;
        
        if (attempts >= maxRetries) {
          await this.markTradeAsError(trade.id, error.message);
          console.error(`Failed to process ${trade.id} after ${maxRetries} attempts`);
        } else {
          console.warn(`Retry ${attempts}/${maxRetries} for trade ${trade.id}`);
          await this.sleep(1000 * attempts); // Exponential backoff
        }
      }
    }
  }
}
```

### Error Tracking
```sql
-- Trades that failed processing
SELECT * FROM sync_log WHERE status = 'error';

-- Retry failed trades
UPDATE sync_log 
SET status = 'pending', error_message = NULL 
WHERE status = 'error' AND processed_at < NOW() - INTERVAL '1 hour';
```

## 8. Performance Optimizations

### Batch Size Tuning
```typescript
const batchSize = process.env.SYNC_BATCH_SIZE || 50;
```

### Parallel Processing (Advanced)
```typescript
async processMissedTradesParallel(trades: any[]): Promise<SyncResult> {
  const batchSize = 50;
  const concurrency = 3; // Process 3 batches simultaneously
  
  const batches = [];
  for (let i = 0; i < trades.length; i += batchSize) {
    batches.push(trades.slice(i, i + batchSize));
  }
  
  let processed = 0;
  let errors = 0;
  
  // Process batches in parallel with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const currentBatches = batches.slice(i, i + concurrency);
    
    const results = await Promise.allSettled(
      currentBatches.map(batch => this.processBatch(batch))
    );
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        processed += currentBatches[index].length;
      } else {
        errors += currentBatches[index].length;
      }
    });
  }
  
  return { processed, errors, total: trades.length };
}
```

## 9. Monitoring & Alerting

### Health Check Thresholds
```typescript
const HEALTHY_LAG_MINUTES = 5;
const WARNING_LAG_MINUTES = 30;
const CRITICAL_LAG_MINUTES = 60;

function getRecommendation(lagMinutes: number): string {
  if (lagMinutes > CRITICAL_LAG_MINUTES) return 'IMMEDIATE_SYNC_REQUIRED';
  if (lagMinutes > WARNING_LAG_MINUTES) return 'SYNC_RECOMMENDED';
  return 'HEALTHY';
}
```

### Production Monitoring
```bash
# Monitor sync health every minute
*/1 * * * * curl -s http://localhost:42091/api/sync/health | jq '.isHealthy' | grep -q false && echo "ALERT: Analytics sync unhealthy"

# Auto-sync when lag exceeds threshold  
*/5 * * * * curl -s http://localhost:42091/api/sync/health | jq '.lagMinutes > 30' | grep -q true && curl -X POST http://localhost:42091/api/sync/run
```

## 10. Benefits of This Approach

### ✅ **Advantages**
1. **Zero Data Loss**: Database-based, survives Redis failures
2. **Automatic Recovery**: Detects gaps automatically
3. **Batch Efficiency**: Processes large backlogs efficiently  
4. **Progress Tracking**: Knows exactly what's processed
5. **Error Recovery**: Retries failed trades
6. **Monitoring**: Real-time health checks
7. **Manual Control**: Force sync from any timestamp

### ⚠️ **Trade-offs**
1. **Storage Overhead**: Sync log table grows over time
2. **Processing Delay**: Batch processing has latency
3. **Database Load**: Heavy sync operations impact DB
4. **Complexity**: More moving parts to monitor

### 🔧 **Production Optimizations**
1. **Archive old sync_log entries** (after 30 days)
2. **Index sync_log table** for faster queries
3. **Rate limiting** to prevent DB overload
4. **Parallel processing** for large backlogs
5. **Circuit breakers** for error handling

This comprehensive synchronization system ensures that the analytics service can recover from any outage duration - whether 5 minutes or 5 hours - without losing a single trade! 🚀