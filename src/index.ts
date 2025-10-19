import { ponder } from "ponder:registry";
import * as crossChainHandler from "./handlers/crossChainHandler";
import * as chainBalanceManagerHandler from "./handlers/chainBalanceManagerHandler";
import * as faucetHandler from "./handlers/faucetHandler";
import { PonderEvents } from "./types/ponder-side-chain";

// Chain Balance Manager Events - PRIMARY SIDE CHAIN FUNCTIONALITY
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_DEPOSIT, chainBalanceManagerHandler.handleDeposit);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_WITHDRAW, chainBalanceManagerHandler.handleWithdraw);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_UNLOCK, chainBalanceManagerHandler.handleUnlock);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_CLAIM, chainBalanceManagerHandler.handleClaim);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_TOKEN_WHITELISTED, chainBalanceManagerHandler.handleTokenWhitelisted);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_TOKEN_REMOVED, chainBalanceManagerHandler.handleTokenRemoved);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_OWNERSHIP_TRANSFERRED, chainBalanceManagerHandler.handleOwnershipTransferred);
ponder.on(PonderEvents.CHAIN_BALANCE_MANAGER_INITIALIZED, chainBalanceManagerHandler.handleInitialized);

// Cross-Chain Events - Hyperlane messaging for side chain
ponder.on(PonderEvents.HYPERLANE_MAILBOX_DISPATCH_ID, crossChainHandler.handleHyperlaneMailboxDispatchId);
ponder.on(PonderEvents.HYPERLANE_MAILBOX_PROCESS_ID, crossChainHandler.handleHyperlaneMailboxProcessId);

// Faucet Events - Side chain faucet functionality
ponder.on(PonderEvents.ADD_TOKEN, faucetHandler.handleAddToken);
ponder.on(PonderEvents.REQUEST_TOKEN, faucetHandler.handleRequestToken);
ponder.on(PonderEvents.DEPOSIT_TOKEN, faucetHandler.handleDepositToken);

console.log("✅ Side Chain indexer initialized - Chain ID: 31338");
console.log("🔗 Monitoring: ChainBalanceManager, Hyperlane cross-chain events, Faucet events");