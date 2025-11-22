/**
 * Test script for API endpoints
 * Make sure the API server is running before executing this script
 * Run with: bun run scripts/test-endpoints.ts
 */

const API_BASE_URL = 'http://localhost:3000/api';

interface TestResult {
  endpoint: string;
  method: string;
  status: 'success' | 'error' | 'empty';
  statusCode?: number;
  message?: string;
  dataCount?: number;
}

async function testEndpoint(
  endpoint: string,
  method: string = 'GET',
  params?: Record<string, string>
): Promise<TestResult> {
  try {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), { method });
    const data = await response.json();

    if (!response.ok) {
      return {
        endpoint,
        method,
        status: 'error',
        statusCode: response.status,
        message: data.message || 'Request failed',
      };
    }

    const isArray = Array.isArray(data.data);
    const dataCount = isArray ? data.data.length : data.data ? 1 : 0;

    return {
      endpoint,
      method,
      status: dataCount > 0 ? 'success' : 'empty',
      statusCode: response.status,
      dataCount,
    };
  } catch (error) {
    return {
      endpoint,
      method,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function runTests() {
  console.log('🧪 Testing Envio API Endpoints\n');
  console.log('=' .repeat(80));

  const testAddress = '0x1234567890123456789012345678901234567890';
  const testSymbol = 'WETHUSDC';

  const tests = [
    { name: 'Health Check', endpoint: '/health', base: 'http://localhost:3000' },
    { name: 'Get All Pairs', endpoint: '/pairs' },
    { name: 'Get All Markets', endpoint: '/markets' },
    { name: 'Get All Currencies', endpoint: '/currencies' },
    { name: 'Get Ticker Price', endpoint: '/ticker/price', params: { symbol: testSymbol } },
    { name: 'Get 24hr Ticker', endpoint: '/ticker/24hr', params: { symbol: testSymbol } },
    { name: 'Get Order Book Depth', endpoint: '/depth', params: { symbol: testSymbol, limit: '20' } },
    { name: 'Get Trades', endpoint: '/trades', params: { symbol: testSymbol, limit: '100' } },
    { name: 'Get Klines (1m)', endpoint: '/klines', params: { symbol: testSymbol, interval: '1m', limit: '100' } },
    { name: 'Get Klines (5m)', endpoint: '/klines', params: { symbol: testSymbol, interval: '5m', limit: '100' } },
    { name: 'Get Klines (1h)', endpoint: '/klines', params: { symbol: testSymbol, interval: '1h', limit: '100' } },
    { name: 'Get Klines (1d)', endpoint: '/klines', params: { symbol: testSymbol, interval: '1d', limit: '100' } },
    { name: 'Get Open Orders', endpoint: '/openOrders', params: { symbol: testSymbol, address: testAddress } },
    { name: 'Get All Orders', endpoint: '/allOrders', params: { symbol: testSymbol, address: testAddress, limit: '50' } },
    { name: 'Get Account Balances', endpoint: '/account', params: { address: testAddress } },
  ];

  const results: TestResult[] = [];

  console.log('\n🔄 Running tests...\n');

  for (const test of tests) {
    const baseUrl = test.base || API_BASE_URL;
    const endpoint = test.base ? test.endpoint : `${API_BASE_URL}${test.endpoint}`;

    if (test.base) {
      // Special handling for non-API endpoints
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        results.push({
          endpoint: test.endpoint,
          method: 'GET',
          status: response.ok ? 'success' : 'error',
          statusCode: response.status,
        });
      } catch (error) {
        results.push({
          endpoint: test.endpoint,
          method: 'GET',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      const result = await testEndpoint(test.endpoint, 'GET', test.params);
      results.push(result);
    }

    // Display result immediately
    const result = results[results.length - 1];
    const statusIcon =
      result.status === 'success' ? '✅' :
      result.status === 'empty' ? '⚠️' :
      '❌';

    const dataInfo = result.dataCount !== undefined ? `(${result.dataCount} records)` : '';
    const errorInfo = result.message ? `- ${result.message}` : '';

    console.log(
      `${statusIcon} ${test.name.padEnd(30)} ${result.statusCode || '---'} ${dataInfo} ${errorInfo}`
    );
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Test Summary:\n');

  const successCount = results.filter(r => r.status === 'success').length;
  const emptyCount = results.filter(r => r.status === 'empty').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log(`✅ Successful: ${successCount}/${results.length}`);
  console.log(`⚠️  Empty Data: ${emptyCount}/${results.length}`);
  console.log(`❌ Errors: ${errorCount}/${results.length}`);

  if (emptyCount > 0) {
    console.log('\n💡 Empty responses are expected if:');
    console.log('   - The indexer is still syncing');
    console.log('   - No trades have occurred yet');
    console.log('   - Testing with addresses that have no activity');
  }

  if (errorCount > 0) {
    console.log('\n⚠️  Some endpoints returned errors. Check:');
    console.log('   1. API server is running (bun run dev)');
    console.log('   2. Database connection is configured correctly');
    console.log('   3. Envio indexer has created the aggregated tables');
  }

  console.log('\n' + '='.repeat(80));
  process.exit(errorCount > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('❌ Test execution failed:', error);
  process.exit(1);
});
