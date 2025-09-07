#!/usr/bin/env node

import chalk from 'chalk';
import { config, endpoints } from './config';
import { PerformanceTester } from './tester';
import { ResultReporter } from './reporter';
import { ComparisonResult, OverallResults, TestResult } from './types';

async function main() {
  console.log(chalk.bold.blue('🚀 API Performance Comparison Tool'));
  console.log(chalk.gray('═'.repeat(50)));
  
  console.log(chalk.white(`Ponder URL: ${config.ponderUrl}`));
  console.log(chalk.white(`Bun URL: ${config.bunUrl}`));
  console.log(chalk.white(`Iterations per endpoint: ${config.iterations}`));
  console.log(chalk.white(`Concurrency: ${config.concurrency}`));
  console.log(chalk.white(`Timeout: ${config.timeout}ms`));
  console.log('');

  const tester = new PerformanceTester(config);
  const results: ComparisonResult[] = [];

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    
    console.log(chalk.bold.white(`\n[${i + 1}/${endpoints.length}] Testing: ${endpoint.name}`));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      // Warm up both APIs
      await tester.warmUp(endpoint);

      // Test Ponder API
      const ponderResult = await tester.testEndpoint(endpoint, 'ponder');
      
      // Small delay between API tests
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Test Bun API  
      const bunResult = await tester.testEndpoint(endpoint, 'bun');

      // Calculate improvement metrics
      const avgTimeImprovement = ((ponderResult.averageTime - bunResult.averageTime) / ponderResult.averageTime) * 100;
      const rpsImprovement = ((bunResult.requestsPerSecond - ponderResult.requestsPerSecond) / ponderResult.requestsPerSecond) * 100;
      const errorRateImprovement = ponderResult.errorRate - bunResult.errorRate;

      const comparison: ComparisonResult = {
        endpoint: endpoint.name,
        ponder: ponderResult,
        bun: bunResult,
        improvement: {
          averageTime: avgTimeImprovement,
          requestsPerSecond: rpsImprovement,
          errorRate: errorRateImprovement
        }
      };

      results.push(comparison);

      // Print individual results
      ResultReporter.printTestResult(ponderResult);
      ResultReporter.printTestResult(bunResult);
      ResultReporter.printComparison(comparison);

    } catch (error: any) {
      console.error(chalk.red(`❌ Error testing ${endpoint.name}: ${error.message}`));
      
      // Create dummy results for failed tests
      const dummyResult: TestResult = {
        endpoint: endpoint.name,
        api: 'ponder',
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: config.iterations,
        totalTime: 0,
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        p50Time: 0,
        p95Time: 0,
        p99Time: 0,
        requestsPerSecond: 0,
        errorRate: 100,
        errors: [error.message]
      };

      results.push({
        endpoint: endpoint.name,
        ponder: dummyResult,
        bun: { ...dummyResult, api: 'bun' },
        improvement: {
          averageTime: 0,
          requestsPerSecond: 0,
          errorRate: 0
        }
      });
    }

    // Progress indicator
    const progress = ((i + 1) / endpoints.length) * 100;
    console.log(chalk.blue(`\nProgress: ${progress.toFixed(1)}% complete`));
  }

  // Calculate overall summary
  const validResults = results.filter(r => r.ponder.successfulRequests > 0 && r.bun.successfulRequests > 0);
  
  const ponderAvgTime = validResults.reduce((sum, r) => sum + r.ponder.averageTime, 0) / validResults.length;
  const bunAvgTime = validResults.reduce((sum, r) => sum + r.bun.averageTime, 0) / validResults.length;
  const overallImprovement = ((ponderAvgTime - bunAvgTime) / ponderAvgTime) * 100;
  
  const ponderTotalRPS = validResults.reduce((sum, r) => sum + r.ponder.requestsPerSecond, 0);
  const bunTotalRPS = validResults.reduce((sum, r) => sum + r.bun.requestsPerSecond, 0);

  const overallResults: OverallResults = {
    summary: {
      totalTests: endpoints.length,
      ponderAvgTime,
      bunAvgTime,
      overallImprovement,
      ponderTotalRPS,
      bunTotalRPS
    },
    comparisons: results
  };

  // Print final summary
  ResultReporter.printOverallSummary(overallResults);

  // Export results
  ResultReporter.exportResults(overallResults);

  console.log(chalk.bold.green('\n✅ Performance comparison completed!'));
}

// Handle process interruption
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⚠️  Test interrupted by user'));
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red(`❌ Uncaught error: ${error.message}`));
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    process.exit(1);
  });
}