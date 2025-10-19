import { Hono } from 'hono';
import { DataSyncService } from '../sync/data-sync-service';
import { SimpleDatabaseClient } from '../shared/database';
import { TimescaleDatabaseClient } from '../shared/timescale-database';

export function createSyncRoutes(): Hono {
  const app = new Hono();

  // Initialize sync service
  const ponderDb = new SimpleDatabaseClient();
  const timescaleDb = TimescaleDatabaseClient.getInstance();
  const syncService = new DataSyncService(ponderDb, timescaleDb);

  /**
   * GET /api/sync/health
   * Check synchronization health status
   */
  app.get('/health', async (c) => {
    try {
      const health = await syncService.checkSyncHealth();

      return c.json({
        status: health.isHealthy ? 'healthy' : 'unhealthy',
        ...health,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Sync health check failed:', error);
      return c.json({
        error: 'Failed to check sync health',
        details: error.message
      }, 500);
    }
  });

  /**
   * POST /api/sync/run
   * Manually trigger data synchronization
   */
  app.post('/run', async (c) => {
    try {
      console.log('🔄 Manual sync triggered via API');
      const result = await syncService.syncMissedData();

      return c.json({
        success: true,
        message: `Sync completed: ${result.processed}/${result.total} trades processed`,
        ...result,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Manual sync failed:', error);
      return c.json({
        success: false,
        error: 'Sync failed',
        details: error.message
      }, 500);
    }
  });

  /**
   * POST /api/sync/force
   * Force sync from a specific timestamp
   */
  app.post('/force', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const { fromTimestamp } = body;

      if (!fromTimestamp) {
        return c.json({
          error: 'fromTimestamp is required',
          example: { fromTimestamp: 1698764400 }
        }, 400);
      }

      console.log(`🔄 Force sync triggered from timestamp: ${fromTimestamp}`);
      const result = await syncService.forceSyncFrom(fromTimestamp);

      return c.json({
        success: true,
        message: `Force sync completed: ${result.processed}/${result.total} trades processed`,
        fromTimestamp,
        fromDate: new Date(fromTimestamp * 1000).toISOString(),
        ...result,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Force sync failed:', error);
      return c.json({
        success: false,
        error: 'Force sync failed',
        details: error.message
      }, 500);
    }
  });

  /**
   * GET /api/sync/stats
   * Get sync statistics and metrics
   */
  app.get('/stats', async (c) => {
    try {
      const health = await syncService.checkSyncHealth();

      // Additional stats
      const stats = {
        health: health,
        lastSync: {
          ponder: {
            timestamp: health.lastPonderTimestamp,
            date: new Date(health.lastPonderTimestamp * 1000).toISOString()
          },
          analytics: {
            timestamp: health.lastAnalyticsTimestamp,
            date: new Date(health.lastAnalyticsTimestamp * 1000).toISOString()
          }
        },
        lag: {
          seconds: health.lastPonderTimestamp - health.lastAnalyticsTimestamp,
          minutes: health.lagMinutes,
          formatted: `${Math.floor(health.lagMinutes / 60)}h ${Math.floor(health.lagMinutes % 60)}m`
        },
        missedTrades: health.missedTrades,
        recommendation: health.recommendation,
        actions: {
          healthCheck: 'GET /api/sync/health',
          manualSync: 'POST /api/sync/run',
          forceSync: 'POST /api/sync/force { "fromTimestamp": 1698764400 }'
        }
      };

      return c.json({
        ...stats,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Failed to get sync stats:', error);
      return c.json({
        error: 'Failed to get sync statistics',
        details: error.message
      }, 500);
    }
  });

  /**
   * GET /api/sync/status
   * Simple status endpoint for monitoring
   */
  app.get('/status', async (c) => {
    try {
      const health = await syncService.checkSyncHealth();

      return c.json({
        status: health.isHealthy ? 'ok' : 'lagging',
        lagMinutes: Math.round(health.lagMinutes * 100) / 100,
        missedTrades: health.missedTrades,
        recommendation: health.recommendation,
        timestamp: Date.now()
      });

    } catch (error) {
      return c.json({
        status: 'error',
        error: error.message,
        timestamp: Date.now()
      }, 500);
    }
  });

  return app;
}