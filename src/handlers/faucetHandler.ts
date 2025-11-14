import { faucetDeposits, faucetRequests, faucetTokens } from "../../ponder.schema";
import { ERC20ABI } from "../../abis/ERC20";
import { getAddress } from "viem";

async function fetchTokenData(client: any, address: string) {
  try {
    const [symbol, name, decimals] = await client.multicall({
      contracts: [
        { address, abi: ERC20ABI, functionName: "symbol" },
        { address, abi: ERC20ABI, functionName: "name" },
        { address, abi: ERC20ABI, functionName: "decimals" },
      ],
    });

    return {
      symbol: symbol.status === "success" ? symbol.result : "",
      name: name.status === "success" ? name.result : "",
      decimals: decimals.status === "success" ? decimals.result : 18,
    };
  } catch {
    return {
      symbol: await safeReadContract(client, address, "symbol"),
      name: await safeReadContract(client, address, "name"),
      decimals: (await safeReadContract(client, address, "decimals")) || 18,
    };
  }
}

async function safeReadContract(client: any, address: string, functionName: string) {
  try {
    return await client.readContract({ address, abi: ERC20ABI, functionName });
  } catch (e) {
    console.error(`Failed to get ${functionName} for ${address}:`, e);
    return functionName === "decimals" ? 18 : "";
  }
}

export async function handleRequestToken({ event, context }: any) {
  const chainId = Number(context.network.chainId);

  await context.db.insert(faucetRequests).values({
    id: `${chainId}-${event.transaction.hash}-${event.logIndex}`,
    chainId,
    requester: event.args.requester,
    receiver: event.args.receiver,
    token: event.args.token,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    blockNumber: event.block.number,
    transactionId: event.transaction.hash,
  });
}

export async function handleDepositToken({ event, context }: any) {
  const chainId = Number(context.network.chainId);

  await context.db.insert(faucetDeposits).values({
    id: `${chainId}-${event.transaction.hash}-${event.logIndex}`,
    chainId,
    depositor: event.args.depositor,
    token: event.args.token,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    blockNumber: event.block.number,
    transactionId: event.transaction.hash,
  });
}

export async function handleAddToken({ event, context }: any) {
  const chainId = Number(context.network.chainId);
  const { client } = context;

  if (!client) throw new Error('Client context is null or undefined');
  if (!event.args.token) throw new Error('Missing token address in event args');

  const tokenAddress = getAddress(event.args.token);

  // Fetch token symbol, name and decimals with enhanced error handling
  let tokenData;
  try {
    tokenData = await fetchTokenData(client, tokenAddress);
  } catch (error) {
    // Fallback to empty token data if fetching fails
    tokenData = {
      symbol: "",
      name: "",
      decimals: 18
    };
  }

  await context.db.insert(faucetTokens).values({
    id: `${chainId}-${event.transaction.hash}-${event.logIndex}`,
    chainId,
    token: tokenAddress,
    symbol: tokenData.symbol,
    decimals: tokenData.decimals,
    timestamp: Number(event.block.timestamp),
    blockNumber: event.block.number,
    transactionId: event.transaction.hash,
  });
}
