import { DatabaseClient } from '../shared/database';
import { TimescaleDatabaseClient } from '../shared/timescale-database';

interface OrderBookState {
  [poolId: string]: {
    [side: string]: {
      [price: string]: {
        totalQuantity: number;
        orderCount: number;
        orders: Set<number>; // Track individual orders at this price level
      }
    }
  }
}

interface OrderDetails {
  orderId: number;
  poolId: string;
  price: number;
  quantity: number;
  side: string;
  symbol: string;
  baseDecimals: number;
  quoteDecimals: number;
}

export class HistoricalLiquidityJob {
  private ponderDb: DatabaseClient;
  private timescaleDb: TimescaleDatabaseClient;
  private orderBookState: OrderBookState = {};
  private orderDetailsCache: Map<number, OrderDetails> = new Map();

  constructor() {
    // Use ponder_core database for accessing order data
    this.ponderDb = new DatabaseClient(process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/ponder_core');
    this.timescaleDb = new TimescaleDatabaseClient();
  }

  /**
   * Reconstruct historical order book depth hour by hour using order_history
   * This implements the user's requirement: "construct new orderbookdepth starting from initial order hourly using order_history"
   */
  async reconstructHistoricalLiquidity(fromTimestamp?: number) {
    console.log('🏗️ Starting historical order book reconstruction...');

    try {
      // Get the starting point - either provided or first order in history
      const startTimestamp = fromTimestamp || await this.getFirstOrderTimestamp();
      const endTimestamp = Math.floor(Date.now() / 1000);
      
      console.log(`📅 Reconstructing from ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

      // Pre-load all order details for efficient lookup
      await this.loadOrderDetailsCache();

      // Initialize order book state with all OPEN orders before start time
      await this.initializeOrderBookState(startTimestamp);

      // Process hour by hour from start to end
      let currentHourStart = this.getHourStart(startTimestamp);
      let processedHours = 0;

      while (currentHourStart < endTimestamp) {
        const hourEnd = currentHourStart + 3600; // +1 hour
        
        console.log(`⏳ Processing hour: ${new Date(currentHourStart * 1000).toISOString()}`);
        
        // Get all order history events for this hour
        const hourlyEvents = await this.getOrderHistoryForHour(currentHourStart, hourEnd);
        
        // Process events in chronological order to build order book state
        for (const event of hourlyEvents) {
          await this.processOrderEvent(event);
        }

        // Take snapshot of current order book state at end of hour
        await this.captureHourlySnapshot(hourEnd);
        
        processedHours++;
        currentHourStart = hourEnd;

        // Progress logging every 24 hours
        if (processedHours % 24 === 0) {
          console.log(`✅ Processed ${processedHours} hours (${processedHours / 24} days)`);
        }
      }

      // Capture final snapshot with current order book state
      await this.captureCurrentSnapshot();

      console.log(`🎉 Historical reconstruction completed! Processed ${processedHours} hours total.`);
      
      return {
        success: true,
        hoursProcessed: processedHours,
        startTimestamp,
        endTimestamp
      };

    } catch (error) {
      console.error('❌ Failed to reconstruct historical liquidity:', error);
      throw error;
    }
  }

  /**
   * Get the timestamp of the first order in order_history
   */
  private async getFirstOrderTimestamp(): Promise<number> {
    const result = await this.ponderDb.sql`
      SELECT MIN(timestamp) as first_timestamp
      FROM order_history
    `;
    return result[0].first_timestamp;
  }

  /**
   * Initialize the order book state with all OPEN orders that existed before the start time
   * This ensures we start with the correct state rather than an empty order book
   */
  private async initializeOrderBookState(startTimestamp: number) {
    console.log('🏁 Initializing order book state with existing OPEN orders...');
    
    // Get all OPEN orders that were created before our start time
    const existingOrders = await this.ponderDb.sql`
      SELECT 
        o.order_id::numeric as order_id,
        o.timestamp,
        o.status
      FROM orders o
      WHERE o.timestamp < ${startTimestamp}
        AND o.status = 'OPEN'
    `;

    console.log(`📊 Found ${existingOrders.length} existing OPEN orders to initialize state`);

    // Process each existing order as an OPEN event
    for (const order of existingOrders) {
      await this.processOrderEvent({
        order_id: order.order_id,
        timestamp: order.timestamp,
        status: 'OPEN',
        filled: 0
      });
    }

    console.log('✅ Order book state initialized');
  }

  /**
   * Capture a snapshot of the current real-time order book state
   * This ensures we have the most up-to-date liquidity data
   */
  private async captureCurrentSnapshot() {
    console.log('📸 Capturing current real-time order book snapshot...');
    
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Clear the current state and rebuild from all OPEN orders
    this.orderBookState = {};
    
    // Get all currently OPEN orders
    const currentOrders = await this.ponderDb.sql`
      SELECT 
        o.order_id::numeric as order_id,
        o.timestamp,
        o.status
      FROM orders o
      WHERE o.status = 'OPEN'
    `;

    console.log(`📊 Found ${currentOrders.length} current OPEN orders`);

    // Process each current order
    for (const order of currentOrders) {
      await this.processOrderEvent({
        order_id: order.order_id,
        timestamp: order.timestamp,
        status: 'OPEN',
        filled: 0
      });
    }

    // Take snapshot at current time
    await this.captureHourlySnapshot(currentTime);
    
    console.log('✅ Current snapshot captured');
  }

  /**
   * Get hour start timestamp (round down to hour boundary)
   */
  private getHourStart(timestamp: number): number {
    return Math.floor(timestamp / 3600) * 3600;
  }

  /**
   * Pre-load all order details for efficient lookup during reconstruction
   */
  private async loadOrderDetailsCache() {
    console.log('💾 Loading order details cache...');
    
    const orderDetails = await this.ponderDb.sql`
      SELECT 
        o.order_id::numeric as order_id,
        o.pool_id,
        o.price::numeric as price,
        o.quantity::numeric as quantity,
        o.side,
        p.coin as symbol,
        p.base_decimals,
        p.quote_decimals
      FROM orders o
      JOIN pools p ON o.pool_id = p.order_book
      WHERE CAST(o.price AS NUMERIC) > 0
    `;

    for (const order of orderDetails) {
      this.orderDetailsCache.set(order.order_id, {
        orderId: order.order_id,
        poolId: order.pool_id,
        price: parseFloat(order.price),
        quantity: parseFloat(order.quantity),
        side: order.side,
        symbol: order.symbol,
        baseDecimals: order.base_decimals || 18,
        quoteDecimals: order.quote_decimals || 6
      });
    }

    console.log(`📊 Cached ${this.orderDetailsCache.size} order details`);
  }

  /**
   * Get all order history events for a specific hour
   */
  private async getOrderHistoryForHour(hourStart: number, hourEnd: number) {
    return await this.ponderDb.sql`
      SELECT 
        oh.order_id::numeric as order_id,
        oh.timestamp,
        oh.filled::numeric as filled,
        oh.status,
        oh.pool_id
      FROM order_history oh
      WHERE oh.timestamp >= ${hourStart} 
        AND oh.timestamp < ${hourEnd}
      ORDER BY oh.timestamp ASC, oh.order_id ASC
    `;
  }

  /**
   * Process a single order event and update the order book state
   */
  private async processOrderEvent(event: any) {
    const orderId = event.order_id;
    const orderDetails = this.orderDetailsCache.get(orderId);
    
    if (!orderDetails) {
      console.warn(`⚠️ Order details not found for order_id: ${orderId}`);
      return;
    }

    const { poolId, price, quantity, side } = orderDetails;
    
    // Skip orders with zero or negative prices (invalid data)
    if (price <= 0) {
      console.warn(`⚠️ Skipping order_id ${orderId} with invalid price: ${price}`);
      return;
    }
    // Use the raw price as string to maintain precision and avoid grouping issues
    const priceLevel = price.toString();

    // Initialize nested structure if needed
    if (!this.orderBookState[poolId]) {
      this.orderBookState[poolId] = {};
    }
    if (!this.orderBookState[poolId][side]) {
      this.orderBookState[poolId][side] = {};
    }
    if (!this.orderBookState[poolId][side][priceLevel]) {
      this.orderBookState[poolId][side][priceLevel] = {
        totalQuantity: 0,
        orderCount: 0,
        orders: new Set()
      };
    }

    const priceLevelData = this.orderBookState[poolId][side][priceLevel];

    switch (event.status) {
      case 'OPEN':
        // Add order to the book if not already present
        if (!priceLevelData.orders.has(orderId)) {
          priceLevelData.orders.add(orderId);
          priceLevelData.totalQuantity += quantity;
          priceLevelData.orderCount += 1;
        }
        break;

      case 'PARTIALLY_FILLED':
        // Update filled amount - keep order in book with remaining quantity
        if (priceLevelData.orders.has(orderId)) {
          const filledAmount = parseFloat(event.filled || '0');
          const remainingQuantity = Math.max(0, quantity - filledAmount);
          
          // Recalculate total quantity for this price level
          priceLevelData.totalQuantity = priceLevelData.totalQuantity - quantity + remainingQuantity;
          
          // If completely filled, remove the order
          if (remainingQuantity <= 0) {
            priceLevelData.orders.delete(orderId);
            priceLevelData.orderCount -= 1;
            
            // Clean up empty price levels
            if (priceLevelData.orderCount === 0) {
              delete this.orderBookState[poolId][side][priceLevel];
            }
          }
        }
        break;

      case 'FILLED':
      case 'CANCELLED':
        // Remove order completely from the book
        if (priceLevelData.orders.has(orderId)) {
          priceLevelData.orders.delete(orderId);
          priceLevelData.totalQuantity -= quantity;
          priceLevelData.orderCount -= 1;

          // Clean up empty price levels
          if (priceLevelData.orderCount === 0) {
            delete this.orderBookState[poolId][side][priceLevel];
          }
        }
        break;
    }
  }

  /**
   * Capture a snapshot of the current order book state
   */
  private async captureHourlySnapshot(timestamp: number) {
    const snapshots = [];

    for (const [poolId, poolData] of Object.entries(this.orderBookState)) {
      for (const [side, sideData] of Object.entries(poolData)) {
        for (const [priceLevel, levelData] of Object.entries(sideData)) {
          if (levelData.orderCount > 0 && levelData.totalQuantity > 0) {
            // Get order details for symbol and decimals
            const sampleOrderId = Array.from(levelData.orders)[0];
            const orderDetails = this.orderDetailsCache.get(sampleOrderId);
            
            if (orderDetails) {
              // Calculate liquidity value with proper decimal handling
              const humanQuantity = levelData.totalQuantity / Math.pow(10, orderDetails.baseDecimals);
              const humanPrice = parseFloat(priceLevel) / Math.pow(10, orderDetails.quoteDecimals);
              const liquidityValue = humanQuantity * humanPrice;

              snapshots.push({
                timestamp,
                poolId,
                symbol: orderDetails.symbol,
                side,
                price: parseFloat(priceLevel),
                quantity: levelData.totalQuantity,
                orderCount: levelData.orderCount,
                liquidityValue
              });
            }
          }
        }
      }
    }

    // Batch insert all snapshots for this hour
    if (snapshots.length > 0) {
      await this.insertSnapshots(snapshots);
      console.log(`📸 Captured ${snapshots.length} depth levels for ${new Date(timestamp * 1000).toISOString()}`);
    }
  }

  /**
   * Insert snapshots into TimescaleDB
   */
  private async insertSnapshots(snapshots: any[]) {
    for (const snapshot of snapshots) {
      await this.timescaleDb.sql`
        INSERT INTO analytics.liquidity_snapshots (
          snapshot_timestamp,
          pool_id,
          symbol,
          side,
          price,
          quantity,
          order_count,
          liquidity_value,
          interval_type
        ) VALUES (
          ${snapshot.timestamp},
          ${snapshot.poolId},
          ${snapshot.symbol},
          ${snapshot.side},
          ${snapshot.price},
          ${snapshot.quantity},
          ${snapshot.orderCount},
          ${snapshot.liquidityValue},
          'hourly'
        )
        ON CONFLICT (snapshot_timestamp, pool_id, side, interval_type) 
        DO UPDATE SET
          price = EXCLUDED.price,
          quantity = EXCLUDED.quantity,
          order_count = EXCLUDED.order_count,
          liquidity_value = EXCLUDED.liquidity_value,
          updated_at = NOW()
      `;
    }

    // Also create aggregated snapshot for this timestamp
    await this.createAggregatedSnapshot(snapshots[0].timestamp);
  }

  /**
   * Create aggregated liquidity snapshot per pool for faster queries
   */
  private async createAggregatedSnapshot(timestamp: number) {
    await this.timescaleDb.sql`
      INSERT INTO analytics.liquidity_snapshots_aggregated (
        snapshot_timestamp,
        pool_id,
        symbol,
        bid_liquidity,
        ask_liquidity,
        total_liquidity,
        bid_orders,
        ask_orders,
        best_bid,
        best_ask,
        spread,
        interval_type
      )
      SELECT 
        ${timestamp} as snapshot_timestamp,
        pool_id,
        symbol,
        SUM(CASE WHEN side = 'Buy' THEN liquidity_value ELSE 0 END) as bid_liquidity,
        SUM(CASE WHEN side = 'Sell' THEN liquidity_value ELSE 0 END) as ask_liquidity,
        SUM(liquidity_value) as total_liquidity,
        SUM(CASE WHEN side = 'Buy' THEN order_count ELSE 0 END) as bid_orders,
        SUM(CASE WHEN side = 'Sell' THEN order_count ELSE 0 END) as ask_orders,
        MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END) as best_bid,
        MIN(CASE WHEN side = 'Sell' THEN price END) as best_ask,
        CASE 
          WHEN MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END) > 0 
          AND MIN(CASE WHEN side = 'Sell' THEN price END) > MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)
          THEN (MIN(CASE WHEN side = 'Sell' THEN price END) - MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)) 
               / MAX(CASE WHEN side = 'Buy' THEN price ELSE 0 END)
          ELSE 0.0125
        END as spread,
        'hourly' as interval_type
      FROM analytics.liquidity_snapshots
      WHERE snapshot_timestamp = ${timestamp}
      GROUP BY pool_id, symbol
      ON CONFLICT (snapshot_timestamp, pool_id, interval_type) 
      DO UPDATE SET
        bid_liquidity = EXCLUDED.bid_liquidity,
        ask_liquidity = EXCLUDED.ask_liquidity,
        total_liquidity = EXCLUDED.total_liquidity,
        bid_orders = EXCLUDED.bid_orders,
        ask_orders = EXCLUDED.ask_orders,
        best_bid = EXCLUDED.best_bid,
        best_ask = EXCLUDED.best_ask,
        spread = EXCLUDED.spread,
        updated_at = NOW()
    `;
  }

  /**
   * Resume reconstruction from the last processed timestamp
   * Optimized for frequent incremental runs
   */
  async resumeReconstruction() {
    // Get the latest snapshot timestamp
    const lastSnapshot = await this.timescaleDb.sql`
      SELECT MAX(snapshot_timestamp) as last_timestamp
      FROM analytics.liquidity_snapshots
      WHERE interval_type = 'hourly'
    `;

    const lastTimestamp = lastSnapshot[0]?.last_timestamp;
    
    if (lastTimestamp) {
      const now = Math.floor(Date.now() / 1000);
      const timeSinceLastSnapshot = now - lastTimestamp;
      
      // If less than 5 minutes since last snapshot, skip processing
      if (timeSinceLastSnapshot < 300) {
        console.log(`⏩ Skipping - only ${Math.floor(timeSinceLastSnapshot / 60)} minutes since last snapshot`);
        return {
          success: true,
          hoursProcessed: 0,
          message: 'No new data to process'
        };
      }
      
      console.log(`🔄 Resuming reconstruction from ${new Date(lastTimestamp * 1000).toISOString()}`);
      return await this.reconstructHistoricalLiquidity(lastTimestamp);
    } else {
      console.log('🆕 No previous snapshots found, starting from beginning');
      return await this.reconstructHistoricalLiquidity();
    }
  }

  /**
   * Force a complete reconstruction regardless of existing snapshots
   * Useful for daily comprehensive catch-ups
   */
  async forceCompleteReconstruction() {
    console.log('🔄 Running complete reconstruction from first order...');
    return await this.reconstructHistoricalLiquidity();
  }
}