import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DatabaseClient } from '../shared/database';
import { PortfolioService } from '../portfolio/portfolio-service';
import { MarketService } from '../market/market-service';

export function createApiServer(db: DatabaseClient) {
  const app = new Hono();
  
  // Initialize services
  const portfolioService = new PortfolioService(db);
  const marketService = new MarketService(db);

  // Middleware
  app.use('*', cors());

  // Health check
  app.get('/health', async (c) => {
    try {
      const dbHealthy = await db.healthCheck();
      return c.json({
        status: dbHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        database: dbHealthy ? 'connected' : 'disconnected'
      });
    } catch (error) {
      return c.json({ 
        status: 'error', 
        error: (error as Error).message 
      }, 503);
    }
  });

  // Portfolio endpoints
  app.get('/api/portfolio/:address', async (c) => {
    try {
      const address = c.req.param('address');
      if (!address) {
        return c.json({ error: 'Address parameter is required' }, 400);
      }

      const portfolio = await portfolioService.calculatePortfolio(address);
      return c.json(portfolio);
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      return c.json({ error: 'Failed to fetch portfolio data' }, 500);
    }
  });

  app.get('/api/portfolio/:address/performance', async (c) => {
    try {
      const address = c.req.param('address');
      if (!address) {
        return c.json({ error: 'Address parameter is required' }, 400);
      }

      const performance = await portfolioService.getPortfolioPerformance(address);
      return c.json(performance);
    } catch (error) {
      console.error('Error fetching portfolio performance:', error);
      return c.json({ error: 'Failed to fetch portfolio performance' }, 500);
    }
  });

  app.get('/api/portfolio/:address/allocation', async (c) => {
    try {
      const address = c.req.param('address');
      if (!address) {
        return c.json({ error: 'Address parameter is required' }, 400);
      }

      const allocation = await portfolioService.getAssetAllocation(address);
      return c.json(allocation);
    } catch (error) {
      console.error('Error fetching asset allocation:', error);
      return c.json({ error: 'Failed to fetch asset allocation' }, 500);
    }
  });

  app.get('/api/portfolio/:address/history', async (c) => {
    try {
      const address = c.req.param('address');
      const days = parseInt(c.req.query('days') || '30');
      
      if (!address) {
        return c.json({ error: 'Address parameter is required' }, 400);
      }

      const history = await portfolioService.getPortfolioHistory(address, days);
      return c.json(history);
    } catch (error) {
      console.error('Error fetching portfolio history:', error);
      return c.json({ error: 'Failed to fetch portfolio history' }, 500);
    }
  });

  // Market endpoints
  app.get('/api/market/overview', async (c) => {
    try {
      const overview = await marketService.getMarketOverview();
      return c.json(overview);
    } catch (error) {
      console.error('Error fetching market overview:', error);
      return c.json({ error: 'Failed to fetch market overview' }, 500);
    }
  });

  app.get('/api/market/symbol/:symbol', async (c) => {
    try {
      const symbol = c.req.param('symbol');
      if (!symbol) {
        return c.json({ error: 'Symbol parameter is required' }, 400);
      }

      const metrics = await marketService.getSymbolMetrics(symbol);
      return c.json(metrics);
    } catch (error) {
      console.error('Error fetching symbol metrics:', error);
      return c.json({ error: 'Failed to fetch symbol metrics' }, 500);
    }
  });

  app.get('/api/market/volume', async (c) => {
    try {
      const timeframe = c.req.query('timeframe') as '1h' | '24h' | '7d' | '30d' || '24h';
      const volume = await marketService.getTradingVolume(timeframe);
      return c.json(volume);
    } catch (error) {
      console.error('Error fetching trading volume:', error);
      return c.json({ error: 'Failed to fetch trading volume' }, 500);
    }
  });

  app.get('/api/market/liquidity', async (c) => {
    try {
      const liquidity = await marketService.getLiquidityMetrics();
      return c.json(liquidity);
    } catch (error) {
      console.error('Error fetching liquidity metrics:', error);
      return c.json({ error: 'Failed to fetch liquidity metrics' }, 500);
    }
  });

  app.get('/api/market/makers', async (c) => {
    try {
      const marketMakers = await marketService.getMarketMakers();
      return c.json(marketMakers);
    } catch (error) {
      console.error('Error fetching market makers:', error);
      return c.json({ error: 'Failed to fetch market makers' }, 500);
    }
  });

  app.get('/api/market/sentiment', async (c) => {
    try {
      const sentiment = await marketService.getMarketSentiment();
      return c.json(sentiment);
    } catch (error) {
      console.error('Error fetching market sentiment:', error);
      return c.json({ error: 'Failed to fetch market sentiment' }, 500);
    }
  });

  app.get('/api/market/arbitrage', async (c) => {
    try {
      const opportunities = await marketService.getArbitrageOpportunities();
      return c.json(opportunities);
    } catch (error) {
      console.error('Error fetching arbitrage opportunities:', error);
      return c.json({ error: 'Failed to fetch arbitrage opportunities' }, 500);
    }
  });

  app.get('/api/market/price/:symbol', async (c) => {
    try {
      const symbol = c.req.param('symbol');
      const interval = c.req.query('interval') || '1h';
      const limit = parseInt(c.req.query('limit') || '100');

      if (!symbol) {
        return c.json({ error: 'Symbol parameter is required' }, 400);
      }

      const priceData = await marketService.getPriceData(symbol, interval, limit);
      return c.json(priceData);
    } catch (error) {
      console.error('Error fetching price data:', error);
      return c.json({ error: 'Failed to fetch price data' }, 500);
    }
  });

  // Analytics aggregation endpoints
  app.get('/api/analytics/summary', async (c) => {
    try {
      const [marketOverview, sentiment] = await Promise.all([
        marketService.getMarketOverview(),
        marketService.getMarketSentiment()
      ]);

      return c.json({
        market: marketOverview,
        sentiment,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error fetching analytics summary:', error);
      return c.json({ error: 'Failed to fetch analytics summary' }, 500);
    }
  });

  app.get('/api/analytics/leaderboard', async (c) => {
    try {
      const [topTraders, marketMakers] = await Promise.all([
        marketService.getMarketOverview().then(data => data.topTraders),
        marketService.getMarketMakers()
      ]);

      return c.json({
        topTraders,
        marketMakers: marketMakers.slice(0, 10),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      return c.json({ error: 'Failed to fetch leaderboard' }, 500);
    }
  });

  return app;
}