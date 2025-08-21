#!/usr/bin/env node

/**
 * User Activity Aggregation ETL Processor
 * Runs every hour to pre-compute user activity aggregations for 100x API performance improvement
 * Based on ETL_OPTIMIZATION_ANALYSIS.md Section 6: User Activity Processing
 */

const { TimescaleDatabaseClient } = require('../dist/shared/timescale-database');

async function runUserActivityETL() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting User Activity Aggregation ETL processing...`);
  
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
    await timescaleDb.processUserActivityAggregation();
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ User Activity ETL completed successfully in ${duration}ms`);
    
    // Optional: Log processing statistics
    const topTraders = await timescaleDb.getTopTradersByActivity({ limit: 5 });
    console.log(`[${new Date().toISOString()}] 📊 Processed user activity data. Top 5 most active traders:`);
    
    // Log sample of processed data for monitoring
    topTraders.slice(0, 3).forEach((trader, index) => {
      console.log(`[${new Date().toISOString()}] 📈 #${index + 1}: ${trader.user_id.slice(0, 8)}... - Volume: $${parseFloat(trader.total_volume).toFixed(2)}, Activity Score: ${parseFloat(trader.avg_activity_score).toFixed(2)}, Win Rate: ${parseFloat(trader.avg_win_rate).toFixed(1)}%`);
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ User Activity ETL failed:`, error.message);
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
  runUserActivityETL().catch(error => {
    console.error(`[${new Date().toISOString()}] ❌ Fatal error in User Activity ETL:`, error);
    process.exit(1);
  });
}

module.exports = { runUserActivityETL };