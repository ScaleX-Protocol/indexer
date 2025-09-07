export interface TestConfig {
  ponderUrl: string;
  bunUrl: string;
  testSymbol: string;
  testAddress: string;
  iterations: number;
  concurrency: number;
  timeout: number;
}

export const config: TestConfig = {
  ponderUrl: process.env.PONDER_URL || 'http://localhost:42069',
  bunUrl: process.env.BUN_URL || 'http://localhost:3000',
  testSymbol: 'gsWETH/gsUSDT',
  testAddress: '0x742d35Cc6634C0532925a3b8D1D75A0e02d6C8Be',
  iterations: parseInt(process.env.ITERATIONS || '100'),
  concurrency: parseInt(process.env.CONCURRENCY || '10'),
  timeout: parseInt(process.env.TIMEOUT || '30000')
};

export interface Endpoint {
  name: string;
  path: string;
  params?: Record<string, string>;
}

export const endpoints: Endpoint[] = [
  {
    name: 'Trading Pairs',
    path: '/api/pairs'
  },
  {
    name: 'Markets Overview',
    path: '/api/markets'
  },
  {
    name: 'Ticker Price',
    path: '/api/ticker/price',
    params: {
      symbol: 'gsWETH/gsUSDT'
    }
  },
  {
    name: 'Kline (1m)',
    path: '/api/kline',
    params: {
      symbol: 'gsWETH/gsUSDT',
      interval: '1m',
      limit: '100'
    }
  },
  {
    name: 'Order Book Depth',
    path: '/api/depth',
    params: {
      symbol: 'gsWETH/gsUSDT',
      limit: '50'
    }
  }
];