import { ponder } from "ponder:registry";
import * as orderBookHandler from "../handlers/orderBookHandler";
import * as poolManagerHandler from "../handlers/poolManagerHandler";
import * as balanceManagerHandler from "../handlers/balanceManagerHandler";
import * as crossChainHandler from "../handlers/crossChainHandler";
import * as tokenRegistryHandler from "../handlers/tokenRegistryHandler";
import { PonderEvents } from "../types/ponder-core-chain";

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

// Hyperlane Mailbox Events (cross-chain message processing)
ponder.on(PonderEvents.HYPERLANEMAILBOX_DISPATCH_ID, crossChainHandler.handleHyperlaneMailboxDispatchId);
ponder.on(PonderEvents.HYPERLANEMAILBOX_PROCESS_ID, crossChainHandler.handleHyperlaneMailboxProcessId);

// TokenRegistry Events (cross-chain token mapping)
ponder.on(PonderEvents.TOKEN_MAPPING_REGISTERED, tokenRegistryHandler.handleTokenMappingRegistered);
ponder.on(PonderEvents.TOKEN_MAPPING_UPDATED, tokenRegistryHandler.handleTokenMappingUpdated);
ponder.on(PonderEvents.TOKEN_MAPPING_REMOVED, tokenRegistryHandler.handleTokenMappingRemoved);
ponder.on(PonderEvents.TOKEN_STATUS_CHANGED, tokenRegistryHandler.handleTokenStatusChanged);
ponder.on(PonderEvents.TOKEN_OWNERSHIP_TRANSFERRED, tokenRegistryHandler.handleOwnershipTransferred);
ponder.on(PonderEvents.TOKEN_INITIALIZED, tokenRegistryHandler.handleInitialized);

console.log("✅ Core Chain indexer initialized - Chain ID: 31337");
console.log("📊 Monitoring: OrderBook, PoolManager, Hyperlane cross-chain events, TokenRegistry mappings");