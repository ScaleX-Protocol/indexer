import { OrderMatchedEventArgs, OrderPlacedEventArgs } from "@/types";
import {
  createDepthData,
  createOrderData,
  createOrderHistoryId,
  createOrderId,
  createPoolId,
  createTradeId,
  getOppositeSide,
  getSide,
  insertOrder,
  insertOrderBookDepth,
  insertOrderBookTrades,
  insertTrade,
  ORDER_STATUS,
  OrderSide,
  TIME_INTERVALS,
  updateCandlestickBuckets,
  updateOrder,
  updateOrderStatusAndTimestamp,
  updatePoolVolume,
  upsertOrderBookDepth,
  upsertOrderBookDepthOnCancel,
  upsertOrderHistory,
} from "@/utils";
import { getDepth } from "@/utils/getDepth";
import { getPoolTradingPair } from "@/utils/getPoolTradingPair";
import { createLogger, safeStringify } from "@/utils/logger";
import { pushExecutionReport } from "@/utils/pushExecutionReport";
import { executeIfInSync, shouldEnableWebSocket } from "@/utils/syncState";
import { pushDepth, pushKline, pushMiniTicker, pushTrade } from "@/websocket/broadcaster";
import dotenv from "dotenv";
import { and, desc, eq, gte } from "ponder";
import {
  dailyBuckets,
  fiveMinuteBuckets,
  hourBuckets,
  minuteBuckets,
  orders,
  thirtyMinuteBuckets
} from "ponder:schema";

dotenv.config();

