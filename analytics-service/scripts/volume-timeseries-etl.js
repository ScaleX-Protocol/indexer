#!/usr/bin/env node

/**
 * Volume Time-Series ETL Processor
 * Runs every 5 minutes to pre-compute volume analytics for 150x API performance improvement
 * Based on ETL_OPTIMIZATION_ANALYSIS.md Section 7: Volume Analytics Processing
 */

const { TimescaleDatabaseClient } = require('../dist/shared/timescale-database');

async function runVolumeTimeseriesETL() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting Volume Time-Series ETL processing...`);
  
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
    await timescaleDb.processVolumeTimeseries();
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ Volume Time-Series ETL completed successfully in ${duration}ms`);
    
    // Optional: Log processing statistics
    const topVolumeSymbols = await timescaleDb.getTopVolumeSymbols({ intervalType: '1h', days: 1, limit: 5 });
    console.log(`[${new Date().toISOString()}] 📊 Top 5 volume symbols (last 24h):`);
    
    // Log sample of processed data for monitoring
    topVolumeSymbols.slice(0, 3).forEach((symbol, index) => {
      console.log(`[${new Date().toISOString()}] 📈 #${index + 1}: ${symbol.symbol} - Volume: $${parseFloat(symbol.total_volume).toFixed(2)}, Trades: ${symbol.total_trades}, Trend: ${symbol.volume_trend}`);
    });
    
    // Check for volume anomalies
    const anomalies = await timescaleDb.getVolumeAnomalies({ hours: 1, threshold: 2.5 });
    if (anomalies.length > 0) {\n      console.log(`[${new Date().toISOString()}] ⚠️  Detected ${anomalies.length} volume anomalies:`);
      anomalies.slice(0, 3).forEach((anomaly, index) => {
        console.log(`[${new Date().toISOString()}] 🚨 ${anomaly.symbol}: ${parseFloat(anomaly.volume_spike_ratio).toFixed(2)}x spike, ${anomaly.whale_trade_count} whale trades`);
      });
    }
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Volume Time-Series ETL failed:`, error.message);
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
  runVolumeTimeseriesETL().catch(error => {
    console.error(`[${new Date().toISOString()}] ❌ Fatal error in Volume Time-Series ETL:`, error);
    process.exit(1);
  });
}

module.exports = { runVolumeTimeseriesETL };