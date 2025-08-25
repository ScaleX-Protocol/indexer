// base-ponder.config.ts
import { factory, loadBalance, rateLimit } from "ponder";
import { getAddress, http, parseAbiItem } from "viem";
import { BalanceManagerABI } from "./abis/BalanceManager";
import { GTXRouterABI } from "./abis/GTXRouter";
import { OrderBookABI } from "./abis/OrderBook";
import { PoolManagerABI } from "./abis/PoolManager";
import {FaucetABI} from "./abis/FaucetABI";
import dotenv from "dotenv";

dotenv.config();

const default_address = getAddress("0x0000000000000000000000000000000000000000");

const contracts: any = {
	OrderBook: {
		abi: OrderBookABI,
		network: "network",
		address: factory({
			address: getAddress(process.env.POOLMANAGER_CONTRACT_ADDRESS as `0x${string}`) || default_address,
			event: parseAbiItem(
				"event PoolCreated(bytes32 indexed poolId, address orderBook, address baseCurrency, address quoteCurrency)"
			),
			parameter: "orderBook",
		}),
		startBlock: process.env.START_BLOCK as number | undefined,
	},
	PoolManager: {
		abi: PoolManagerABI || [],
		network: "network",
		address: getAddress((process.env.POOLMANAGER_CONTRACT_ADDRESS as `0x${string}`) || default_address),
		startBlock: Number(process.env.START_BLOCK) || undefined,
	},
	BalanceManager: {
		abi: BalanceManagerABI || [],
		network: "network",
		address: getAddress((process.env.BALANCEMANAGER_CONTRACT_ADDRESS as `0x${string}`) || default_address),
		startBlock: Number(process.env.START_BLOCK) || undefined,
	},
	GTXRouter: {
		abi: GTXRouterABI || [],
		network: "network",
		address: getAddress((process.env.GTXROUTER_CONTRACT_ADDRESS as `0x${string}`) || default_address),
		startBlock: Number(process.env.START_BLOCK) || undefined,
	},
    Faucet: {
        abi: FaucetABI || [],
        network: "faucet-network",
        address: getAddress((process.env.FAUCET_CONTRACT_ADDRESS as `0x${string}`) || default_address),
        startBlock: Number(process.env.FAUCET_START_BLOCK) || Number(process.env.START_BLOCK) || undefined,
		endBlock: process.env.FAUCET_END_BLOCK || process.env.END_BLOCK as number | undefined,
    },
};

export function getBaseConfig() {
	return {
		networks: {
			network: {
				chainId: Number(process.env.CHAIN_ID),
				transport: http(process.env.PONDER_RPC_URL),
				pollingInterval: Number(process.env.POLLING_INTERVAL) || 100,
				maxRequestsPerSecond: Number(process.env.MAX_REQUESTS_PER_SECOND) || 250,
			},
			"faucet-network": {
				chainId: Number(process.env.FAUCET_CHAIN_ID) || Number(process.env.CHAIN_ID) || 4661,
				transport: http(process.env.FAUCET_RPC_URL || process.env.PONDER_RPC_URL || '/api/rpc/appchain-testnet'),
				pollingInterval: Number(process.env.FAUCET_POLLING_INTERVAL) || Number(process.env.POLLING_INTERVAL) || 100,
				maxRequestsPerSecond: Number(process.env.FAUCET_MAX_REQUESTS_PER_SECOND) || Number(process.env.MAX_REQUESTS_PER_SECOND) || 250,
			},
		},
		contracts: contracts,
	};
}
