import { ponder } from "ponder:registry";
import { 
  chainBalanceDeposits, 
  chainBalanceWithdrawals, 
  chainBalanceUnlocks,
  chainBalanceTokenWhitelist,
  chainBalanceStates
} from "../../ponder.schema";

// Deposit event handler
ponder.on("ChainBalanceManager:Deposit", async ({ event, context }) => {
  const { user, token, amount } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  // Store deposit record
  await context.db.insert(chainBalanceDeposits).values({
    id,
    chainId: Number(chainId),
    user: user.toLowerCase(),
    token: token.toLowerCase(),
    amount: amount,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
  });

  // Update or create balance state
  const stateId = `${chainId}-${user.toLowerCase()}-${token.toLowerCase()}`;
  
  try {
    // Try to get existing state
    const existingState = await context.db
      .select()
      .from(chainBalanceStates)
      .where(({ id: stateId_ }) => stateId_.equals(stateId))
      .limit(1);

    if (existingState.length > 0) {
      // Update existing state
      await context.db
        .update(chainBalanceStates, { id: stateId })
        .set({
          balance: existingState[0].balance + amount,
          lastUpdated: Number(block.timestamp),
        });
    } else {
      // Create new state
      await context.db.insert(chainBalanceStates).values({
        id: stateId,
        chainId: Number(chainId),
        user: user.toLowerCase(),
        token: token.toLowerCase(),
        balance: amount,
        unlockedBalance: 0n,
        lastUpdated: Number(block.timestamp),
      });
    }
  } catch (error) {
    console.error(`Error updating balance state for deposit: ${error}`);
  }
});

// Traditional withdraw event handler
ponder.on("ChainBalanceManager:Withdraw", async ({ event, context }) => {
  const { user, token, amount } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  // Store withdrawal record
  await context.db.insert(chainBalanceWithdrawals).values({
    id,
    chainId: Number(chainId),
    user: user.toLowerCase(),
    token: token.toLowerCase(),
    amount: amount,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
    withdrawalType: 'withdraw', // Traditional seamless withdrawal
  });

  // Update balance state
  const stateId = `${chainId}-${user.toLowerCase()}-${token.toLowerCase()}`;
  
  try {
    const existingState = await context.db
      .select()
      .from(chainBalanceStates)
      .where(({ id: stateId_ }) => stateId_.equals(stateId))
      .limit(1);

    if (existingState.length > 0) {
      await context.db
        .update(chainBalanceStates, { id: stateId })
        .set({
          balance: existingState[0].balance - amount,
          lastUpdated: Number(block.timestamp),
        });
    }
  } catch (error) {
    console.error(`Error updating balance state for withdraw: ${error}`);
  }
});

// Unlock event handler
ponder.on("ChainBalanceManager:Unlock", async ({ event, context }) => {
  const { user, token, amount } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  // Store unlock record
  await context.db.insert(chainBalanceUnlocks).values({
    id,
    chainId: Number(chainId),
    user: user.toLowerCase(),
    token: token.toLowerCase(),
    amount: amount,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
  });

  // Update balance state (move from balance to unlockedBalance)
  const stateId = `${chainId}-${user.toLowerCase()}-${token.toLowerCase()}`;
  
  try {
    const existingState = await context.db
      .select()
      .from(chainBalanceStates)
      .where(({ id: stateId_ }) => stateId_.equals(stateId))
      .limit(1);

    if (existingState.length > 0) {
      await context.db
        .update(chainBalanceStates, { id: stateId })
        .set({
          balance: existingState[0].balance - amount,
          unlockedBalance: existingState[0].unlockedBalance + amount,
          lastUpdated: Number(block.timestamp),
        });
    }
  } catch (error) {
    console.error(`Error updating balance state for unlock: ${error}`);
  }
});

// Claim event handler
ponder.on("ChainBalanceManager:Claim", async ({ event, context }) => {
  const { user, token, amount } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  // Store claim record as a withdrawal
  await context.db.insert(chainBalanceWithdrawals).values({
    id,
    chainId: Number(chainId),
    user: user.toLowerCase(),
    token: token.toLowerCase(),
    amount: amount,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
    withdrawalType: 'claim', // User-initiated claim
  });

  // Update balance state (reduce unlockedBalance)
  const stateId = `${chainId}-${user.toLowerCase()}-${token.toLowerCase()}`;
  
  try {
    const existingState = await context.db
      .select()
      .from(chainBalanceStates)
      .where(({ id: stateId_ }) => stateId_.equals(stateId))
      .limit(1);

    if (existingState.length > 0) {
      await context.db
        .update(chainBalanceStates, { id: stateId })
        .set({
          unlockedBalance: existingState[0].unlockedBalance - amount,
          lastUpdated: Number(block.timestamp),
        });
    }
  } catch (error) {
    console.error(`Error updating balance state for claim: ${error}`);
  }
});

// Token whitelist events
ponder.on("ChainBalanceManager:TokenWhitelisted", async ({ event, context }) => {
  const { token } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  await context.db.insert(chainBalanceTokenWhitelist).values({
    id,
    chainId: Number(chainId),
    token: token.toLowerCase(),
    isWhitelisted: true,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
    action: 'added',
  });
});

ponder.on("ChainBalanceManager:TokenRemoved", async ({ event, context }) => {
  const { token } = event.args;
  const { chainId, block, transaction } = context;

  const id = `${chainId}-${transaction.hash}-${event.logIndex}`;

  await context.db.insert(chainBalanceTokenWhitelist).values({
    id,
    chainId: Number(chainId),
    token: token.toLowerCase(),
    isWhitelisted: false,
    timestamp: Number(block.timestamp),
    transactionId: transaction.hash,
    blockNumber: block.number.toString(),
    action: 'removed',
  });
});

// Owner transfer events (for governance tracking)
ponder.on("ChainBalanceManager:OwnershipTransferred", async ({ event, context }) => {
  const { previousOwner, newOwner } = event.args;
  const { chainId, block, transaction } = context;

  console.log(`ChainBalanceManager ownership transferred on chain ${chainId}: ${previousOwner} -> ${newOwner} at block ${block.number}`);
});

// Initialization event
ponder.on("ChainBalanceManager:Initialized", async ({ event, context }) => {
  const { version } = event.args;
  const { chainId, block, transaction } = context;

  console.log(`ChainBalanceManager initialized on chain ${chainId} with version ${version} at block ${block.number}`);
});