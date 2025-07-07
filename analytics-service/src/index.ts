import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { serve } from '@hono/node-server';
import { DatabaseClient } from './shared/database';
import { AnalyticsEventConsumer } from './event-consumer';
import { createApiServer } from './api/index';
import * as cron from 'node-cron';

dotenv.config();

class AnalyticsService {
  private redis: Redis;
  private db: DatabaseClient;
  private eventConsumer: AnalyticsEventConsumer;
  private apiServer: any;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    // Initialize database connection
    this.db = DatabaseClient.getInstance();

    // Initialize event consumer
    this.eventConsumer = new AnalyticsEventConsumer(this.redis, this.db);

    // Initialize API server
    this.apiServer = createApiServer(this.db);
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
  }

  private setupPeriodicTasks() {
    console.log('Setting up periodic analytics tasks...');

    // Daily portfolio snapshots (runs at midnight)
    cron.schedule('0 0 * * *', async () => {
      console.log('Running daily portfolio snapshot task...');
      try {
        await this.generateDailyPortfolioSnapshots();
      } catch (error) {
        console.error('Error in daily portfolio snapshot task:', error);
      }
    });

    // Hourly market metrics aggregation
    cron.schedule('0 * * * *', async () => {
      console.log('Running hourly market metrics aggregation...');
      try {
        await this.aggregateHourlyMetrics();
      } catch (error) {
        console.error('Error in hourly metrics aggregation:', error);
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

    console.log('Periodic tasks scheduled successfully');
  }

  private async generateDailyPortfolioSnapshots() {
    // TODO: Implement daily portfolio snapshot generation
    // This would:
    // 1. Get all users with non-zero balances
    // 2. Calculate portfolio values at end of day
    // 3. Store snapshots for historical analysis
    console.log('Daily portfolio snapshots task - TODO: Implement');
  }

  private async aggregateHourlyMetrics() {
    // TODO: Implement hourly metrics aggregation
    // This would:
    // 1. Aggregate trading volumes by symbol
    // 2. Calculate price movements
    // 3. Update market sentiment indicators
    // 4. Store aggregated data for fast retrieval
    console.log('Hourly metrics aggregation task - TODO: Implement');
  }

  private async refreshCachedMetrics() {
    try {
      // Refresh frequently accessed metrics in Redis cache
      const cacheKeys = [
        'market:overview',
        'market:sentiment',
        'trading:volume:24h'
      ];

      // Set cache TTL to 6 minutes (refresh every 5 minutes with 1 minute buffer)
      const ttl = 360;

      // Pre-calculate and cache market overview
      // TODO: Implement actual caching logic
      
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
}

// Start the service
const service = new AnalyticsService();
service.start().catch(error => {
  console.error('Failed to start service:', error);
  process.exit(1);
});