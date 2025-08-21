# Data Synchronization Scenarios - Visual Guide

## Scenario 1: Normal Operation

```
Time: 10:00 AM - Everything Running Normally
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trading Event → Ponder → Redis Stream → Analytics Service → TimescaleDB
    Trade A       ✓           ✓              ✓                 ✓
    Trade B       ✓           ✓              ✓                 ✓

Database State:
┌─────────────────────────────────────┐    ┌──────────────────────────────────┐
│           Ponder DB                 │    │           Sync Log               │
├─────────────────────────────────────┤    ├──────────────────────────────────┤
│ trade_A: ts=1754400000, processed   │ ←→ │ trade_A: status=processed        │
│ trade_B: ts=1754400060, processed   │ ←→ │ trade_B: status=processed        │
└─────────────────────────────────────┘    └──────────────────────────────────┘

Health Status: ✅ HEALTHY (lag=0 minutes, missed=0 trades)
```

## Scenario 2: Analytics Service Goes Down

```
Time: 10:05 AM - Analytics Service Crashes 💥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trading Event → Ponder → Redis Stream → Analytics Service → TimescaleDB
    Trade C       ✓           ✓              ❌ CRASHED          ❌
    Trade D       ✓           ✓              ❌ DOWN             ❌
    Trade E       ✓           ✓              ❌ OFFLINE          ❌

Database State:
┌─────────────────────────────────────┐    ┌──────────────────────────────────┐
│           Ponder DB                 │    │           Sync Log               │
├─────────────────────────────────────┤    ├──────────────────────────────────┤
│ trade_A: ts=1754400000, ✓          │ ←→ │ trade_A: status=processed        │
│ trade_B: ts=1754400060, ✓          │ ←→ │ trade_B: status=processed        │
│ trade_C: ts=1754400120, ❌ MISSED   │    │ ❌ NO ENTRY (not processed)      │
│ trade_D: ts=1754400180, ❌ MISSED   │    │ ❌ NO ENTRY (not processed)      │
│ trade_E: ts=1754400240, ❌ MISSED   │    │ ❌ NO ENTRY (not processed)      │
└─────────────────────────────────────┘    └──────────────────────────────────┘

Data Gap Created: 3 trades unprocessed (trade_C, D, E)
Redis Stream: Messages accumulating but not consumed
```

## Scenario 3: Service Restart & Gap Detection

```
Time: 10:30 AM - Analytics Service Restarts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

curl http://localhost:42091/api/sync/health

Gap Detection Algorithm:
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Find Last Processed Trade:                                      │
│    SELECT MAX(timestamp) FROM order_book_trades                     │
│    WHERE id IN (SELECT trade_id FROM sync_log WHERE status='processed')│
│    Result: 1754400060 (trade_B)                                    │
│                                                                     │
│ 2. Find Latest Trade in Ponder:                                    │
│    SELECT MAX(timestamp) FROM order_book_trades                     │
│    Result: 1754400240 (trade_E)                                    │
│                                                                     │
│ 3. Calculate Gap:                                                   │
│    Gap = 1754400240 - 1754400060 = 180 seconds = 3 minutes         │
│    Missed Trades = COUNT(*) WHERE timestamp > 1754400060 = 3       │
└─────────────────────────────────────────────────────────────────────┘

Health Response:
{
  "status": "unhealthy",
  "isHealthy": false,
  "lagMinutes": 3,
  "lastPonderTimestamp": 1754400240,
  "lastAnalyticsTimestamp": 1754400060, 
  "recommendation": "SYNC_RECOMMENDED",
  "missedTrades": 3
}
```

## Scenario 4: Manual Sync Execution  