export async function handleOrderPlaced({ event, context }: any) {
  const shouldDebug = await shouldEnableWebSocket(Number(event.block.number), 'handleOrderPlaced');
  const logger = createLogger('orderBookHandler.ts', 'handleOrderPlaced');

  if (shouldDebug) {
    console.log(logger.log(event, '=== DEBUG START ==='));
  }

  try {
    if (shouldDebug) {
      console.log(`${logger.log(event, '1. Raw event data')}: ${safeStringify({
        eventType: 'OrderPlaced',
        blockNumber: event.block.number,
        blockHash: event.block.hash,
        txHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        contractAddress: event.log.address
      })}`);
    }

    const args = event.args as OrderPlacedEventArgs;
    if (shouldDebug) {
      console.log(`${logger.log(event, '2. Event args validation')}: ${safeStringify({
        args,
        hasOrderId: !!args.orderId,
        hasPrice: !!args.price,
        hasQuantity: !!args.quantity,
        hasSide: args.side !== undefined,
        hasStatus: args.status !== undefined
      })}`);
    }

    const db = context.db;
    const chainId = context.network.chainId;
    const txHash = event.transaction.hash;

    if (shouldDebug) {
      console.log(`${logger.log(event, '3. Context validation')}: ${safeStringify({
        hasDb: !!db,
        chainId,
        txHash,
        networkName: context.network.name
      })}`);
    }

    if (!db) throw new Error('Database context is null or undefined');
    if (!chainId) throw new Error('Chain ID is missing from context');
    if (!txHash) throw new Error('Transaction hash is missing');

    const filled = BigInt(0);
    const orderId = BigInt(args.orderId!);
    const poolAddress = event.log.address!;
    const price = BigInt(args.price);
    const quantity = BigInt(args.quantity);

    if (shouldDebug) {
      console.log(`${logger.log(event, '4. BigInt conversions')}: ${safeStringify({
        orderId: orderId.toString(),
        price: price.toString(),
        quantity: quantity.toString(),
        filled: filled.toString(),
        poolAddress
      })}`);
    }

    let side, status;
    try {
      side = getSide(args.side);
      if (shouldDebug) {
        console.log(`${logger.log(event, '5a. Side conversion successful')}: ${safeStringify({ rawSide: args.side, convertedSide: side })}`);
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '5a. Side conversion failed')}: ${safeStringify({ rawSide: args.side, error: (error as Error).message })}`);
      }
      throw new Error(`Failed to convert side: ${(error as Error).message}`);
    }

    try {
      status = ORDER_STATUS[Number(args.status)];
      if (shouldDebug) {
        console.log(`${logger.log(event, '5b. Status conversion successful')}: ${safeStringify({ rawStatus: args.status, convertedStatus: status })}`);
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '5b. Status conversion failed')}: ${safeStringify({ rawStatus: args.status, error: (error as Error).message })}`);
      }
      throw new Error(`Failed to convert status: ${(error as Error).message}`);
    }

    const timestamp = Number(event.block.timestamp);
    if (shouldDebug) {
      console.log(`${logger.log(event, '6. Timestamp conversion')}: ${safeStringify({ rawTimestamp: event.block.timestamp, convertedTimestamp: timestamp })}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '7. Creating order data...'));
    }
    let orderData;
    try {
      orderData = createOrderData(chainId, args, poolAddress, side, timestamp);
      if (shouldDebug) {
        console.log(`${logger.log(event, '8. Order data created successfully')}: ${safeStringify({ orderDataId: orderData.id })}`);
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '8. Order data creation failed')}:`, error);
      }
      throw new Error(`Failed to create order data: ${(error as Error).message}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '9. Inserting order into database...'));
    }
    try {
      await insertOrder(db, orderData);
      if (shouldDebug) {
        console.log(logger.log(event, '9. Order inserted successfully'));
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '9. Order insertion failed')}:`, error);
      }
      throw new Error(`Failed to insert order: ${(error as Error).message}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '10. Creating order history...'));
    }
    const historyId = createOrderHistoryId(chainId, txHash, filled, poolAddress, orderId.toString());
    const historyData = { id: historyId, chainId, orderId, poolId: poolAddress, timestamp, quantity, filled, status };
    if (shouldDebug) {
      console.log(`${logger.log(event, '10. History data created')}: ${safeStringify({ historyId, historyData })}`);
    }

    try {
      await upsertOrderHistory(db, historyData);
      if (shouldDebug) {
        console.log(logger.log(event, '10. Order history upserted successfully'));
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '10. Order history upsert failed')}:`, error);
      }
      throw new Error(`Failed to upsert order history: ${(error as Error).message}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '11. Creating order book depth...'));
    }
    const depthId = `${poolAddress}-${side.toLowerCase()}-${price.toString()}`;
    let depthData;
    try {
      depthData = createDepthData(chainId, depthId, poolAddress, side, price, quantity, timestamp);
      if (shouldDebug) {
        console.log(`${logger.log(event, '11. Depth data created')}: ${safeStringify({ depthId })}`);
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '11. Depth data creation failed')}:`, error);
      }
      throw new Error(`Failed to create depth data: ${(error as Error).message}`);
    }

    try {
      await insertOrderBookDepth(db, depthData);
      if (shouldDebug) {
        console.log(logger.log(event, '11. Order book depth inserted successfully'));
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '11. Order book depth insertion failed')}:`, error);
      }
      throw new Error(`Failed to insert order book depth: ${(error as Error).message}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '12. Starting executeIfInSync operation...'));
    }
    try {
      await executeIfInSync(Number(event.block.number), async () => {
        if (shouldDebug) {
          console.log(logger.log(event, '12a. Inside executeIfInSync callback'));
        }

        let symbol;
        try {
          if (shouldDebug) {
            console.log(`${logger.log(event, '12a1. Event log address debug')}: ${safeStringify({
              address: event.log.address,
              addressType: typeof event.log.address,
              isUndefined: event.log.address === undefined,
              isNull: event.log.address === null,
              addressLength: event.log.address?.length,
              eventLog: event.log
            })}`);
          }

          if (!event.log.address) {
            throw new Error(`Event log address is ${event.log.address} (${typeof event.log.address})`);
          }

          if (shouldDebug) {
            console.log(`${logger.log(event, '12a2. About to call getPoolTradingPair with')}: ${safeStringify({
              address: event.log.address,
              chainId: chainId,
              blockNumber: Number(event.block.number)
            })}`);
          }

          symbol = (await getPoolTradingPair(context, event.log.address, chainId, 'handleOrderPlaced', Number(event.block.number))).toUpperCase();
          if (shouldDebug) {
            console.log(`${logger.log(event, '12b. Trading pair retrieved')}: ${safeStringify({ symbol, poolAddress: event.log.address })}`);
          }
        } catch (error) {
          if (shouldDebug) {
            console.error(`${logger.log(event, '12b. Failed to get trading pair')}: ${safeStringify(error)}`);
          }
          throw new Error(`Failed to get trading pair: ${(error as Error).message}`);
        }

        const id = createOrderId(chainId, args.orderId, poolAddress);
        if (shouldDebug) {
          console.log(`${logger.log(event, '12c. Order ID created for lookup')}: ${safeStringify({ id })}`);
        }

        let order;
        try {
          order = await context.db.find(orders, { id: id });
          if (shouldDebug) {
            console.log(`${logger.log(event, '12d. Order found in database')}: ${safeStringify({ orderId: id, orderExists: !!order })}`);
          }
          if (!order) {
            throw new Error(`Order not found in database with id: ${id}`);
          }
        } catch (error) {
          if (shouldDebug) {
            console.error(`${logger.log(event, '12d. Failed to find order')}: ${safeStringify(error)}`);
          }
          throw new Error(`Failed to find order: ${(error as Error).message}`);
        }

        try {
          pushExecutionReport(symbol.toLowerCase(), order.user, order, "NEW", "NEW", BigInt(0), BigInt(0), timestamp * 1000);
          if (shouldDebug) {
            console.log(logger.log(event, '12e. Execution report pushed successfully'));
          }
        } catch (error) {
          if (shouldDebug) {
            console.error(`${logger.log(event, '12e. Failed to push execution report')}: ${safeStringify(error)}`);
          }
          throw new Error(`Failed to push execution report: ${(error as Error).message}`);
        }

        let latestDepth;
        try {
          latestDepth = await getDepth(event.log.address!, context.db, chainId);
          if (shouldDebug) {
            console.log(`${logger.log(event, '12f. Latest depth retrieved')}: ${safeStringify({
              bidsCount: latestDepth.bids?.length || 0,
              asksCount: latestDepth.asks?.length || 0
            })}`);
          }
        } catch (error) {
          if (shouldDebug) {
            console.error(`${logger.log(event, '12f. Failed to get depth')}: ${safeStringify(error)}`);
          }
          throw new Error(`Failed to get depth: ${(error as Error).message}`);
        }

        try {
          pushDepth(symbol.toLowerCase(), latestDepth.bids as any, latestDepth.asks as any);
          if (shouldDebug) {
            console.log(logger.log(event, '12g. Depth pushed successfully'));
          }
        } catch (error) {
          if (shouldDebug) {
            console.error(`${logger.log(event, '12g. Failed to push depth')}: ${safeStringify(error)}`);
          }
          throw new Error(`Failed to push depth: ${(error as Error).message}`);
        }

        if (shouldDebug) {
          console.log(logger.log(event, '12h. executeIfInSync callback completed successfully'));
        }
      }, 'handleOrderPlaced');
      if (shouldDebug) {
        console.log(logger.log(event, '12. executeIfInSync operation completed successfully'));
      }
    } catch (error) {
      if (shouldDebug) {
        console.error(`${logger.log(event, '12. executeIfInSync operation failed')}: ${safeStringify(error)}`);
      }
      throw new Error(`executeIfInSync failed: ${(error as Error).message}`);
    }

    if (shouldDebug) {
      console.log(logger.log(event, '13. ORDER PLACED EVENT DEBUG SUCCESS'));
    }

  } catch (error) {
    if (shouldDebug) {
      console.error(`${logger.log(event, 'ORDER PLACED EVENT DEBUG FAILED')}: ${safeStringify({
        message: (error as Error).message,
        stack: (error as Error).stack,
        name: (error as Error).name,
        eventContext: {
          blockNumber: event?.block?.number,
          txHash: event?.transaction?.hash,
          poolAddress: event?.log?.address,
          args: event?.args
        }
      })}`);
    }
    throw error;
  }
}

