import { ponder } from "ponder:registry";
import * as orderBookHandler from "./handlers/orderBookHandler";
import * as balanceManagerHandler from "./handlers/balanceManagerHandler";
import * as poolManagerHandler from "./handlers/poolManagerHandler";
import * as faucetHandler from "./handlers/faucetHandler";
import { PonderEvents } from "./types/ponder";

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

// Faucet Events
ponder.on(PonderEvents.ADD_TOKEN, faucetHandler.handleAddToken);
ponder.on(PonderEvents.REQUEST_TOKEN, faucetHandler.handleRequestToken);
ponder.on(PonderEvents.DEPOSIT_TOKEN, faucetHandler.handleDepositToken);
