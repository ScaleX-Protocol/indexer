import { createConfig, factory, loadBalance, rateLimit } from "ponder";
import { Address, getAddress, http, parseAbiItem, webSocket } from "viem";
import { OrderBookABI } from "./abis/OrderBook";
import { PoolManagerABI } from "./abis/PoolManager";
import { BalanceManagerABI } from "./abis/BalanceManager";
import { ChainBalanceManagerABI } from "./abis/ChainBalanceManager";
import { GTXRouterABI } from "./abis/GTXRouter";
import deploymentsAnvil from "./deployments/31337.json";
import deploymentsGTX from "./deployments/31338.json";
import deploymentsPharos from "./deployments/50002.json";
import deploymentsRise from "./deployments/11155931.json";
import dotenv from "dotenv";
import startBlock from "./deployments/start-block.json";

dotenv.config();

const createOrderBookFactory = (poolManagerAddress: Address) => {
	return factory({
		address: getAddress(poolManagerAddress),
		event: parseAbiItem(
			"event PoolCreated(bytes32 indexed poolId, address orderBook, address baseCurrency, address quoteCurrency)"
		),
		parameter: "orderBook",
	});
};

// Define flags to enable/disable networks and contracts
const enabledNetworks = {
	riseSepolia: true,
	pharosDevnet: false,
	gtx: false,
	anvil: true,
};

const enabledContracts = {
	OrderBook: true,
	PoolManager: true,
	BalanceManager: true,
	ChainBalanceManager: true,
	GTXRouter: true,
};

// Filter networks based on the enabledNetworks flag
const filterNetworks = (networks: Record<string, any>) => {
	return Object.fromEntries(Object.entries(networks).filter(([key]) => enabledNetworks[key] as any));
};

// Filter contracts based on the enabledContracts flag and filtered networks
const filterContracts = (contracts: Record<string, any>) => {
	return Object.fromEntries(
		Object.entries(contracts)
			.filter(([key]) => enabledContracts[key] as any)
			.map(([key, value]) => [
				key,
				{
					...value,
					network: filterNetworks(value.network),
				},
			])
	);
};

export default createConfig({
	database: {
		kind: "postgres",
		connectionString: process.env.PONDER_DATABASE_URL,
	},
	networks: filterNetworks({
		riseSepolia: {
			chainId: 11155931,
			transport: loadBalance([
				rateLimit(http("https://testnet.riselabs.xyz"), {
					requestsPerSecond: 25,
				}),
				rateLimit(http(process.env.RPC_URL_RISE_NIRVANA), {
					requestsPerSecond: 25,
				}),
				rateLimit(http(process.env.RPC_URL_RISE_ALCHEMY), {
					requestsPerSecond: 25,
				}),
			]),
		},
		pharosDevnet: {
			chainId: 50002,
			transport: loadBalance([
				rateLimit(http("https://devnet.dplabs-internal.com"), {
					requestsPerSecond: 2,
				}),
				rateLimit(webSocket("wss://devnet.dplabs-internal.com"), {
					requestsPerSecond: 2,
				}),
				rateLimit(http("https://pharos-devnet.rpc.hypersync.xyz"), {
					requestsPerSecond: 2,
				}),
				rateLimit(http("https://50002.rpc.hypersync.xyz"), {
					requestsPerSecond: 2,
				}),
			]),
		},
		gtx: {
			chainId: 31338,
			transport: http(process.env.RPC_URL_GTX),
			maxRequestsPerSecond: 25,
		},
		anvil: {
			chainId: 31337,
			transport: http(process.env.RPC_URL_ANVIL),
			disableCache: true,
		},
	}),
	contracts: filterContracts({
		OrderBook: {
			abi: OrderBookABI,
			network: {
				riseSepolia: {
					address: createOrderBookFactory(deploymentsRise.PROXY_POOLMANAGER as Address),
					startBlock: startBlock.START_BLOCK_ORDERBOOK.riseSepolia,
				},
				pharosDevnet: {
					address: createOrderBookFactory(deploymentsPharos.PROXY_POOLMANAGER as Address),
					startBlock: startBlock.START_BLOCK_ORDERBOOK.pharosDevnet,
				},
				gtx: {
					address: createOrderBookFactory(deploymentsGTX.PROXY_POOLMANAGER as Address),
				},
				anvil: {
					address: createOrderBookFactory(deploymentsAnvil.PROXY_POOLMANAGER as Address),
				},
			},
		},
		PoolManager: {
			abi: PoolManagerABI,
			network: {
				riseSepolia: {
					address: deploymentsRise.PROXY_POOLMANAGER as Address,
					startBlock: startBlock.START_BLOCK_POOLMANAGER.riseSepolia,
				},
				pharosDevnet: {
					address: deploymentsPharos.PROXY_POOLMANAGER as Address,
					startBlock: startBlock.START_BLOCK_POOLMANAGER.pharosDevnet,
				},
				gtx: {
					address: deploymentsGTX.PROXY_POOLMANAGER as Address,
				},
				anvil: {
					address: deploymentsAnvil.PROXY_POOLMANAGER as Address,
				},
			},
		},
		BalanceManager: {
			abi: BalanceManagerABI,
			network: {
				riseSepolia: {
					address: deploymentsRise.PROXY_BALANCEMANAGER as Address,
					startBlock: startBlock.START_BLOCK_BALANCEMANAGER.riseSepolia,
				},
				pharosDevnet: {
					address: deploymentsPharos.PROXY_BALANCEMANAGER as Address,
					startBlock: startBlock.START_BLOCK_BALANCEMANAGER.pharosDevnet,
				},
				gtx: {
					address: deploymentsGTX.PROXY_BALANCEMANAGER as Address,
				},
				anvil: {
					address: deploymentsAnvil.PROXY_BALANCEMANAGER as Address,
				},
			},
		},
		ChainBalanceManager: {
			abi: ChainBalanceManagerABI,
			network: {
				// Only include networks where ChainBalanceManager is actually deployed
				// riseSepolia: placeholder address - will be enabled when deployed
				// pharosDevnet: placeholder address - will be enabled when deployed  
				// gtx: placeholder address - will be enabled when deployed
				anvil: {
					// ChainBalanceManager is deployed on anvil for testing
					address: deploymentsAnvil.PROXY_CHAINBALANCEMANAGER as Address,
					startBlock: undefined,
				},
			},
		},
		GTXRouter: {
			abi: GTXRouterABI,
			network: {
				riseSepolia: {
					address: deploymentsRise.PROXY_ROUTER as Address,
					startBlock: startBlock.START_BLOCK_ROUTER.riseSepolia,
				},
				pharosDevnet: {
					address: deploymentsPharos.PROXY_ROUTER as Address,
					startBlock: startBlock.START_BLOCK_ROUTER.pharosDevnet,
				},
				gtx: {
					address: deploymentsGTX.PROXY_ROUTER as Address,
				},
				anvil: {
					address: deploymentsAnvil.PROXY_ROUTER as Address,
				},
			},
		},
	}),
});
