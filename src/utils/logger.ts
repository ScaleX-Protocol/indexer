import dotenv from "dotenv";

dotenv.config();

// Configurable logging options
export interface LogConfig {
  includeBlockNumber?: boolean;
  includeTransactionHash?: boolean;
  includeFile?: boolean;
  includeFunction?: boolean;
  includeStep?: boolean;
}

// Get log configuration from environment variables
const getLogConfigFromEnv = (): LogConfig => {
  return {
    includeBlockNumber: process.env.LOG_INCLUDE_BLOCK_NUMBER !== 'false',
    includeTransactionHash: process.env.LOG_INCLUDE_TRANSACTION_HASH !== 'false',
    includeFile: process.env.LOG_INCLUDE_FILE !== 'false',
    includeFunction: process.env.LOG_INCLUDE_FUNCTION !== 'false',
    includeStep: process.env.LOG_INCLUDE_STEP !== 'false'
  };
};

// Default log configuration from environment
export const DEFAULT_LOG_CONFIG: LogConfig = getLogConfigFromEnv();

// Helper function to format log prefix with configurable fields
export const formatLogPrefix = (
  event: any, 
  fileName: string, 
  functionName: string, 
  step?: string, 
  config: LogConfig = DEFAULT_LOG_CONFIG
) => {
  const parts: string[] = [];
  
  if (config.includeBlockNumber && event?.block?.number) {
    parts.push(`Block number: ${event.block.number}`);
  }
  
  if (config.includeTransactionHash && event?.transaction?.hash) {
    parts.push(`Transaction hash: ${event.transaction.hash}`);
  }
  
  if (config.includeFile) {
    parts.push(`File: ${fileName}`);
  }
  
  if (config.includeFunction) {
    parts.push(`Function: ${functionName}`);
  }
  
  if (config.includeStep && step) {
    parts.push(step);
  }
  
  return parts.join(', ');
};

// Utility function for functions without event context
export const formatLogPrefixSimple = (
  blockNumber: number | undefined,
  fileName: string,
  functionName: string,
  step?: string,
  config: LogConfig = DEFAULT_LOG_CONFIG
) => {
  const parts: string[] = [];
  
  if (config.includeBlockNumber && blockNumber !== undefined) {
    parts.push(`Block number: ${blockNumber}`);
  }
  
  if (config.includeFile) {
    parts.push(`File: ${fileName}`);
  }
  
  if (config.includeFunction) {
    parts.push(`Function: ${functionName}`);
  }
  
  if (config.includeStep && step) {
    parts.push(step);
  }
  
  return parts.join(', ');
};

// Helper to create a log function for a specific file and function
export const createLogger = (fileName: string, functionName: string) => {
  return {
    // For functions with event context
    log: (event: any, step: string) => formatLogPrefix(event, fileName, functionName, step),
    // For functions without event context
    logSimple: (blockNumber: number | undefined, step: string) => formatLogPrefixSimple(blockNumber, fileName, functionName, step)
  };
};