# Backend Performance Tester

A comprehensive performance testing tool to compare backend API response times, throughput, and reliability.

## Features

- **Comprehensive Testing**: Tests all 10 API endpoints
- **Concurrent Load Testing**: Configurable concurrency levels
- **Detailed Metrics**: Response times, RPS, percentiles, error rates
- **Visual Reports**: Color-coded tables and comparisons
- **Export Results**: JSON export for further analysis
- **Warm-up Phase**: Ensures fair testing conditions

## Quick Start

```bash
# Install dependencies
bun install

# Run performance comparison
bun test

# Run in development mode (with file watching)
bun dev
```

## Configuration

Edit `src/config.ts` to customize test parameters:

```typescript
export const config = {
  ponderUrl: 'http://localhost:42069',  // Ponder API URL
  bunUrl: 'http://localhost:3000',      // Bun API URL
  testSymbol: 'ETH/USDT',               // Symbol for testing
  testAddress: '0x742d35...Be',         // Address for user-specific tests
  iterations: 100,                      // Requests per endpoint
  concurrency: 10,                      // Concurrent requests
  timeout: 30000                        // Request timeout (ms)
};
```

## Test Endpoints

The tool tests these endpoints:

1. **Kline (1m)** - `/api/kline?symbol=ETH/USDT&interval=1m&limit=100`
2. **Order Book Depth** - `/api/depth?symbol=ETH/USDT&limit=50`
3. **Recent Trades** - `/api/trades?symbol=ETH/USDT&limit=100`
4. **24hr Ticker** - `/api/ticker/24hr?symbol=ETH/USDT`
5. **Ticker Price** - `/api/ticker/price?symbol=ETH/USDT`
6. **Trading Pairs** - `/api/pairs`
7. **Markets Overview** - `/api/markets`
8. **User Account** - `/api/account?address=0x...`
9. **All Orders** - `/api/allOrders?address=0x...&limit=50`
10. **Open Orders** - `/api/openOrders?address=0x...`

## Metrics Collected

- **Response Time**: Average, Min, Max, P50, P95, P99
- **Throughput**: Requests per second
- **Reliability**: Success rate, error rate
- **Load Handling**: Performance under concurrent load

## Sample Output

```
🔥 COMPARISON: Order Book Depth
═══════════════════════════════════════════════════════
┌────────────────────┬───────────────┬───────────────┬───────────────┐
│ Metric             │ Ponder        │ Bun           │ Improvement   │
├────────────────────┼───────────────┼───────────────┼───────────────┤
│ Average Time       │ 45.2ms        │ 12.8ms        │ +71.7%        │
│ Requests/sec       │ 221.2         │ 781.3         │ +253.1%       │
│ Error Rate         │ 0.0%          │ 0.0%          │ 0%            │
│ P95 Time           │ 89.1ms        │ 23.4ms        │ +73.7%        │
│ P99 Time           │ 124.5ms       │ 31.2ms        │ +74.9%        │
└────────────────────┴───────────────┴───────────────┴───────────────┘

✅ Bun is 71.7% faster!
```

## Results Export

Results are automatically exported to JSON files with timestamps:
- `performance-test-2025-09-03T20-30-15-123Z.json`

## Prerequisites

Before running the comparison:

1. **Start Ponder API** (usually port 42069)
2. **Start Bun API** (usually port 3000)  
3. **Ensure database has test data** for the configured symbol/address
4. **Check network connectivity** to both APIs

## Troubleshooting

### Common Issues

**Connection Refused**
- Verify both APIs are running
- Check port numbers in config
- Ensure no firewall blocking

**Database Errors**
- Verify test symbol exists in database
- Ensure test address has some data
- Check database connectivity

**Timeout Errors**
- Increase timeout in config
- Reduce concurrency level
- Check API performance individually

### Performance Tips

- **Warm-up**: Tool includes automatic warm-up phase
- **Database**: Ensure database is optimized with proper indexes
- **Network**: Run on same machine/network for fair comparison
- **Resources**: Ensure adequate CPU/memory for both APIs

## Development

```bash
# Install dependencies
bun install

# Run with file watching
bun dev

# Build for production
bun run build
```

## Advanced Usage

### Custom Test Scenarios

Modify `src/config.ts` to add custom endpoints or parameters:

```typescript
export const endpoints: Endpoint[] = [
  {
    name: 'Custom Endpoint',
    path: '/api/custom',
    params: {
      customParam: 'value'
    }
  }
];
```

### Batch Testing

Run multiple test configurations:

```bash
# Test with different concurrency levels
CONCURRENCY=5 bun test
CONCURRENCY=20 bun test
CONCURRENCY=50 bun test
```

### Load Testing

For stress testing, increase iterations and concurrency:

```typescript
export const config = {
  // ... other settings
  iterations: 1000,
  concurrency: 50
};
```

This tool will help you validate backend API performance and compare different implementations!