```
Time: 10:31 AM - Manual Sync Triggered
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

curl -X POST http://localhost:42091/api/sync/run

Sync Process Execution:
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 1: Discovery                                                  │
│ ├─ Last processed: 1754400060 (trade_B)                             │
│ ├─ Query missed trades:                                              │
│ │    SELECT * FROM order_book_trades WHERE timestamp > 1754400060    │
│ └─ Found: [trade_C, trade_D, trade_E]                               │
│                                                                     │
│ Phase 2: Batch Processing                                           │  
│ ├─ Batch Size: 50 trades                                            │
│ ├─ Batch 1: [trade_C, trade_D, trade_E] (3 trades)                 │
│ └─ Process each trade individually                                   │
│                                                                     │
│ Phase 3: Individual Processing                                      │
│ ├─ trade_C:                                                         │
│ │    ├─ Transform: price*quantity = volume                          │
│ │    ├─ Process: Update analytics aggregations                      │
│ │    └─ Mark: INSERT INTO sync_log (trade_C, 'processed')           │
│ ├─ trade_D: (same process)                                          │  
│ └─ trade_E: (same process)                                          │
└─────────────────────────────────────────────────────────────────────┘

Database State After Sync:
┌─────────────────────────────────────┐    ┌──────────────────────────────────┐
│           Ponder DB                 │    │           Sync Log               │
├─────────────────────────────────────┤    ├──────────────────────────────────┤  
│ trade_A: ts=1754400000, ✓          │ ←→ │ trade_A: status=processed        │
│ trade_B: ts=1754400060, ✓          │ ←→ │ trade_B: status=processed        │
│ trade_C: ts=1754400120, ✅ SYNCED   │ ←→ │ trade_C: status=processed ✅     │
│ trade_D: ts=1754400180, ✅ SYNCED   │ ←→ │ trade_D: status=processed ✅     │  
│ trade_E: ts=1754400240, ✅ SYNCED   │ ←→ │ trade_E: status=processed ✅     │
└─────────────────────────────────────┘    └──────────────────────────────────┘

Sync Result:
{
  "success": true,
  "message": "Sync completed: 3/3 trades processed",
  "processed": 3,
  "errors": 0, 
  "total": 3,
  "duration": 1250
}
```

## Scenario 5: Post-Sync Verification

```
Time: 10:32 AM - Verify Sync Success
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

curl http://localhost:42091/api/sync/health

Health Check After Sync:
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Last Processed: 1754400240 (trade_E)                            │
│ 2. Latest in Ponder: 1754400240 (trade_E)                          │  
│ 3. Gap: 1754400240 - 1754400240 = 0 seconds                        │
│ 4. Missed Trades: 0                                                 │
└─────────────────────────────────────────────────────────────────────┘

Health Response:  
{
  "status": "healthy", ✅
  "isHealthy": true,
  "lagMinutes": 0,
  "lastPonderTimestamp": 1754400240,
  "lastAnalyticsTimestamp": 1754400240,
  "recommendation": "HEALTHY", 
  "missedTrades": 0
}

Result: ✅ GAP CLOSED - All data synchronized successfully!
```

## Scenario 6: Large Backlog Recovery

```
Time: Next Day - Service was down 8 hours, 2000 trades missed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

curl http://localhost:42091/api/sync/health

Initial Health Check:
{
  "status": "unhealthy",
  "lagMinutes": 480,        // 8 hours  
  "missedTrades": 2000,
  "recommendation": "IMMEDIATE_SYNC_REQUIRED"
}

Large Sync Process:
┌─────────────────────────────────────────────────────────────────────┐
│ Batch Processing Strategy:                                          │
│ ├─ Total Trades: 2000                                               │
│ ├─ Batch Size: 50                                                   │
│ ├─ Total Batches: 40                                                │  
│ └─ Processing Time Estimate: ~2-3 minutes                           │
│                                                                     │
│ Progress Tracking:                                                  │
│ ├─ Batch 1/40: Processed 50/2000 trades (2.5%)                     │
│ ├─ Batch 5/40: Processed 250/2000 trades (12.5%)                   │
│ ├─ Batch 10/40: Processed 500/2000 trades (25%)                    │
│ ├─ Batch 20/40: Processed 1000/2000 trades (50%)                   │
│ ├─ ...                                                              │
│ └─ Batch 40/40: Processed 2000/2000 trades (100%) ✅               │
└─────────────────────────────────────────────────────────────────────┘

Final Result:
{
  "success": true,
  "processed": 2000,
  "errors": 0,
  "total": 2000, 
  "duration": 187000,  // ~3 minutes
  "message": "Sync completed: 2000/2000 trades processed"
}
```

