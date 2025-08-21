#!/usr/bin/env node

/**
 * Slippage Analytics ETL Processor
 * Runs every hour to pre-compute slippage analytics for 200x API performance improvement
 * Based on ETL_OPTIMIZATION_ANALYSIS.md Section 4: Slippage Analytics Processing
 */

const { TimescaleDatabaseClient } = require('../dist/shared/timescale-database');

async function runSlippageETL() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting Slippage Analytics ETL processing...`);
  
  let timescaleDb;
  
  try {
    // Initialize TimescaleDB connection
    timescaleDb = TimescaleDatabaseClient.getInstance();
    
    // Health check
    const isHealthy = await timescaleDb.healthCheck();
    if (!isHealthy) {
      throw new Error('TimescaleDB health check failed');
    }
    
    // Run the ETL processing function
    await timescaleDb.processSlippageAnalytics();
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ Slippage ETL completed successfully in ${duration}ms`);
    
    // Optional: Log processing statistics
    const latestMetrics = await timescaleDb.getLatestSlippageMetrics();
    console.log(`[${new Date().toISOString()}] 📊 Processed ${latestMetrics.length} symbol/category combinations`);
    
    // Log sample of processed data for monitoring
    if (latestMetrics.length > 0) {
      const sample = latestMetrics[0];
      console.log(`[${new Date().toISOString()}] 📈 Sample: ${sample.symbol} (${sample.trade_size_category}) - Avg Slippage: ${sample.avg_slippage_bps}bps, Trades: ${sample.trades_count}`);
    }
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Slippage ETL failed:`, error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    // Clean up connections
    if (timescaleDb) {
      try {
        await timescaleDb.close();
      } catch (closeError) {
        console.warn(`[${new Date().toISOString()}] ⚠️  Warning: Error closing TimescaleDB connection:`, closeError.message);
      }
    }
  }
}

// Handle process signals for graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] 🛑 Received SIGTERM, shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] 🛑 Received SIGINT, shutting down gracefully...`);
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] ❌ Unhandled Rejection at:`, promise, 'reason:', reason);
  process.exit(1);
});

// Run the ETL process
if (require.main === module) {
  runSlippageETL().catch(error => {
    console.error(`[${new Date().toISOString()}] ❌ Fatal error in Slippage ETL:`, error);
    process.exit(1);
  });
}

module.exports = { runSlippageETL };