import { orders } from "../../ponder.schema";
import {eq, and, or, desc } from "ponder";

export async function getDepth(pool: `0x${string}`, db: any, limit: number) {
    // Bids: Buy, OPEN or PARTIALLY_FILLED, price desc
    const bids = await db
        .sql
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.poolId, pool),
                eq(orders.side, "Buy"),
                or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED"))
            )
        )
        .orderBy(desc(orders.price))
        .limit(limit)
        .execute();

    // Asks: Sell, OPEN or PARTIALLY_FILLED, price asc
    const asks = await db
        .sql
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.poolId, pool),
                eq(orders.side, "Sell"),
                or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED"))
            )
        )
        .orderBy(orders.price)
        .limit(limit)
        .execute();

    return {
        bids: bids.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()]),
        asks: asks.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()])
    };
}