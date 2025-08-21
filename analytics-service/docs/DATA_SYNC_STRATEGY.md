# Data Synchronization Strategy for Analytics Service

## Problem Statement

When the analytics service is down, Ponder continues to generate trading data in the PostgreSQL database, but the analytics service misses processing these events. We need mechanisms to detect and sync missed data when the service comes back online.

## Current Architecture Analysis

### Data Flow
```
Trading Events → Ponder → PostgreSQL (order_book_trades) → Redis Streams → Analytics Service → TimescaleDB
```

### Potential Failure Points
1. **Analytics Service Down**: Redis streams continue accumulating, but processing stops
2. **Redis Down**: Events lost, no way to recover without database sync
3. **Network Partition**: Services can't communicate

## Synchronization Strategies

### 1. **Redis Streams with Consumer Groups** (Current - Partial)

**How it works:**
- Ponder publishes events to Redis streams
- Analytics service uses consumer groups to track processed messages
- Unprocessed messages remain in the stream

**Current Implementation:**
```typescript
// In event-consumer.ts
messages = await this.redis.xreadgroup(
  'GROUP', this.consumerGroup, this.consumerId,
  'COUNT', batchSize,
  'BLOCK', 100,
  'STREAMS', stream, '>'
);
```

**Missing Pieces:**
- No pending message recovery
- No consumer group initialization check
- No dead letter queue for failed messages

### 2. **Database-Based Synchronization** (Recommended)

**Implementation:**

```typescript
// New sync service
export class DataSyncService {
  constructor(
    private ponderDb: SimpleDatabaseClient,
    private analyticsDb: TimescaleDatabaseClient
  ) {}

  async syncMissedData(): Promise<SyncResult> {
    // Get last processed timestamp from analytics DB
    const lastProcessed = await this.getLastProcessedTimestamp();
    
    // Get all trades since last processed timestamp
    const missedTrades = await this.ponderDb.sql`
      SELECT 
        obt.*,
        p.coin as symbol
      FROM order_book_trades obt
      LEFT JOIN pools p ON obt.pool_id = p.order_book
      WHERE obt.timestamp > ${lastProcessed}
      ORDER BY obt.timestamp ASC
    `;

    // Process missed trades in batches
    const results = await this.processMissedTrades(missedTrades);
    
    // Update last processed timestamp
    await this.updateLastProcessedTimestamp();
    
    return results;
  }

  private async getLastProcessedTimestamp(): Promise<number> {
    try {
      const result = await this.analyticsDb.sql`
        SELECT MAX(timestamp) as last_timestamp 
        FROM analytics_trades
      `;
      return result[0]?.last_timestamp || 0;
    } catch (error) {
      console.log('No analytics data found, starting from beginning');
      return 0;
    }
  }

  private async processMissedTrades(trades: any[]): Promise<SyncResult> {
    const batchSize = 100;
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < trades.length; i += batchSize) {
      const batch = trades.slice(i, i + batchSize);
      
      try {
        await this.processBatch(batch);
        processed += batch.length;
      } catch (error) {
        console.error('Batch processing error:', error);
        errors += batch.length;
      }
    }

    return { processed, errors, total: trades.length };
  }
}
```

### 3. **Hybrid Approach with Checkpoints** (Best Practice)

```typescript
// Enhanced event consumer with checkpoint recovery
export class EnhancedAnalyticsEventConsumer {
  async start() {
    // 1. Recover pending messages first
    await this.recoverPendingMessages();
    
    // 2. Sync any database gaps
    await this.syncDatabaseGaps();
    
    // 3. Start normal stream processing
    await this.startStreamProcessing();
  }

  private async recoverPendingMessages(): Promise<void> {
    console.log('Recovering pending messages...');
    
    // Get pending messages for this consumer group
    const pending = await this.redis.xpending(
      'orders',
      this.consumerGroup,
      '-', '+', 100
    );

    for (const [id, consumer, idle, deliveries] of pending) {
      if (idle > 30000) { // Messages pending for more than 30 seconds
        try {
          // Claim and process the message
          const messages = await this.redis.xclaim(
            'orders',
            this.consumerGroup,
            this.consumerId,
            30000, // Min idle time
            id
          );
          
          if (messages && messages.length > 0) {
            await this.processMessages([[messages[0][0], messages[0][1]]]);
            await this.redis.xack('orders', this.consumerGroup, id);
          }
        } catch (error) {
          console.error(`Failed to process pending message ${id}:`, error);
          // Move to dead letter queue after max retries
        }
      }
    }
  }

  private async syncDatabaseGaps(): Promise<void> {
    console.log('Checking for database gaps...');
    
    const syncService = new DataSyncService(this.ponderDb, this.analyticsDb);
    const result = await syncService.syncMissedData();
    
    console.log(`Sync completed: ${result.processed}/${result.total} processed`);
  }
}
```

