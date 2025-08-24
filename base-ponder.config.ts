// base-ponder.config.ts
import { ChainBalanceManagerABI } from "abis";
import dotenv from "dotenv";
import { factory } from "ponder";
import { fallback, getAddress, http, parseAbiItem } from "viem";
import { BalanceManagerABI } from "./abis/BalanceManager";
import { FaucetABI } from "./abis/Faucet";
import { GTXRouterABI } from "./abis/GTXRouter";
import { MailboxABI } from "./abis/Mailbox";
import { OrderBookABI } from "./abis/OrderBook";
import { PoolManagerABI } from "./abis/PoolManager";

dotenv.config();

const default_address = getAddress("0x0000000000000000000000000000000000000000");

const contracts: any = {
	// BalanceManager exists on Rari (destination)
	BalanceManager: {
		abi: BalanceManagerABI || [],
		network: {
			rariTestnet: {
				address: getAddress((process.env.BALANCEMANAGER_CONTRACT_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
		},
	},
	// ChainBalanceManager exists on source chains
	ChainBalanceManager: {
		abi: ChainBalanceManagerABI || [], // Assuming similar ABI
		network: {
			appchainTestnet: {
				address: getAddress((process.env.CHAIN_BALANCE_MANAGER_APPCHAIN_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.APPCHAIN_START_BLOCK) || undefined,
			},
			risesSpolia: {
				address: getAddress((process.env.CHAIN_BALANCE_MANAGER_RISE_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RISE_START_BLOCK) || undefined,
			},
			arbitrumSepolia: {
				address: getAddress((process.env.CHAIN_BALANCE_MANAGER_ARBITRUM_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_START_BLOCK) || undefined,
			},
		},
	},
	// HyperlaneMailbox exists on all chains (source + destination)
	HyperlaneMailbox: {
		abi: MailboxABI || [],
		network: {
			rariTestnet: {
				address: getAddress((process.env.MAILBOX_RARI_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
			appchainTestnet: {
				address: getAddress((process.env.MAILBOX_APPCHAIN_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.APPCHAIN_START_BLOCK) || undefined,
				endBlock: Number(process.env.APPCHAIN_END_BLOCK) || undefined,
			},
			risesSpolia: {
				address: getAddress((process.env.MAILBOX_RISE_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RISE_START_BLOCK) || undefined,
				endBlock: Number(process.env.RISE_END_BLOCK) || undefined,
			},
			arbitrumSepolia: {
				address: getAddress((process.env.MAILBOX_ARBITRUM_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_START_BLOCK) || undefined,
				endBlock: Number(process.env.ARBITRUM_END_BLOCK) || undefined,
			},
		},
	},
	// PoolManager exists on Rari
	PoolManager: {
		abi: PoolManagerABI || [],
		network: {
			rariTestnet: {
				address: getAddress((process.env.POOLMANAGER_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
		},
	},
	// OrderBook exists on Rari (using factory pattern)
	OrderBook: {
		abi: OrderBookABI,
		network: {
			rariTestnet: {
				address: factory({
					address: getAddress((process.env.POOLMANAGER_ADDRESS as `0x${string}`) || default_address),
					event: parseAbiItem(
						"event PoolCreated(bytes32 indexed poolId, address orderBook, address baseCurrency, address quoteCurrency)"
					),
					parameter: "orderBook",
				}),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
		},
	},
	// GTXRouter exists on Rari
	GTXRouter: {
		abi: GTXRouterABI || [],
		network: {
			rariTestnet: {
				address: getAddress((process.env.GTXROUTER_CONTRACT_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
		},
	},
	// Faucet exists on Appchain and Arbitrum Sepolia
	Faucet: {
		abi: FaucetABI || [],
		network: {
			appchainTestnet: {
				address: getAddress((process.env.FAUCET_APPCHAIN_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.APPCHAIN_START_BLOCK) || undefined,
				endBlock: Number(process.env.APPCHAIN_END_BLOCK) || undefined,
			},
			arbitrumSepolia: {
				address: getAddress((process.env.FAUCET_ARBITRUM_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_START_BLOCK) || undefined,
				endBlock: Number(process.env.ARBITRUM_END_BLOCK) || undefined,
			},
		},
	},
};

export function getBaseConfig() {
	const config = {
		networks: {
			// Rari Testnet (Destination/Host Chain)
			rariTestnet: {
				chainId: 1918988905,
				transport: http(process.env.RARI_TESTNET_ENDPOINT),
				pollingInterval: Number(process.env.POLLING_INTERVAL) || 100,
				maxRequestsPerSecond: Number(process.env.MAX_REQUESTS_PER_SECOND) || 250,
			},
			// Appchain Testnet (Source Chain)
			appchainTestnet: {
				chainId: 4661,
				transport: http(process.env.APPCHAIN_TESTNET_ENDPOINT),
				pollingInterval: Number(process.env.POLLING_INTERVAL) || 100,
				maxRequestsPerSecond: Number(process.env.MAX_REQUESTS_PER_SECOND) || 250,
			},
			// Rise Sepolia (Source Chain)
			risesSpolia: {
				chainId: 11155931,
				transport: http(process.env.RISE_SEPOLIA_ENDPOINT),
				pollingInterval: Number(process.env.POLLING_INTERVAL) || 100,
				maxRequestsPerSecond: Number(process.env.MAX_REQUESTS_PER_SECOND) || 250,
			},
			// Arbitrum Sepolia (Source Chain)
			arbitrumSepolia: {
				chainId: 421614,
				transport: fallback([
					http(process.env.ARBITRUM_SEPOLIA_ENDPOINT),
				]),
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

	return config;
}
