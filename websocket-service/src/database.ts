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
      max: 5, // Limited connections for read-only service
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  async getOrderBookDepth(poolId: string, limit: number = 100) {
    try {
      const [bids, asks] = await Promise.all([
        // Bids (buy orders) - descending price
        this.sql`
          SELECT price, SUM(quantity - filled) as quantity
          FROM orders 
          WHERE pool_id = ${poolId} 
            AND side = 'Buy' 
            AND status IN ('OPEN', 'PARTIALLY_FILLED')
            AND price > 0
          GROUP BY price 
          ORDER BY price DESC 
          LIMIT ${limit}
        `,
        // Asks (sell orders) - ascending price  
        this.sql`
          SELECT price, SUM(quantity - filled) as quantity
          FROM orders 
          WHERE pool_id = ${poolId} 
            AND side = 'Sell' 
            AND status IN ('OPEN', 'PARTIALLY_FILLED')
            AND price > 0
          GROUP BY price 
          ORDER BY price ASC 
          LIMIT ${limit}
        `
      ]);

      return {
        bids: bids.map(row => [row.price.toString(), row.quantity.toString()]),
        asks: asks.map(row => [row.price.toString(), row.quantity.toString()])
      };
    } catch (error) {
      console.error('Error fetching order book depth:', error);
      return { bids: [], asks: [] };
    }
  }

  async getPoolBySymbol(symbol: string) {
    try {
      const pools = await this.sql`
        SELECT * FROM pools WHERE coin = ${symbol} LIMIT 1
      `;
      return pools[0] || null;
    } catch (error) {
      console.error('Error fetching pool by symbol:', error);
      return null;
    }
  }

  async getPools() {
    try {
      return await this.sql`
        SELECT * FROM pools
      `;
    } catch (error) {
      console.error('Error fetching pools:', error);
      return [];
    }
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