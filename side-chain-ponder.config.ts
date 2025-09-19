// side-chain-ponder.config.ts - Configuration for Side Chain (gtxAnvil2/31338)
import dotenv from "dotenv";
import { factory } from "ponder";
import { fallback, getAddress, http, parseAbiItem } from "viem";
import { ChainBalanceManagerABI, FaucetABI, MailboxABI } from "./abis";

dotenv.config({ path: ".env.side-chain" });

const default_address = getAddress("0x0000000000000000000000000000000000000000");

const contracts: any = {
	// ChainBalanceManager exists on GTX Anvil 2 (side chain - 31338)
	ChainBalanceManager: {
		abi: ChainBalanceManagerABI || [],
		network: {
			gtxAnvil2: {
				address: getAddress((process.env.CHAIN_BALANCE_MANAGER_GTX_ANVIL_2_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_2_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_2_END_BLOCK) || undefined,
			},
		},
	},

	// HyperlaneMailbox exists on GTX Anvil 2 (side chain)
	HyperlaneMailbox: {
		abi: MailboxABI || [],
		network: {
			gtxAnvil2: {
				address: getAddress((process.env.MAILBOX_GTX_ANVIL_2_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_2_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_2_END_BLOCK) || undefined,
			},
			gtxAnvil: {
				address: getAddress((process.env.MAILBOX_GTX_ANVIL_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_END_BLOCK) || undefined,
			}
		},
	},

	// Faucet exists on GTX Anvil 2 (side chain)
	Faucet: {
		abi: FaucetABI || [],
		network: {
			gtxAnvil2: {
				address: getAddress((process.env.FAUCET_GTX_ANVIL_2_ADDRESS as `0x${string}`) || default_address),
				startBlock: Number(process.env.GTX_ANVIL_2_START_BLOCK) || 0,
				endBlock: Number(process.env.GTX_ANVIL_2_END_BLOCK) || undefined,
			},
		},
	},
};

export function getSideChainConfig() {
	const config = {
		networks: {
			// GTX Anvil 2 (Side Chain - 31338) - Cross-chain operations
			gtxAnvil2: {
				chainId: 31338,
				transport: fallback([
					http(process.env.GTX_ANVIL_2_ENDPOINT),
				]),
				pollingInterval: Number(process.env.GTX_ANVIL_2_POLLING_INTERVAL) || 1000,
				maxRequestsPerSecond: Number(process.env.GTX_ANVIL_2_MAX_REQUESTS_PER_SECOND) || 50,
				// Anvil-specific optimizations
				retryCount: Number(process.env.MAX_RETRIES) || 3,
				retryDelay: Number(process.env.RETRY_DELAY) || 1000,
			},
			gtxAnvil: {
				chainId: 31337,
				transport: fallback([
					http(process.env.GTX_ANVIL_ENDPOINT),
				]),
				pollingInterval: Number(process.env.GTX_ANVIL_POLLING_INTERVAL) || 1000,
				maxRequestsPerSecond: Number(process.env.GTX_ANVIL_MAX_REQUESTS_PER_SECOND) || 50,
				// Anvil-specific optimizations
				retryCount: Number(process.env.MAX_RETRIES) || 3,
				retryDelay: Number(process.env.RETRY_DELAY) || 1000,
			},
		},
		contracts: contracts,

		// Additional side-chain-specific configuration
		options: {
			// Performance settings optimized for side chain operations
			maxHealthcheckDuration: 30_000,
			telemetryDisabled: process.env.PONDER_TELEMETRY_DISABLED === "true",

			// Debug settings
			logLevel: process.env.LOG_LEVEL as "silent" | "error" | "warn" | "info" | "debug" | "trace" || "debug",
		},

		// Server configuration
		server: {
			port: Number(process.env.PONDER_PORT) || 42071,
		},
	};

	return config;
}

// Utility function to validate side chain environment variables
export function validateSideChainEnvironment(): boolean {
	const requiredVars = [
		"GTX_ANVIL_2_ENDPOINT",
		"CHAIN_BALANCE_MANAGER_GTX_ANVIL_2_ADDRESS",
		"MAILBOX_GTX_ANVIL_2_ADDRESS",
		"FAUCET_GTX_ANVIL_2_ADDRESS",
	];

	const missing = requiredVars.filter(varName => !process.env[varName]);

	if (missing.length > 0) {
		console.error(`Missing required side chain environment variables: ${missing.join(", ")}`);
		console.error("Please ensure .env.side-chain is properly configured");
		return false;
	}

	return true;
}