import axios, { AxiosResponse } from 'axios';
import { Endpoint, TestConfig } from './config';
import { RequestResult, TestResult } from './types';

export class PerformanceTester {
  private config: TestConfig;

  constructor(config: TestConfig) {
    this.config = config;
  }

  private buildUrl(baseUrl: string, endpoint: Endpoint): string {
    const url = new URL(endpoint.path, baseUrl);
    
    if (endpoint.params) {
      Object.entries(endpoint.params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    
    return url.toString();
  }

  private async makeRequest(url: string): Promise<RequestResult> {
    const startTime = process.hrtime.bigint();
    
    try {
      const response: AxiosResponse = await axios.get(url, {
        timeout: this.config.timeout,
        validateStatus: () => true // Accept all status codes
      });
      
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      
      return {
        success: response.status >= 200 && response.status < 400,
        responseTime,
        statusCode: response.status,
        responseSize: JSON.stringify(response.data).length
      };
    } catch (error: any) {
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - startTime) / 1000000;
      
      return {
        success: false,
        responseTime,
        error: error.message || 'Unknown error'
      };
    }
  }

  private async runConcurrentRequests(url: string, count: number): Promise<RequestResult[]> {
    const promises: Promise<RequestResult>[] = [];
    
    for (let i = 0; i < count; i++) {
      promises.push(this.makeRequest(url));
    }
    
    return Promise.all(promises);
  }

  private calculatePercentile(sortedTimes: number[], percentile: number): number {
    if (sortedTimes.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedTimes.length) - 1;
    return sortedTimes[Math.max(0, index)];
  }

  private analyzeResults(results: RequestResult[], endpoint: string, api: 'ponder' | 'bun'): TestResult {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    const responseTimes = successfulResults.map(r => r.responseTime);
    const sortedTimes = responseTimes.sort((a, b) => a - b);
    
    const totalTime = responseTimes.reduce((sum, time) => sum + time, 0);
    const averageTime = responseTimes.length > 0 ? totalTime / responseTimes.length : 0;
    const minTime = sortedTimes[0] || 0;
    const maxTime = sortedTimes[sortedTimes.length - 1] || 0;
    
    return {
      endpoint,
      api,
      totalRequests: results.length,
      successfulRequests: successfulResults.length,
      failedRequests: failedResults.length,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      p50Time: this.calculatePercentile(sortedTimes, 50),
      p95Time: this.calculatePercentile(sortedTimes, 95),
      p99Time: this.calculatePercentile(sortedTimes, 99),
      requestsPerSecond: successfulResults.length > 0 ? (successfulResults.length * 1000) / totalTime : 0,
      errorRate: (failedResults.length / results.length) * 100,
      errors: failedResults.map(r => r.error || 'Unknown error')
    };
  }

  async testEndpoint(endpoint: Endpoint, api: 'ponder' | 'bun'): Promise<TestResult> {
    const baseUrl = api === 'ponder' ? this.config.ponderUrl : this.config.bunUrl;
    const url = this.buildUrl(baseUrl, endpoint);
    
    console.log(`Testing ${api} - ${endpoint.name}...`);
    
    const batchSize = Math.min(this.config.concurrency, this.config.iterations);
    const batches = Math.ceil(this.config.iterations / batchSize);
    
    const allResults: RequestResult[] = [];
    
    for (let batch = 0; batch < batches; batch++) {
      const requestsInThisBatch = Math.min(batchSize, this.config.iterations - (batch * batchSize));
      const batchResults = await this.runConcurrentRequests(url, requestsInThisBatch);
      allResults.push(...batchResults);
      
      // Small delay between batches to prevent overwhelming the server
      if (batch < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return this.analyzeResults(allResults, endpoint.name, api);
  }

  async warmUp(endpoint: Endpoint): Promise<void> {
    console.log(`Warming up ${endpoint.name}...`);
    
    const ponderUrl = this.buildUrl(this.config.ponderUrl, endpoint);
    const bunUrl = this.buildUrl(this.config.bunUrl, endpoint);
    
    // Make a few requests to warm up both APIs
    const warmupRequests = 3;
    const promises = [];
    
    for (let i = 0; i < warmupRequests; i++) {
      promises.push(this.makeRequest(ponderUrl));
      promises.push(this.makeRequest(bunUrl));
    }
    
    await Promise.all(promises);
    
    // Wait a bit after warmup
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}