## Scenario 7: Partial Failure Recovery

```
Time: Sync with errors - Network issues during processing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Batch Processing with Errors:
┌─────────────────────────────────────────────────────────────────────┐
│ Batch 1: trades 1-50    ✅ SUCCESS (50 processed)                   │
│ Batch 2: trades 51-100  ❌ NETWORK ERROR (0 processed, 50 errors)   │
│ Batch 3: trades 101-150 ✅ SUCCESS (50 processed)                    │
│ Batch 4: trades 151-200 ✅ SUCCESS (50 processed)                    │
└─────────────────────────────────────────────────────────────────────┘

Error Tracking in sync_log:
┌──────────────────────────────────────────────────────────────────────┐
│ trade_1 to trade_50:   status='processed' ✅                         │
│ trade_51 to trade_100: status='error', error_message='Network timeout'│
│ trade_101 to trade_200: status='processed' ✅                        │
└──────────────────────────────────────────────────────────────────────┘

Sync Result:
{
  "success": true,
  "processed": 150,   // Successful trades
  "errors": 50,       // Failed trades  
  "total": 200,
  "message": "Sync completed with errors: 150/200 trades processed"
}

Recovery Strategy:
1. Re-run sync to retry failed trades
2. Check error logs for failed trade IDs
3. Manual investigation if errors persist
```

## Scenario 8: Force Sync from Specific Time

```
Time: Need to reprocess data from specific timestamp
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

curl -X POST http://localhost:42091/api/sync/force \
  -H "Content-Type: application/json" \
  -d '{"fromTimestamp": 1754400000}'

Force Sync Process:
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Override last processed timestamp to: 1754400000                 │
│ 2. Find ALL trades since that timestamp:                            │
│    SELECT * FROM order_book_trades WHERE timestamp > 1754400000     │ 
│ 3. Reprocess ALL matching trades (including already processed)       │
│ 4. Update sync_log with new processed timestamps                     │
└─────────────────────────────────────────────────────────────────────┘

Use Cases:
- Data corruption detected
- Analytics algorithm updated  
- Reprocess for new metrics
- Fix processing bugs retroactively
```

## Key Insights

### 🔍 **How Gaps Are Detected**
1. **Timestamp Comparison**: Compare latest Ponder trade vs latest processed trade
2. **Count Missing**: Count trades in time gap  
3. **Lag Calculation**: Convert time gap to minutes for human readability

### ⚡ **Why Batch Processing**
1. **Memory Efficient**: Process 50 trades at once instead of loading 10,000
2. **Error Isolation**: One batch failure doesn't stop entire sync
3. **Progress Tracking**: Show progress every 50 trades  
4. **Database Performance**: Reduce connection overhead

### 🎯 **Why Sync Log Table**
1. **Idempotency**: Prevent duplicate processing
2. **Resume Capability**: Know exactly where to restart
3. **Error Tracking**: Record which trades failed
4. **Audit Trail**: See processing history

### 🚀 **Performance Optimizations**
1. **Chronological Processing**: Process trades in timestamp order
2. **Bulk Operations**: Update sync_log in batches
3. **Connection Pooling**: Reuse database connections  
4. **Parallel Batches**: Process multiple batches simultaneously

This synchronization system ensures **zero data loss** and **automatic recovery** from any outage scenario! 🛡️