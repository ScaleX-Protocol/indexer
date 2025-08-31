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
				address: getAddress((process.env.BALANCEMANAGER_CONTRACT_RARI_ADDRESS as `0x${string}`) || default_address),
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
			// risesSpolia: {
			// 	address: getAddress((process.env.CHAIN_BALANCE_MANAGER_RISE_ADDRESS as `0x${string}`) || default_address),
			// 	startBlock: Number(process.env.RISE_START_BLOCK) || undefined,
			// },
			arbitrumSepolia: {
				address: getAddress((process.env.CHAIN_BALANCE_MANAGER_ARBITRUM_SEPOLIA_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_SEPOLIA_START_BLOCK) || undefined,
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
			// risesSpolia: {
			// 	address: getAddress((process.env.MAILBOX_RISE_ADDRESS as `0x${string}`) || default_address),
			// 	startBlock: Number(process.env.RISE_START_BLOCK) || undefined,
			// 	endBlock: Number(process.env.RISE_END_BLOCK) || undefined,
			// },
			arbitrumSepolia: {
				address: getAddress((process.env.MAILBOX_ARBITRUM_SEPOLIA_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_SEPOLIA_START_BLOCK) || undefined,
				endBlock: Number(process.env.ARBITRUM_SEPOLIA_END_BLOCK) || undefined,
			},
		},
	},
	// PoolManager exists on Rari
	PoolManager: {
		abi: PoolManagerABI || [],
		network: {
			rariTestnet: {
				address: getAddress((process.env.POOLMANAGER_CONTRACT_RARI_ADDRESS as `0x${string}`) || default_address),
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
					address: getAddress((process.env.POOLMANAGER_CONTRACT_RARI_ADDRESS as `0x${string}`) || default_address),
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
				address: getAddress((process.env.GTXROUTER_CONTRACT_RARI_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.RARI_START_BLOCK) || undefined,
				endBlock: Number(process.env.RARI_END_BLOCK) || undefined,
			},
		},
	},
	// Faucet exists on multiple chains (following same pattern as ChainBalanceManager and HyperlaneMailbox)
	Faucet: {
		abi: FaucetABI || [],
		network: {
			appchainTestnet: {
				address: getAddress((process.env.FAUCET_APPCHAIN_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.APPCHAIN_START_BLOCK) || undefined,
				endBlock: Number(process.env.APPCHAIN_END_BLOCK) || undefined,
			},
			arbitrumSepolia: {
				address: getAddress((process.env.FAUCET_ARBITRUM_SEPOLIA_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.ARBITRUM_SEPOLIA_START_BLOCK) || undefined,
				endBlock: Number(process.env.ARBITRUM_SEPOLIA_END_BLOCK) || undefined,
			},
		},
	},
};

export function getBaseConfig() {
	const config = {
		networks: {
			// Rari Testnet (Destination/Host Chain) - High priority, more resources
			rariTestnet: {
				chainId: 1918988905,
				transport: http(process.env.RARI_TESTNET_ENDPOINT),
				pollingInterval: Number(process.env.RARI_POLLING_INTERVAL) || 2000,
				maxRequestsPerSecond: Number(process.env.RARI_MAX_REQUESTS_PER_SECOND) || 15,
			},
			// Appchain Testnet (Source Chain) - Medium priority
			appchainTestnet: {
				chainId: 4661,
				transport: http(process.env.APPCHAIN_TESTNET_ENDPOINT),
				pollingInterval: Number(process.env.APPCHAIN_POLLING_INTERVAL) || 5000,
				maxRequestsPerSecond: Number(process.env.APPCHAIN_MAX_REQUESTS_PER_SECOND) || 8,
			},
			// Rise Sepolia (Source Chain) - Lower priority, conserve resources
			// risesSpolia: {
			// 	chainId: 11155931,
			// 	transport: http(process.env.RISE_SEPOLIA_ENDPOINT),
			// 	pollingInterval: Number(process.env.RISE_POLLING_INTERVAL) || 10000,
			// 	maxRequestsPerSecond: Number(process.env.RISE_MAX_REQUESTS_PER_SECOND) || 5,
			// },
			// Arbitrum Sepolia (Source Chain) - Highest cost, most conservative
			arbitrumSepolia: {
				chainId: 421614,
				transport: fallback([
					http(process.env.ARBITRUM_SEPOLIA_ENDPOINT),
				]),
				pollingInterval: Number(process.env.ARBITRUM_SEPOLIA_POLLING_INTERVAL) || 15000,
				maxRequestsPerSecond: Number(process.env.ARBITRUM_SEPOLIA_MAX_REQUESTS_PER_SECOND) || 3,
			},
		},
		contracts: contracts,
	};

	return config;
}