export async function handleOrderMatched({ event, context }: any) {
  const logger = createLogger('orderBookHandler.ts', 'handleOrderMatched');
  console.log(logger.log(event, '1. ======= ORDER MATCHED START ======='))
  console.log(logger.log(event, '2. Processing handleOrderMatched'))

  const args = event.args as OrderMatchedEventArgs;
  const db = context.db;
  const chainId = context.network.chainId;
  const txHash = event.transaction.hash;

  const poolAddress = event.log.address!;
  const poolId = createPoolId(chainId, poolAddress);
  const price = BigInt(args.executionPrice);
  const quantity = BigInt(args.executedQuantity);
  const timestamp = Number(args.timestamp);

  await updatePoolVolume(db, poolId, quantity, price, timestamp);

  const tradeId = createTradeId(chainId, txHash, args.user, getSide(args.side), args);
  await insertOrderBookTrades(db, chainId, tradeId, txHash, poolAddress, args);

  const buyTradeId = createTradeId(chainId, txHash, args.user, OrderSide.BUY, args);
  const buyOrderId = createOrderId(chainId, BigInt(args.buyOrderId), poolAddress);
  await insertTrade(db, chainId, buyTradeId, buyOrderId, price, quantity, event);
  await updateOrder(db, chainId, buyOrderId, quantity);

  const sellTradeId = createTradeId(chainId, txHash, args.user, OrderSide.SELL, args);
  const sellOrderId = createOrderId(chainId, BigInt(args.sellOrderId), poolAddress);
  await insertTrade(db, chainId, sellTradeId, sellOrderId, price, quantity, event);
  await updateOrder(db, chainId, sellOrderId, quantity);

  await upsertOrderBookDepth(db, chainId, poolAddress, getSide(args.side), price, quantity, timestamp);
  await upsertOrderBookDepth(db, chainId, poolAddress, getOppositeSide(args.side), price, quantity, timestamp);

  await updateCandlestickBuckets(db, chainId, poolId, price, quantity, event, args);

  await executeIfInSync(Number(event.block.number), async () => {
    console.log(logger.log(event, '3. Starting executeIfInSync operation'))
    const symbol = (await getPoolTradingPair(context, event.log.address!, chainId, 'handleOrderMatched')).toUpperCase();
    const symbolLower = symbol.toLowerCase();
    const txHash = event.transaction.hash;
    const price = event.args.executionPrice.toString();
    const quantity = event.args.executedQuantity.toString();
    const isBuyerMaker = !!event.args.side;
    const tradeTime = timestamp * 1000;

    const buyRow = await context.db.find(orders, {
      id: buyOrderId
    });

    const sellRowById = await context.db.find(orders, {
      id: sellOrderId
    });

    pushTrade(symbolLower, txHash, price, quantity, isBuyerMaker, tradeTime);

    if (buyRow) pushExecutionReport(symbol.toLowerCase(), buyRow.user, buyRow, "TRADE", buyRow.status, BigInt(event.args.executedQuantity), BigInt(event.args.executionPrice), timestamp * 1000);
    if (sellRowById) pushExecutionReport(symbol.toLowerCase(), sellRowById.user, sellRowById, "TRADE", sellRowById.status, BigInt(event.args.executedQuantity), BigInt(event.args.executionPrice), timestamp * 1000);

    const latestDepth = await getDepth(event.log.address!,  context.db, chainId);
    pushDepth(symbol.toLowerCase(), latestDepth.bids as any, latestDepth.asks as any);

    const timeIntervals = [
      { table: minuteBuckets, interval: '1m', seconds: TIME_INTERVALS.minute },
      { table: fiveMinuteBuckets, interval: '5m', seconds: TIME_INTERVALS.fiveMinutes },
      { table: thirtyMinuteBuckets, interval: '30m', seconds: TIME_INTERVALS.thirtyMinutes },
      { table: hourBuckets, interval: '1h', seconds: TIME_INTERVALS.hour }
    ];

    const currentTimestamp = Number(event.block.timestamp);

    for (const { table, interval, seconds } of timeIntervals) {
      const openTime = Math.floor(currentTimestamp / seconds) * seconds;

      const klineData = await context.db.sql
        .select()
        .from(table)
        .where(
          and(
            eq(table.poolId, event.log.address!),
            eq(table.openTime, openTime)
          )
        )
        .execute();

      if (klineData.length > 0) {
        const kline = klineData[0];
        const klinePayload = {
          t: kline.openTime * 1000,
          T: kline.closeTime * 1000,
          s: symbol.toUpperCase(),
          i: interval,
          o: kline.open.toString(),
          c: kline.close.toString(),
          h: kline.high.toString(),
          l: kline.low.toString(),
          v: kline.volume.toString(),
          n: kline.count,
          x: false,
          q: kline.quoteVolume.toString(),
          V: kline.takerBuyBaseVolume.toString(),
          Q: kline.takerBuyQuoteVolume.toString()
        };

        pushKline(symbol.toLowerCase(), interval, klinePayload);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    const dailyStats = await context.db.sql
      .select()
      .from(dailyBuckets)
      .where(
        and(
          eq(dailyBuckets.poolId, event.log.address!),
          gte(dailyBuckets.openTime, oneDayAgo)
        )
      )
      .orderBy(desc(dailyBuckets.openTime))
      .limit(1)
      .execute();

    const closePrice = event.args.executionPrice.toString();
    const highPrice = dailyStats.length > 0 ? dailyStats[0].high.toString() : closePrice;
    const lowPrice = dailyStats.length > 0 ? dailyStats[0].low.toString() : closePrice;
    const volume = dailyStats.length > 0 ? dailyStats[0].quoteVolume.toString() : (BigInt(event.args.executedQuantity) * BigInt(event.args.executionPrice)).toString();

    pushMiniTicker(
      symbol.toLowerCase(),
      closePrice,
      highPrice,
      lowPrice,
      volume
    );

    console.log(logger.log(event, '4. Websocket operations completed'))
    console.log(logger.log(event, '5. ======= ORDER MATCHED END ======='))
  }, 'handleOrderMatched');
}

export async function handleOrderCancelled({ event, context }: any) {
  const logger = createLogger('orderBookHandler.ts', 'handleOrderCancelled');
  console.log(logger.log(event, '1. Starting OrderCancelled processing'));
  
  const db = context.db;
  const chainId = context.network.chainId;

  const hashedOrderId = createOrderId(chainId, BigInt(event.args.orderId!), event.log.address!);
  const timestamp = Number(event.args.timestamp);

  await updateOrderStatusAndTimestamp(db, chainId, hashedOrderId, event, timestamp);

  await upsertOrderBookDepthOnCancel(db, chainId, hashedOrderId, event, timestamp);

  await executeIfInSync(Number(event.block.number), async () => {
    const symbol = (await getPoolTradingPair(context, event.log.address!, chainId, 'handleOrderCancelled')).toUpperCase();
    const row = await context.db.find(orders, { id: hashedOrderId });

    if (!row) return;

    pushExecutionReport(symbol.toLowerCase(), row.user, row, "CANCELED", "CANCELED", BigInt(0), BigInt(0), timestamp);
    const latestDepth = await getDepth(event.log.address!, context.db, chainId);
    pushDepth(symbol.toLowerCase(), latestDepth.bids as any, latestDepth.asks as any);
  }, 'handleOrderCancelled');
}

export async function handleUpdateOrder({ event, context }: any) {
  const logger = createLogger('orderBookHandler.ts', 'handleUpdateOrder');
  const db = context.db;
  const chainId = context.network.chainId;

  console.log(logger.log(event, '1. Starting UpdateOrder processing'));
  
  // Validate required event args exist
  if (event.args.orderId === undefined || event.args.filled === undefined || event.args.status === undefined || event.args.timestamp === undefined) {
    console.error(`${logger.log(event, '2. UpdateOrder event missing required arguments')}: ${safeStringify(event.args)}`);
    return;
  }

  // Validate log address exists
  if (!event.log.address) {
    console.error(`${logger.log(event, '2. UpdateOrder event missing log address')}: ${safeStringify(event.log)}`);
    return;
  }

  const filled = BigInt(event.args.filled);
  const orderId = BigInt(event.args.orderId);
  const poolAddress = event.log.address;
  const status = ORDER_STATUS[Number(event.args.status)];
  const timestamp = Number(event.args.timestamp);

  console.log(`${logger.log(event, '3. UpdateOrder processing data')}: ${safeStringify({
    orderId: orderId.toString(),
    poolAddress,
    status,
    filled: filled.toString(),
    timestamp,
    poolAddressType: typeof poolAddress,
    statusType: typeof status
  })}`);

  const hashedOrderId = createOrderId(chainId, orderId, poolAddress);
  const orderHistoryId = createOrderHistoryId(chainId, event.transaction.hash, filled, poolAddress, orderId.toString());

  const historyData = {
    id: orderHistoryId,
    chainId,
    orderId: orderId.toString(),
    poolId: poolAddress,
    timestamp,
    filled,
    status,
  };
  await upsertOrderHistory(db, historyData);

  await updateOrderStatusAndTimestamp(db, chainId, hashedOrderId, event, timestamp);

  const isExpired = ORDER_STATUS[5];

  if (event.args.status == isExpired) {
    const order = await db.find(orders, { id: hashedOrderId });
    if (order && order.side) {
      console.log(`${logger.log(event, '4. UpdateOrder expiry processing')}: ${safeStringify({
        orderId: hashedOrderId,
        orderSide: order.side,
        orderSideType: typeof order.side,
        orderSideLength: order.side?.length
      })}`);
      const price = BigInt(order.price);
      await upsertOrderBookDepth(
        db,
        chainId,
        poolAddress,
        order.side,
        price,
        BigInt(order.quantity),
        timestamp,
        false
      );
    }
  }
  await executeIfInSync(Number(event.block.number), async () => {
    const symbol = (await getPoolTradingPair(context, event.log.address!, chainId, 'handleUpdateOrder')).toUpperCase();
    const row = await context.db.find(orders, { id: hashedOrderId });

    if (!row) return;

    pushExecutionReport(symbol.toLowerCase(), row.user, row, "TRADE", row.status, BigInt(event.args.filled), row.price, timestamp * 1000);
    const latestDepth = await getDepth(event.log.address!,  context.db, chainId);
    pushDepth(symbol.toLowerCase(), latestDepth.bids as any, latestDepth.asks as any);
  }, 'handleUpdateOrder');
}