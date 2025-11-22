/**
 * Verification script to check Envio aggregated data
 * Run with: bun run scripts/verify-data.ts
 */

import { db } from '../src/config/database';
import {
  pools,
  orders,
  orderBookDepth,
  orderBookTrades,
  balances,
  currencies,
  minuteBuckets,
  fiveMinuteBuckets,
  thirtyMinuteBuckets,
  hourBuckets,
  dailyBuckets,
} from '../src/schema/aggregated';
import { sql } from 'drizzle-orm';

interface TableStats {
  tableName: string;
  count: number;
  sampleData?: any;
}

async function getTableCount(table: any, tableName: string): Promise<TableStats> {
  try {
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(table);
    const count = Number(countResult[0]?.count || 0);

    let sampleData = null;
    if (count > 0) {
      const sample = await db.select().from(table).limit(1);
      sampleData = sample[0];
    }

    return { tableName, count, sampleData };
  } catch (error) {
    console.error(`Error querying ${tableName}:`, error);
    return { tableName, count: -1 };
  }
}

async function verifyData() {
  console.log('🔍 Verifying Envio Aggregated Data\n');
  console.log('=' .repeat(60));

  const tables = [
    { table: pools, name: 'Pool' },
    { table: orders, name: 'Order' },
    { table: orderBookDepth, name: 'OrderBookDepth' },
    { table: orderBookTrades, name: 'OrderBookTrade' },
    { table: balances, name: 'Balance' },
    { table: currencies, name: 'Currency' },
    { table: minuteBuckets, name: 'MinuteBucket' },
    { table: fiveMinuteBuckets, name: 'FiveMinuteBucket' },
    { table: thirtyMinuteBuckets, name: 'ThirtyMinuteBucket' },
    { table: hourBuckets, name: 'HourBucket' },
    { table: dailyBuckets, name: 'DailyBucket' },
  ];

  const results: TableStats[] = [];

  for (const { table, name } of tables) {
    const stats = await getTableCount(table, name);
    results.push(stats);
  }

  // Display results
  console.log('\n📊 Table Statistics:\n');
  let totalRecords = 0;

  results.forEach(({ tableName, count, sampleData }) => {
    const status = count > 0 ? '✅' : count === 0 ? '⚠️' : '❌';
    console.log(`${status} ${tableName.padEnd(25)} ${count.toString().padStart(10)} records`);
    if (count > 0) totalRecords += count;
  });

  console.log('\n' + '='.repeat(60));
  console.log(`📈 Total Records: ${totalRecords}`);
  console.log('='.repeat(60));

  // Display sample data from key tables
  console.log('\n🔎 Sample Data:\n');

  const poolStats = results.find(r => r.tableName === 'Pool');
  if (poolStats?.sampleData) {
    console.log('Pool Sample:');
    console.log(JSON.stringify(poolStats.sampleData, null, 2));
    console.log('');
  }

  const orderStats = results.find(r => r.tableName === 'Order');
  if (orderStats?.sampleData) {
    console.log('Order Sample:');
    console.log(JSON.stringify(orderStats.sampleData, null, 2));
    console.log('');
  }

  const tradeStats = results.find(r => r.tableName === 'OrderBookTrade');
  if (tradeStats?.sampleData) {
    console.log('Trade Sample:');
    console.log(JSON.stringify(tradeStats.sampleData, null, 2));
    console.log('');
  }

  const bucketStats = results.find(r => r.tableName === 'MinuteBucket');
  if (bucketStats?.sampleData) {
    console.log('MinuteBucket Sample:');
    console.log(JSON.stringify(bucketStats.sampleData, null, 2));
    console.log('');
  }

  // Recommendations
  console.log('\n💡 Recommendations:\n');

  if (poolStats?.count === 0) {
    console.log('⚠️  No pools found. Make sure PoolManager_PoolCreated events are being indexed.');
  }

  if (orderStats?.count === 0) {
    console.log('⚠️  No orders found. Make sure OrderPlaced events are being indexed.');
  }

  if (tradeStats?.count === 0) {
    console.log('⚠️  No trades found. Make sure OrderMatched events are being indexed.');
  }

  if (bucketStats?.count === 0) {
    console.log('⚠️  No candlestick data found. Buckets are created from OrderMatched events.');
  }

  if (totalRecords === 0) {
    console.log('❌ No aggregated data found!');
    console.log('   Please ensure:');
    console.log('   1. Envio indexer is running');
    console.log('   2. Event handlers are properly configured');
    console.log('   3. Blockchain events are being captured');
  } else {
    console.log('✅ Aggregated data is being created successfully!');
  }

  process.exit(0);
}

verifyData().catch((error) => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});
