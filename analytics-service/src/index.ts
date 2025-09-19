import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { serve } from '@hono/node-server';
import { DatabaseClient } from './shared/database';
import { SimpleDatabaseClient } from './shared/database-simple';
import { TimescaleDatabaseClient } from './shared/timescale-database';
import { AnalyticsEventConsumer } from './event-consumer';
import { createApiServer } from './api/index';
import { LeaderboardService } from './leaderboard/leaderboard-service';
import * as cron from 'node-cron';

dotenv.config();

class AnalyticsService {
  private redis: Redis;
  private db: DatabaseClient;
  private simpleDb: SimpleDatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;
  private eventConsumer: AnalyticsEventConsumer;
  private leaderboardService: LeaderboardService;
  private apiServer: any;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    // Initialize Postgres connection
    this.db = DatabaseClient.getInstance();
    
    // Initialize Simple Database client with working queries
    this.simpleDb = new SimpleDatabaseClient();
    
    // Initialize TimescaleDB connection
    this.timescaleDb = TimescaleDatabaseClient.getInstance();

    // Initialize event consumer with chain ID
    const chainId = process.env.DEFAULT_CHAIN_ID || '31337';
    this.eventConsumer = new AnalyticsEventConsumer(this.redis, this.timescaleDb, chainId);

    // Initialize leaderboard service
    this.leaderboardService = new LeaderboardService(this.db, this.redis, this.timescaleDb);

