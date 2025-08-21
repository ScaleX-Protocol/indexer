#!/usr/bin/env node

/**
 * Capital Flow Analytics ETL Processor
 * Runs every hour to process capital flow analytics and enable new insights
 * Based on ETL_OPTIMIZATION_ANALYSIS.md Section 8: Capital Flow Processing
 */

const { TimescaleDatabaseClient } = require('../dist/shared/timescale-database');

async function runCapitalFlowETL() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting Capital Flow Analytics ETL processing...`);
  
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
    await timescaleDb.processCapitalFlowAnalytics();
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ Capital Flow ETL completed successfully in ${duration}ms`);
    
    // Optional: Log processing statistics
    const topFlowSymbols = await timescaleDb.getTopCapitalFlowSymbols({ 
      periodType: '1h', 
      days: 1, 
      flowType: 'net', 
      limit: 5 \n    });
    console.log(`[${new Date().toISOString()}] 📊 Top 5 capital flow symbols (last 24h):`);
    
    // Log sample of processed data for monitoring
    topFlowSymbols.slice(0, 3).forEach((symbol, index) => {
      const netFlow = parseFloat(symbol.total_net_flow);
      const flowDirection = netFlow >= 0 ? '📈 Inflow' : '📉 Outflow';
      console.log(`[${new Date().toISOString()}] ${flowDirection} #${index + 1}: ${symbol.symbol} - Net: $${Math.abs(netFlow).toFixed(2)}, Smart Money: $${parseFloat(symbol.smart_money_total).toFixed(2)}, Strength: ${symbol.avg_flow_strength}`);
    });
    
    // Check for capital flow alerts
    const alerts = await timescaleDb.getCapitalFlowAlerts({ 
      periodType: '1h', 
      hours: 6, 
      thresholdMultiplier: 2.5 \n    });
    if (alerts.length > 0) {
      console.log(`[${new Date().toISOString()}] 🚨 Detected ${alerts.length} capital flow alerts:`);
      alerts.slice(0, 3).forEach((alert, index) => {
        const flowDirection = parseFloat(alert.net_flow) >= 0 ? '⬆️ ' : '⬇️ ';
        console.log(`[${new Date().toISOString()}] ${flowDirection} ${alert.symbol}: ${alert.alert_type} - ${parseFloat(alert.flow_magnitude).toFixed(2)}x normal, Smart Money: $${parseFloat(alert.smart_money_flow).toFixed(2)}`);
      });
    }
    
    // Log smart money summary
    const smartMoneySymbols = await timescaleDb.getTopCapitalFlowSymbols({ 
      periodType: '1h', 
      days: 1, 
      flowType: 'smart_money', 
      limit: 3 
    });
    if (smartMoneySymbols.length > 0) {
      console.log(`[${new Date().toISOString()}] 🧠 Top smart money flows:`);
      smartMoneySymbols.forEach((symbol, index) => {
        const smartFlow = parseFloat(symbol.smart_money_total);
        const direction = smartFlow >= 0 ? 'INTO' : 'OUT OF';
        console.log(`[${new Date().toISOString()}] 💰 #${index + 1}: $${Math.abs(smartFlow).toFixed(2)} ${direction} ${symbol.symbol}`);
      });
    }
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Capital Flow ETL failed:`, error.message);
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
  runCapitalFlowETL().catch(error => {
    console.error(`[${new Date().toISOString()}] ❌ Fatal error in Capital Flow ETL:`, error);
    process.exit(1);
  });
}

module.exports = { runCapitalFlowETL };