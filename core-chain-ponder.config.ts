// core-chain-ponder.config.ts - Configuration for Core Chain (coreDevnet/31337)
import dotenv from "dotenv";
import { factory } from "ponder";
import { fallback, getAddress, http, parseAbiItem } from "viem";
import { BalanceManagerABI, FaucetABI, GTXRouterABI, MailboxABI, OrderBookABI, PoolManagerABI } from "./abis";

dotenv.config({ path: ".env.core-chain" });

const default_address = getAddress("0x0000000000000000000000000000000000000000");

const contracts: any = {
	// BalanceManager exists on GTX Anvil (core chain - 31337)
	BalanceManager: {
		abi: BalanceManagerABI || [],
		network: {
			coreDevnet: {
				address: getAddress((process.env.BALANCEMANAGER_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// HyperlaneMailbox exists on GTX Anvil (core chain)
	HyperlaneMailbox: {
		abi: MailboxABI || [],
		network: {
			coreDevnet: {
				address: getAddress((process.env.MAILBOX_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// PoolManager exists on GTX Anvil (core chain)
	PoolManager: {
		abi: PoolManagerABI || [],
		network: {
			coreDevnet: {
				address: getAddress((process.env.POOLMANAGER_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// OrderBook exists on GTX Anvil (using factory pattern from PoolManager)
	OrderBook: {
		abi: OrderBookABI,
		network: {
			coreDevnet: {
				address: factory({
					address: getAddress((process.env.POOLMANAGER_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
					event: parseAbiItem(
						"event PoolCreated(bytes32 indexed poolId, address orderBook, address baseCurrency, address quoteCurrency)"
					),
					parameter: "orderBook",
				}),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// GTXRouter exists on GTX Anvil (core chain)
	GTXRouter: {
		abi: GTXRouterABI || [],
		network: {
			coreDevnet: {
				address: getAddress((process.env.GTXROUTER_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// Faucet exists on GTX Anvil (core chain)
	Faucet: {
		abi: FaucetABI || [],
		network: {
			coreDevnet: {
				address: getAddress((process.env.FAUCET_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.FAUCET_START_BLOCK) || 0,
				endBlock: Number(process.env.FAUCET_END_BLOCK) || undefined,
			},
		},
	},

	// ChainRegistry exists on GTX Anvil (core chain)
	ChainRegistry: {
		abi: [], // Add ChainRegistry ABI if available
		network: {
			coreDevnet: {
				address: getAddress((process.env.CHAINREGISTRY_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// TokenRegistry exists on GTX Anvil (core chain)
	TokenRegistry: {
		abi: [], // Add TokenRegistry ABI if available
		network: {
			coreDevnet: {
				address: getAddress((process.env.TOKENREGISTRY_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},

	// SyntheticTokenFactory exists on GTX Anvil (core chain)
	SyntheticTokenFactory: {
		abi: [], // Add SyntheticTokenFactory ABI if available
		network: {
			coreDevnet: {
				address: getAddress((process.env.SYNTHETICTOKENFACTORY_CONTRACT_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			},
		},
	},
};

export function getCoreChainConfig() {
	const config = {
		networks: {
			// GTX Anvil (Core Chain - 31337) - Main trading chain
			coreDevnet: {
				chainId: 31337,
				transport: fallback([
					http(process.env.CORE_DEVNET_ENDPOINT),
				]),
				pollingInterval: Number(process.env.GTX_ANVIL_POLLING_INTERVAL) || 1000,
				maxRequestsPerSecond: Number(process.env.GTX_ANVIL_MAX_REQUESTS_PER_SECOND) || 50,
				// Anvil-specific optimizations
				retryCount: Number(process.env.MAX_RETRIES) || 3,
				retryDelay: Number(process.env.RETRY_DELAY) || 1000,
			},
		},
		contracts: contracts,

		// Additional core-chain-specific configuration
		options: {
			// Performance settings optimized for core chain operations
			maxHealthcheckDuration: 30_000,
			telemetryDisabled: process.env.PONDER_TELEMETRY_DISABLED === "true",

			// Debug settings
			logLevel: process.env.LOG_LEVEL as "silent" | "error" | "warn" | "info" | "debug" | "trace" || "debug",
		},

		// Server configuration
		server: {
			port: Number(process.env.PONDER_PORT) || 42070,
		},
	};

	return config;
}

// Utility function to validate core chain environment variables
export function validateCoreChainEnvironment(): boolean {
	const requiredVars = [
		"CORE_DEVNET_ENDPOINT",
		"BALANCEMANAGER_CONTRACT_GTX_ANVIL_ADDRESS",
		"POOLMANAGER_CONTRACT_GTX_ANVIL_ADDRESS",
		"GTXROUTER_CONTRACT_GTX_ANVIL_ADDRESS",
		"FAUCET_GTX_ANVIL_ADDRESS",
	];

	const missing = requiredVars.filter(varName => !process.env[varName]);

	if (missing.length > 0) {
		console.error(`Missing required core chain environment variables: ${missing.join(", ")}`);
		console.error("Please ensure .env.core-chain is properly configured");
		return false;
	}

	return true;
}