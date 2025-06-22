import { and, desc, eq, or } from "ponder";
import { orders } from "../../ponder.schema";
import { DepthManager } from "./depthManager";

export async function getDepth(pool: `0x${string}`, ctx: any, chainId: number) {
    try {
        return await DepthManager.getCurrentDepth(ctx, pool, chainId);
    } catch (error) {
        const bids = await ctx.db.sql.select().from(orders).where(and(eq(orders.poolId, pool), eq(orders.side, "Buy"), or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED")))).orderBy(desc(orders.price)).limit(50).execute();
        const asks = await ctx.db.sql.select().from(orders).where(and(eq(orders.poolId, pool), eq(orders.side, "Sell"), or(eq(orders.status, "OPEN"), eq(orders.status, "PARTIALLY_FILLED")))).orderBy(orders.price).limit(50).execute();
        return {
            bids: bids.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()]),
            asks: asks.map((o: any) => [o.price.toString(), (o.quantity - o.filled).toString()])
        };
    }
}