    // Initialize API server - use simple database client for working queries
    this.apiServer = createApiServer(this.simpleDb, this.redis, this.eventConsumer, this.leaderboardService, this.timescaleDb);
  }

  async start() {
    try {
      console.log('Starting Analytics Service...');

      // Test connections
      await this.testConnections();

      // Initialize event consumer
      await this.eventConsumer.initialize();

      // Start consuming events
      this.eventConsumer.start();

      // Start API server
      const port = parseInt(process.env.PORT || '3001');
      serve({
        fetch: this.apiServer.fetch,
        port
      });

      // Set up periodic tasks
      this.setupPeriodicTasks();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      console.log('Analytics Service started successfully');
      console.log(`API server running on port ${port}`);
      console.log('Ready to process analytics events');

    } catch (error) {
      console.error('Failed to start Analytics Service:', error);
      process.exit(1);
    }
  }

  private async testConnections() {
    console.log('Testing connections...');

    // Test Redis connection
    try {
      await this.redis.ping();
      console.log('✓ Redis connection successful');
    } catch (error) {
      console.error('✗ Redis connection failed:', error);
      throw error;
    }

    // Test database connection
    try {
      const isHealthy = await this.db.healthCheck();
      if (isHealthy) {
        console.log('✓ Database connection successful');
      } else {
        throw new Error('Database health check failed');
      }
    } catch (error) {
      console.error('✗ Database connection failed:', error);
      throw error;
    }

    // Test TimescaleDB connection
    try {
      const isHealthy = await this.timescaleDb.healthCheck();
      if (isHealthy) {
        console.log('✓ TimescaleDB connection successful');
      } else {
        throw new Error('TimescaleDB health check failed');
      }
    } catch (error) {
      console.error('✗ TimescaleDB connection failed:', error);
      throw error;
    }
  }

  private setupPeriodicTasks() {
    console.log('Setting up periodic analytics tasks...');

    // Daily portfolio snapshots (runs at midnight) - now using TimescaleDB
    cron.schedule('0 0 * * *', async () => {
      console.log('Running daily portfolio snapshot task...');
      try {
        await this.generateDailyPortfolioSnapshots();
      } catch (error) {
        console.error('Error in daily portfolio snapshot task:', error);
      }
    });

    // Refresh materialized views every 5 minutes (TimescaleDB continuous aggregates)
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.timescaleDb.refreshMaterializedViews();
        console.log('TimescaleDB continuous aggregates refreshed');
      } catch (error) {
        console.error('Error refreshing continuous aggregates:', error);
      }
    });

    // Generate market metrics every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
      try {
        await this.timescaleDb.generateMarketMetrics();
        console.log('Market metrics generated successfully');
      } catch (error) {
        console.error('Error generating market metrics:', error);
      }
    });

    // 5-minute cache refresh for frequently accessed data
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.refreshCachedMetrics();
      } catch (error) {
        console.error('Error refreshing cached metrics:', error);
      }
    });

    // Process retry queue every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        await this.eventConsumer.processRetryQueue();
      } catch (error) {
        console.error('Error processing retry queue:', error);
      }
    });

    // Update unrealized PNL for all symbols every minute (Binance style)
    cron.schedule('* * * * *', async () => {
      try {
        await this.updateAllUnrealizedPnL();
      } catch (error) {
        console.error('Error updating unrealized PNL:', error);
      }
    });

    console.log('Periodic tasks scheduled successfully');
  }

  private async generateDailyPortfolioSnapshots() {
    try {
      console.log('Generating daily portfolio snapshots...');
      
      // Generate simplified portfolio snapshots from TimescaleDB data
      const result = await this.timescaleDb.sql`
        INSERT INTO analytics.portfolio_snapshots (user_id, total_value, asset_values, timestamp)
        SELECT 
          user_id,
          SUM(ABS(CAST(quantity AS DECIMAL)) * CAST(avg_cost AS DECIMAL)) as total_value,
          ('{ "positions": [' || 
           string_agg(
             '{ "symbol": "' || symbol || '", "value": ' || 
             (ABS(CAST(quantity AS DECIMAL)) * CAST(avg_cost AS DECIMAL))::text || ' }', 
             ', '
           ) || 
           '] }')::jsonb as asset_values,
          NOW() as timestamp
        FROM analytics.positions 
        WHERE ABS(CAST(quantity AS DECIMAL)) > 0.001
        GROUP BY user_id
        HAVING SUM(ABS(CAST(quantity AS DECIMAL)) * CAST(avg_cost AS DECIMAL)) > 0
        ON CONFLICT (timestamp, id) DO NOTHING
        RETURNING *
      `;
      
      console.log(`Generated ${result.length} portfolio snapshots from position data`);
      
    } catch (error) {
      console.error('Error generating daily portfolio snapshots:', error);
      throw error;
    }
  }

  // Removed aggregateHourlyMetrics - using TimescaleDB continuous aggregates instead

  private async refreshCachedMetrics() {
    try {
      console.log('Refreshing cached metrics...');
      
      // Set cache TTL to 6 minutes (refresh every 5 minutes with 1 minute buffer)
      const ttl = 360;

      // Cache 24h trading volume from TimescaleDB
      try {
        const volume24h = await this.timescaleDb.getTradingMetrics24h();
        await this.redis.setex('cache:trading:volume:24h', ttl, JSON.stringify(volume24h[0] || {}));
      } catch (error) {
        console.error('Error caching trading volume:', error);
      }
      
      // Cache top symbols data from TimescaleDB
      try {
        const topSymbols = await this.timescaleDb.getSymbolStats24h();
        await this.redis.setex('cache:top:symbols', ttl, JSON.stringify(topSymbols.slice(0, 20)));
      } catch (error) {
        console.error('Error caching top symbols:', error);
      }
      
      console.log('Cache refresh completed');
    } catch (error) {
      console.error('Error refreshing cache:', error);
    }
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      
      try {
        // Stop consuming events
        await this.eventConsumer.stop();
        
        // Close database connection
        await this.db.close();
        
        // Close TimescaleDB connection
        await this.timescaleDb.close();
        
        // Close Redis connection
        this.redis.disconnect();
        
        console.log('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }

  private async updateAllUnrealizedPnL() {
    try {
      console.log('Updating unrealized PNL for all positions...');
      
      // Get latest prices from Redis (fast access)
      const priceData = await this.redis.hgetall('latest_prices');
      
      // Update unrealized PNL for each symbol (using TimescaleDB)
      for (const [symbol, price] of Object.entries(priceData)) {
        const currentPrice = parseFloat(price);
        await this.eventConsumer.updateAllUnrealizedPnL(symbol, currentPrice);
      }
      
      console.log(`Unrealized PNL updated for ${Object.keys(priceData).length} symbols`);
      
    } catch (error) {
      console.error('Error in updateAllUnrealizedPnL:', error);
      throw error;
    }
  }
}

// Start the service
const service = new AnalyticsService();
service.start().catch(error => {
  console.error('Failed to start service:', error);
  process.exit(1);
});