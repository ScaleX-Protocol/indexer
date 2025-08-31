// Optimized config for reducing Alchemy usage
import { getBaseConfig } from "./base-ponder.config";
import { http, fallback } from "viem";

export function getOptimizedConfig() {
	const baseConfig = getBaseConfig();
	
	// Conservative polling intervals to reduce API usage
	const conservativeNetworkConfig = {
		pollingInterval: 10000, // 10 seconds instead of 100ms
		maxRequestsPerSecond: 5,  // Much lower limit
		disableCache: false,      // Enable caching
	};

	// Use fallback transports for better resilience
	const networks = Object.keys(baseConfig.networks).reduce((acc, networkName) => {
		const network = baseConfig.networks[networkName];
		acc[networkName] = {
			...network,
			...conservativeNetworkConfig,
			// Add fallback for critical endpoints
			transport: fallback([
				network.transport,
				http(`${network.transport.url}?maxCacheAge=60`), // 60s cache
			]),
		};
		return acc;
	}, {} as any);

	return {
		...baseConfig,
		networks,
		// Enable request batching
		batch: {
			multicall: {
				batchSize: 50,
				wait: 16,
			}
		},
	};
}