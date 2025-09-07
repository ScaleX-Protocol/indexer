import chalk from 'chalk';
import Table from 'cli-table3';
import { ComparisonResult, OverallResults, TestResult } from './types';

export class ResultReporter {
  static formatTime(ms: number): string {
    if (ms < 1) {
      return `${(ms * 1000).toFixed(1)}μs`;
    } else if (ms < 1000) {
      return `${ms.toFixed(1)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  static formatNumber(num: number): string {
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  static formatPercentage(num: number): string {
    const sign = num > 0 ? '+' : '';
    const color = num > 0 ? chalk.green : num < 0 ? chalk.red : chalk.gray;
    return color(`${sign}${num.toFixed(1)}%`);
  }

  static printTestResult(result: TestResult): void {
    const table = new Table({
      head: ['Metric', 'Value'],
      colWidths: [20, 15]
    });

    const apiColor = result.api === 'bun' ? chalk.blue : chalk.yellow;
    console.log(`\n${apiColor.bold(`${result.api.toUpperCase()} API - ${result.endpoint}`)}`);

    table.push(
      ['Total Requests', result.totalRequests.toString()],
      ['Successful', `${result.successfulRequests} (${(100 - result.errorRate).toFixed(1)}%)`],
      ['Failed', `${result.failedRequests} (${result.errorRate.toFixed(1)}%)`],
      ['Average Time', this.formatTime(result.averageTime)],
      ['Min Time', this.formatTime(result.minTime)],
      ['Max Time', this.formatTime(result.maxTime)],
      ['P50 Time', this.formatTime(result.p50Time)],
      ['P95 Time', this.formatTime(result.p95Time)],
      ['P99 Time', this.formatTime(result.p99Time)],
      ['Requests/sec', this.formatNumber(result.requestsPerSecond)]
    );

    console.log(table.toString());

    if (result.errors.length > 0) {
      console.log(chalk.red('\nErrors:'));
      const uniqueErrors = [...new Set(result.errors)];
      uniqueErrors.slice(0, 5).forEach(error => {
        console.log(chalk.red(`  • ${error}`));
      });
      if (uniqueErrors.length > 5) {
        console.log(chalk.red(`  • ... and ${uniqueErrors.length - 5} more`));
      }
    }
  }

  static printComparison(comparison: ComparisonResult): void {
    console.log(`\n${chalk.bold.white('═'.repeat(80))}`);
    console.log(chalk.bold.white(`🔥 COMPARISON: ${comparison.endpoint}`));
    console.log(chalk.bold.white('═'.repeat(80)));

    const table = new Table({
      head: ['Metric', 'Ponder', 'Bun', 'Improvement'],
      colWidths: [20, 15, 15, 15]
    });

    const avgTimeImprovement = ((comparison.ponder.averageTime - comparison.bun.averageTime) / comparison.ponder.averageTime) * 100;
    const rpsImprovement = ((comparison.bun.requestsPerSecond - comparison.ponder.requestsPerSecond) / comparison.ponder.requestsPerSecond) * 100;
    const errorImprovement = comparison.ponder.errorRate - comparison.bun.errorRate;

    table.push(
      [
        'Average Time',
        this.formatTime(comparison.ponder.averageTime),
        this.formatTime(comparison.bun.averageTime),
        this.formatPercentage(avgTimeImprovement)
      ],
      [
        'Requests/sec',
        this.formatNumber(comparison.ponder.requestsPerSecond),
        this.formatNumber(comparison.bun.requestsPerSecond),
        this.formatPercentage(rpsImprovement)
      ],
      [
        'Error Rate',
        `${comparison.ponder.errorRate.toFixed(1)}%`,
        `${comparison.bun.errorRate.toFixed(1)}%`,
        errorImprovement > 0 ? chalk.green(`-${errorImprovement.toFixed(1)}%`) : 
        errorImprovement < 0 ? chalk.red(`+${Math.abs(errorImprovement).toFixed(1)}%`) : 
        chalk.gray('0%')
      ],
      [
        'P95 Time',
        this.formatTime(comparison.ponder.p95Time),
        this.formatTime(comparison.bun.p95Time),
        this.formatPercentage(((comparison.ponder.p95Time - comparison.bun.p95Time) / comparison.ponder.p95Time) * 100)
      ],
      [
        'P99 Time',
        this.formatTime(comparison.ponder.p99Time),
        this.formatTime(comparison.bun.p99Time),
        this.formatPercentage(((comparison.ponder.p99Time - comparison.bun.p99Time) / comparison.ponder.p99Time) * 100)
      ]
    );

    console.log(table.toString());

    // Overall assessment
    if (avgTimeImprovement > 10) {
      console.log(chalk.green.bold(`✅ Bun is ${avgTimeImprovement.toFixed(1)}% faster!`));
    } else if (avgTimeImprovement > 0) {
      console.log(chalk.yellow.bold(`⚡ Bun is slightly faster (+${avgTimeImprovement.toFixed(1)}%)`));
    } else if (avgTimeImprovement < -10) {
      console.log(chalk.red.bold(`❌ Ponder is ${Math.abs(avgTimeImprovement).toFixed(1)}% faster`));
    } else {
      console.log(chalk.gray.bold(`⚖️  Performance is comparable`));
    }
  }

  static printOverallSummary(results: OverallResults): void {
    console.log(`\n${chalk.bold.white('🎯 OVERALL PERFORMANCE SUMMARY')}`);
    console.log(chalk.bold.white('═'.repeat(50)));

    const overallImprovement = ((results.summary.ponderAvgTime - results.summary.bunAvgTime) / results.summary.ponderAvgTime) * 100;
    const rpsImprovement = ((results.summary.bunTotalRPS - results.summary.ponderTotalRPS) / results.summary.ponderTotalRPS) * 100;

    const summaryTable = new Table({
      head: ['Metric', 'Ponder', 'Bun', 'Improvement'],
      colWidths: [20, 15, 15, 15]
    });

    summaryTable.push(
      [
        'Avg Response Time',
        this.formatTime(results.summary.ponderAvgTime),
        this.formatTime(results.summary.bunAvgTime),
        this.formatPercentage(overallImprovement)
      ],
      [
        'Total RPS',
        this.formatNumber(results.summary.ponderTotalRPS),
        this.formatNumber(results.summary.bunTotalRPS),
        this.formatPercentage(rpsImprovement)
      ]
    );

    console.log(summaryTable.toString());

    // Final verdict
    console.log(`\n${chalk.bold.white('VERDICT:')}`);
    if (overallImprovement > 50) {
      console.log(chalk.green.bold(`🚀 Bun is SIGNIFICANTLY faster! (${overallImprovement.toFixed(1)}% improvement)`));
    } else if (overallImprovement > 20) {
      console.log(chalk.green.bold(`⚡ Bun is much faster! (${overallImprovement.toFixed(1)}% improvement)`));
    } else if (overallImprovement > 5) {
      console.log(chalk.green.bold(`✅ Bun is faster (${overallImprovement.toFixed(1)}% improvement)`));
    } else if (overallImprovement > -5) {
      console.log(chalk.yellow.bold(`⚖️  Performance is comparable`));
    } else {
      console.log(chalk.red.bold(`❌ Ponder is faster (${Math.abs(overallImprovement).toFixed(1)}% better)`));
    }

    // Performance summary by endpoint
    console.log(`\n${chalk.bold.white('ENDPOINT RANKINGS:')}`);
    const sortedComparisons = results.comparisons.sort((a, b) => {
      const aImprovement = ((a.ponder.averageTime - a.bun.averageTime) / a.ponder.averageTime) * 100;
      const bImprovement = ((b.ponder.averageTime - b.bun.averageTime) / b.ponder.averageTime) * 100;
      return bImprovement - aImprovement;
    });

    sortedComparisons.forEach((comparison, index) => {
      const improvement = ((comparison.ponder.averageTime - comparison.bun.averageTime) / comparison.ponder.averageTime) * 100;
      const emoji = improvement > 20 ? '🚀' : improvement > 10 ? '⚡' : improvement > 0 ? '✅' : improvement > -10 ? '⚖️' : '❌';
      const color = improvement > 10 ? chalk.green : improvement > 0 ? chalk.yellow : chalk.red;
      
      console.log(`${emoji} ${index + 1}. ${comparison.endpoint}: ${color(this.formatPercentage(improvement).replace(/[+\-]/, ''))}`);
    });
  }

  static exportResults(results: OverallResults, filename?: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = filename || `performance-comparison-${timestamp}.json`;
    
    try {
      require('fs').writeFileSync(file, JSON.stringify(results, null, 2));
      console.log(chalk.blue(`\n📊 Results exported to: ${file}`));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to export results: ${error}`));
    }
  }
}