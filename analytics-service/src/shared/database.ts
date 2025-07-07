import postgres from 'postgres';

export class DatabaseClient {
  private sql: ReturnType<typeof postgres>;
  private static instance: DatabaseClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.sql = postgres(connectionString, {
      max: 10, // More connections for analytics workload
      idle_timeout: 20,
      connect_timeout: 30,
      options: {
        statement_timeout: 60000, // Longer timeout for analytics queries
        idle_in_transaction_session_timeout: 60000,
      }
    });
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  // Portfolio queries
  async getUserBalances(userId: string) {
    return await this.sql`
      SELECT b.*, c.symbol, c.decimals
      FROM balances b
      LEFT JOIN currencies c ON b.currency = c.address AND b.chain_id = c.chain_id
      WHERE b.user = ${userId}
        AND (b.amount > 0 OR b.locked_amount > 0)
    `;
  }

  async getUserTrades(userId: string, limit: number = 100) {
    return await this.sql`
      SELECT t.*, p.coin as symbol
      FROM order_book_trades t
      LEFT JOIN pools p ON t.pool_id = p.order_book
      WHERE t.user = ${userId}
      ORDER BY t.timestamp DESC
      LIMIT ${limit}
    `;
  }

  async getUserOrders(userId: string, status?: string) {
    const query = status 
      ? this.sql`
          SELECT o.*, p.coin as symbol
          FROM orders o
          LEFT JOIN pools p ON o.pool_id = p.order_book
          WHERE o.user = ${userId} AND o.status = ${status}
          ORDER BY o.timestamp DESC
        `
      : this.sql`
          SELECT o.*, p.coin as symbol
          FROM orders o
          LEFT JOIN pools p ON o.pool_id = p.order_book
          WHERE o.user = ${userId}
          ORDER BY o.timestamp DESC
        `;
    
    return await query;
  }

  // Market analytics queries
  async getSymbolStats24h(symbol?: string) {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    if (symbol) {
      return await this.sql`
        SELECT 
          p.coin as symbol,
          COALESCE(SUM(t.quantity * t.price), 0) as volume_24h,
          COUNT(t.id) as trades_24h,
          COUNT(DISTINCT t.user) as unique_traders_24h,
          MIN(t.price) as low_24h,
          MAX(t.price) as high_24h,
          AVG(t.price) as avg_price_24h
        FROM pools p
        LEFT JOIN order_book_trades t ON p.order_book = t.pool_id 
          AND t.timestamp >= ${oneDayAgo}
        WHERE p.coin = ${symbol}
        GROUP BY p.coin, p.order_book
      `;
    } else {
      return await this.sql`
        SELECT 
          p.coin as symbol,
          COALESCE(SUM(t.quantity * t.price), 0) as volume_24h,
          COUNT(t.id) as trades_24h,
          COUNT(DISTINCT t.user) as unique_traders_24h,
          MIN(t.price) as low_24h,
          MAX(t.price) as high_24h,
          AVG(t.price) as avg_price_24h
        FROM pools p
        LEFT JOIN order_book_trades t ON p.order_book = t.pool_id 
          AND t.timestamp >= ${oneDayAgo}
        GROUP BY p.coin, p.order_book
        ORDER BY volume_24h DESC
      `;
    }
  }

  async getTradingMetrics24h() {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    return await this.sql`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT user) as unique_traders,
        SUM(quantity * price) as total_volume,
        AVG(quantity * price) as avg_trade_size,
        MAX(quantity * price) as largest_trade
      FROM order_book_trades
      WHERE timestamp >= ${oneDayAgo}
    `;
  }

  async getTopTraders24h(limit: number = 10) {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    return await this.sql`
      SELECT 
        user,
        COUNT(*) as trade_count,
        SUM(quantity * price) as total_volume,
        AVG(quantity * price) as avg_trade_size,
        MAX(timestamp) as last_trade_time
      FROM order_book_trades
      WHERE timestamp >= ${oneDayAgo}
      GROUP BY user
      ORDER BY total_volume DESC
      LIMIT ${limit}
    `;
  }

  async getUserTradingStats(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const oneWeekAgo = now - 604800;

    return await this.sql`
      SELECT 
        COUNT(*) as total_trades,
        SUM(quantity * price) as total_volume,
        AVG(quantity * price) as avg_trade_size,
        MAX(timestamp) as last_trade_time,
        MIN(timestamp) as first_trade_time
      FROM order_book_trades
      WHERE user = ${userId}
    `;
  }

  async getLatestPrices() {
    return await this.sql`
      SELECT DISTINCT ON (t.pool_id)
        p.coin as symbol,
        t.price,
        t.timestamp
      FROM order_book_trades t
      INNER JOIN pools p ON t.pool_id = p.order_book
      ORDER BY t.pool_id, t.timestamp DESC
    `;
  }

  async getCurrencies() {
    return await this.sql`
      SELECT * FROM currencies
      ORDER BY symbol
    `;
  }

  async getPools() {
    return await this.sql`
      SELECT * FROM pools
      ORDER BY coin
    `;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  async close() {
    await this.sql.end();
  }
}