export interface TestResult {
  endpoint: string;
  api: 'ponder' | 'bun';
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p50Time: number;
  p95Time: number;
  p99Time: number;
  requestsPerSecond: number;
  errorRate: number;
  errors: string[];
}

export interface RequestResult {
  success: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
  responseSize?: number;
}

export interface ComparisonResult {
  endpoint: string;
  ponder: TestResult;
  bun: TestResult;
  improvement: {
    averageTime: number;
    requestsPerSecond: number;
    errorRate: number;
  };
}

export interface OverallResults {
  summary: {
    totalTests: number;
    ponderAvgTime: number;
    bunAvgTime: number;
    overallImprovement: number;
    ponderTotalRPS: number;
    bunTotalRPS: number;
  };
  comparisons: ComparisonResult[];
}