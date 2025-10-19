import { ponder } from "ponder:registry";
import * as orderBookHandler from "./handlers/orderBookHandler";
import * as poolManagerHandler from "./handlers/poolManagerHandler";
import * as balanceManagerHandler from "./handlers/balanceManagerHandler";
import { PonderEvents } from "./types/ponder-core-chain";

// Pool Manager Events
ponder.on(PonderEvents.POOL_CREATED, poolManagerHandler.handlePoolCreated);

// Balance Manager Events
ponder.on(PonderEvents.DEPOSIT, balanceManagerHandler.handleDeposit);
ponder.on(PonderEvents.WITHDRAWAL, balanceManagerHandler.handleWithdrawal);
ponder.on(PonderEvents.TRANSFER_FROM, balanceManagerHandler.handleTransferFrom);
ponder.on(PonderEvents.TRANSFER_LOCKED_FROM, balanceManagerHandler.handleTransferLockedFrom);
ponder.on(PonderEvents.LOCK, balanceManagerHandler.handleLock);
ponder.on(PonderEvents.UNLOCK, balanceManagerHandler.handleUnlock);

// Order Book Events
ponder.on(PonderEvents.ORDER_PLACED, orderBookHandler.handleOrderPlaced);
ponder.on(PonderEvents.ORDER_MATCHED, orderBookHandler.handleOrderMatched);
ponder.on(PonderEvents.ORDER_CANCELLED, orderBookHandler.handleOrderCancelled);
ponder.on(PonderEvents.UPDATE_ORDER, orderBookHandler.handleUpdateOrder);

console.log("✅ Core Chain indexer initialized - Chain ID: 31337");
console.log("📊 Monitoring: OrderBook, PoolManager events only");