### 4. **Checkpoint Table Implementation**

```sql
-- Checkpoint tracking table
CREATE TABLE sync_checkpoints (
  service_name VARCHAR(50) PRIMARY KEY,
  last_processed_timestamp BIGINT NOT NULL,
  last_processed_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial checkpoint
INSERT INTO sync_checkpoints (service_name, last_processed_timestamp)
VALUES ('analytics_service', 0)
ON CONFLICT (service_name) DO NOTHING;
```

```typescript
export class CheckpointManager {
  async updateCheckpoint(timestamp: number, tradeId?: string): Promise<void> {
    await this.db.sql`
      UPDATE sync_checkpoints 
      SET 
        last_processed_timestamp = ${timestamp},
        last_processed_id = ${tradeId},
        updated_at = NOW()
      WHERE service_name = 'analytics_service'
    `;
  }

  async getLastCheckpoint(): Promise<Checkpoint> {
    const result = await this.db.sql`
      SELECT * FROM sync_checkpoints 
      WHERE service_name = 'analytics_service'
    `;
    return result[0];
  }
}
```

### 5. **Monitoring and Alerting**

```typescript
export class SyncMonitor {
  async checkSyncHealth(): Promise<HealthStatus> {
    // Check lag between Ponder and Analytics
    const [ponderLatest, analyticsLatest] = await Promise.all([
      this.ponderDb.sql`SELECT MAX(timestamp) as latest FROM order_book_trades`,
      this.analyticsDb.sql`SELECT MAX(timestamp) as latest FROM analytics_trades`
    ]);

    const lagSeconds = ponderLatest[0].latest - analyticsLatest[0].latest;
    const lagMinutes = lagSeconds / 60;

    return {
      isHealthy: lagMinutes < 5, // Alert if more than 5 minutes behind
      lagMinutes,
      lastSync: analyticsLatest[0].latest,
      recommendation: lagMinutes > 60 ? 'IMMEDIATE_SYNC_REQUIRED' : 'HEALTHY'
    };
  }
}
```

## Implementation Plan

### Phase 1: Enhanced Consumer Recovery
```typescript
// Add to existing event-consumer.ts
async initialize() {
  // Ensure consumer group exists
  await this.ensureConsumerGroup();
  
  // Recover pending messages
  await this.recoverPendingMessages();
  
  // Check for database gaps
  await this.checkDatabaseGaps();
}
```

### Phase 2: Database Sync Service
```typescript
// New service: src/sync/data-sync-service.ts
export class DataSyncService {
  async fullSync(): Promise<void> {
    // Implementation as shown above
  }
  
  async incrementalSync(fromTimestamp: number): Promise<void> {
    // Sync only data after specific timestamp
  }
}
```

### Phase 3: Startup Recovery Process
```typescript
// Enhanced startup sequence in src/index.ts
async function startAnalyticsService() {
  // 1. Database connections
  await connectDatabases();
  
  // 2. Recovery process
  const syncService = new DataSyncService(ponderDb, analyticsDb);
  await syncService.syncMissedData();
  
  // 3. Enhanced event consumer
  const consumer = new EnhancedAnalyticsEventConsumer();
  await consumer.initialize();
  await consumer.start();
  
  // 4. API server
  await startApiServer();
}
```

## Benefits of This Approach

1. **No Data Loss**: Database sync ensures all trades are eventually processed
2. **Resilient**: Works even if Redis streams are cleared or corrupted  
3. **Automated**: Recovery happens automatically on service restart
4. **Monitored**: Built-in lag detection and alerting
5. **Efficient**: Incremental sync minimizes processing overhead

## Monitoring Commands

```bash
# Check sync lag
curl localhost:42091/api/sync/health

# Force manual sync
curl -X POST localhost:42091/api/sync/force

# View sync statistics
curl localhost:42091/api/sync/stats
```

This comprehensive strategy ensures that even during extended outages, no trading data is lost and the analytics service can efficiently catch up when restored.