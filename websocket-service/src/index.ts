import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { WebSocketServer } from './websocket-server';
import { EventConsumer } from './event-consumer';
import { DatabaseClient } from './database';

dotenv.config();

class WebSocketService {
  private redis: Redis;
  private db: DatabaseClient;
  private wsServer: WebSocketServer;
  private eventConsumer: EventConsumer;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    // Initialize database connection
    this.db = DatabaseClient.getInstance();

    // Initialize WebSocket server
    const port = parseInt(process.env.PORT || '42080');
    this.wsServer = new WebSocketServer(port, this.db);

    // Initialize event consumer
    this.eventConsumer = new EventConsumer(this.redis, this.wsServer);
  }

  async start() {
    try {
      console.log('Starting WebSocket Service...');

      // Test connections
      await this.testConnections();

      // Initialize event consumer (create consumer groups)
      await this.eventConsumer.initialize();

      // Start consuming events
      this.eventConsumer.start();

      // Set up health check endpoint
      this.setupHealthCheck();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      console.log('WebSocket Service started successfully');
      console.log(`Server running on port ${process.env.PORT || 42080}`);
      console.log('Ready to accept WebSocket connections');

    } catch (error) {
      console.error('Failed to start WebSocket Service:', error);
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

  private setupHealthCheck() {
    // Simple HTTP health check endpoint
    const http = require('http');
    
    const healthServer = http.createServer(async (req: any, res: any) => {
      if (req.url === '/health') {
        try {
          const redisHealthy = await this.eventConsumer.healthCheck();
          const dbHealthy = await this.db.healthCheck();
          const wsStats = this.wsServer.getStats();

          const health = {
            status: redisHealthy && dbHealthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            redis: redisHealthy ? 'connected' : 'disconnected',
            database: dbHealthy ? 'connected' : 'disconnected',
            websocket: wsStats
          };

          res.writeHead(redisHealthy && dbHealthy ? 200 : 503, {
            'Content-Type': 'application/json'
          });
          res.end(JSON.stringify(health, null, 2));
        } catch (error) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: (error as Error).message }));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    const healthPort = parseInt(process.env.HEALTH_PORT || '8080');
    healthServer.listen(healthPort, () => {
      console.log(`Health check endpoint available at http://localhost:${healthPort}/health`);
    });
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      
      try {
        // Stop consuming events
        await this.eventConsumer.stop();
        
        // Close WebSocket server
        await this.wsServer.close();
        
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
const service = new WebSocketService();
service.start().catch(error => {
  console.error('Failed to start service:', error);
  process.exit(1);
});