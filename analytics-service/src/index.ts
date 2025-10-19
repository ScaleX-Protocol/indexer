import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { serve } from '@hono/node-server';
import { DatabaseClient } from './shared/database';
import { TimescaleDatabaseClient } from './shared/timescale-database';
// Event consumer removed - using polling-based approach
import { createApiServer } from './api/index';
import { LeaderboardService } from './leaderboard/leaderboard-service';
import * as cron from 'node-cron';

dotenv.config();

class AnalyticsService {
  private redis: Redis;
  private db: DatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;
  private leaderboardService: LeaderboardService;
  private apiServer: any;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    // Initialize database connection using DatabaseClient
    this.db = DatabaseClient.getInstance();

    // Initialize TimescaleDB connection
    this.timescaleDb = TimescaleDatabaseClient.getInstance();

    // Initialize leaderboard service
    this.leaderboardService = new LeaderboardService(this.db, this.redis, this.timescaleDb);

    // Initialize API server
    this.apiServer = createApiServer(this.db, this.redis, null, this.leaderboardService, this.timescaleDb);
  }

  async start() {
    try {
      console.log('Starting Analytics Service...');

      // Test connections
      await this.testConnections();

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
      console.log('Using polling-based data processing');

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

    // Removed retry queue processing - no longer using event consumer

    // Process new trades for position updates every 30 seconds
    cron.schedule('*/30 * * * * *', async () => {
      try {
        await this.updateUserPositions();
      } catch (error) {
        console.error('Error updating user positions:', error);
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

  private async updateUserPositions() {
    try {
      console.log('🔄 Processing new trades for position updates...');

      // Get last processed state from Redis
      const stateKey = `analytics:position_update:state`;
      const stateJson = await this.redis.get(stateKey);
      let lastProcessedId = '0';
      let lastProcessedTimestamp = 0;

      if (stateJson) {
        const state = JSON.parse(stateJson);
        lastProcessedId = state.lastProcessedId || '0';
        lastProcessedTimestamp = state.lastProcessedTimestamp || 0;
      }

      // Query new trades since last processed
      // Note: Since transaction_id matching doesn't work, we'll match trades to the most recent order for the same pool
      const newTrades = await this.db.sql`
        SELECT DISTINCT ON (obt.id)
          obt.id,
          (
            SELECT o.user 
            FROM orders o 
            WHERE o.pool_id = obt.pool_id 
              AND o.side = obt.side 
              AND o.timestamp <= obt.timestamp
              AND o.user IS NOT NULL
            ORDER BY o.timestamp DESC 
            LIMIT 1
          ) as user,
          p.coin as symbol,
          obt.side,
          CAST(obt.quantity AS TEXT) as quantity,
          CAST(obt.price AS TEXT) as price,
          obt.timestamp,
          obt.pool_id
        FROM order_book_trades obt
        JOIN pools p ON p.order_book = obt.pool_id
        WHERE (obt.timestamp > ${lastProcessedTimestamp} OR (obt.timestamp = ${lastProcessedTimestamp} AND obt.id > ${lastProcessedId}))
          AND EXISTS (
            SELECT 1 FROM orders o 
            WHERE o.pool_id = obt.pool_id 
              AND o.side = obt.side 
              AND o.timestamp <= obt.timestamp
              AND o.user IS NOT NULL
          )
        ORDER BY obt.id, obt.timestamp ASC
        LIMIT 500
      `;

      if (newTrades.length === 0) {
        console.log('✅ No new trades to process for positions');
        return;
      }

      console.log(`📊 Processing ${newTrades.length} new trades for position updates`);

      let processedCount = 0;
      let newLastProcessedId = lastProcessedId;
      let newLastProcessedTimestamp = lastProcessedTimestamp;

      // Process each trade
      for (const trade of newTrades) {
        try {
          await this.updateUserPosition(
            trade.user,
            trade.symbol,
            parseFloat(trade.quantity),
            parseFloat(trade.price),
            trade.side,
            trade.timestamp
          );

          processedCount++;
          newLastProcessedId = trade.id;
          newLastProcessedTimestamp = trade.timestamp;

        } catch (error) {
          console.error(`Error processing trade ${trade.id} for position:`, error);
          // Continue processing other trades
        }
      }

      // Update processing state
      await this.redis.setex(stateKey, 86400, JSON.stringify({
        lastProcessedId: newLastProcessedId,
        lastProcessedTimestamp: newLastProcessedTimestamp,
        lastRunTime: Date.now(),
        totalProcessed: processedCount
      }));

      console.log(`✅ Position updates: processed ${processedCount}/${newTrades.length} trades`);

    } catch (error) {
      console.error('Error in updateUserPositions:', error);
      throw error;
    }
  }

  private async updateUserPosition(
    userId: string,
    symbol: string,
    quantity: number,
    price: number,
    side: string,
    timestamp: number
  ) {
    try {
      // Get current position
      const currentPosition = await this.timescaleDb.getUserPosition(userId, symbol);

      if (!currentPosition) {
        // New position (normalize large values)
        const normalizedQuantity = quantity / 1e18;
        const normalizedPrice = price / 1e9;
        const positionData = {
          user_id: userId,
          symbol: symbol,
          quantity: (side === 'buy' ? normalizedQuantity : -normalizedQuantity).toString(),
          avg_cost: normalizedPrice.toString(),
          total_cost: (normalizedQuantity * normalizedPrice).toString(),
          realized_pnl: '0',
          unrealized_pnl: '0'
        };

        await this.timescaleDb.upsertPosition(positionData);
      } else {
        // Update existing position using FIFO accounting
        const normalizedQuantity = quantity / 1e18;
        const normalizedPrice = price / 1e9;

        let newQuantity = parseFloat(currentPosition.quantity);
        let newAvgPrice = parseFloat(currentPosition.avg_cost);
        let newTotalCost = parseFloat(currentPosition.total_cost);
        let newRealizedPnl = parseFloat(currentPosition.realized_pnl);

        if (side === 'buy') {
          // Buy order - add to position
          newQuantity += normalizedQuantity;
          newTotalCost += normalizedQuantity * normalizedPrice;
        } else {
          // Sell order - FIFO calculation
          if (newQuantity > 0) {
            const avgCost = newTotalCost / newQuantity;
            const sellQuantity = Math.min(normalizedQuantity, newQuantity);

            // Calculate realized PNL for sold portion
            const realizedForThisTrade = (normalizedPrice - avgCost) * sellQuantity;
            newRealizedPnl += realizedForThisTrade;

            // Reduce position
            newQuantity -= sellQuantity;
            newTotalCost -= avgCost * sellQuantity;

            // If oversold, handle as new short position
            if (normalizedQuantity > sellQuantity) {
              const shortQuantity = normalizedQuantity - sellQuantity;
              newQuantity = -shortQuantity;
              newTotalCost = -(shortQuantity * normalizedPrice);
            }
          } else {
            // Already short or no position - add to short
            newQuantity -= normalizedQuantity;
            newTotalCost -= normalizedQuantity * normalizedPrice;
          }
        }

        // Calculate avgPrice for storage
        newAvgPrice = newQuantity !== 0 ? Math.abs(newTotalCost / newQuantity) : 0;

        const positionData = {
          user_id: userId,
          symbol: symbol,
          quantity: newQuantity.toString(),
          avg_cost: newAvgPrice.toString(),
          total_cost: newTotalCost.toString(),
          realized_pnl: newRealizedPnl.toString(),
          unrealized_pnl: '0'
        };

        await this.timescaleDb.upsertPosition(positionData);

        // Update unrealized PnL with current price
        await this.updateUnrealizedPnL(userId, symbol, price, timestamp);
      }

    } catch (error) {
      console.error(`Error updating position for user ${userId}, symbol ${symbol}:`, error);
      throw error;
    }
  }

  private async updateUnrealizedPnL(userId: string, symbol: string, currentPrice: number, _timestamp: number) {
    try {
      // Get current position
      const position = await this.timescaleDb.getUserPosition(userId, symbol);

      if (!position || parseFloat(position.quantity) == 0) {
        return;
      }

      const quantity = parseFloat(position.quantity);
      const avgCost = parseFloat(position.avg_cost);

      // Normalize current price
      const normalizedCurrentPrice = currentPrice / 1e9;

      // Calculate unrealized PNL
      const unrealizedPnL = (normalizedCurrentPrice - avgCost) * quantity;

      // Update position with new unrealized PNL
      const updatedPosition = {
        user_id: userId,
        symbol: symbol,
        quantity: position.quantity,
        avg_cost: position.avg_cost,
        total_cost: position.total_cost,
        realized_pnl: position.realized_pnl,
        unrealized_pnl: unrealizedPnL.toString()
      };

      await this.timescaleDb.upsertPosition(updatedPosition);

    } catch (error) {
      console.error(`Error updating unrealized PNL for ${userId}:${symbol}:`, error);
    }
  }

  private async updateAllUnrealizedPnL() {
    try {
      console.log('Updating unrealized PNL for all positions...');

      // Get latest prices from Redis (fast access)
      const priceData = await this.redis.hgetall('latest_prices');

      // Update unrealized PNL for each symbol (using TimescaleDB)
      for (const [symbol, price] of Object.entries(priceData)) {
        const currentPrice = parseFloat(price);
        const positions = await this.timescaleDb.getPositionsBySymbol(symbol);
        for (const position of positions) {
          await this.updateUnrealizedPnL(position.user_id, symbol, currentPrice, Date.now());
        }
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