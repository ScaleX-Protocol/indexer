import { createLogger } from '../utils/logger';

// Environment-aware logging levels
const LOG_LEVELS = {
  SILENT: 0,
  ERROR: 1, 
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5
} as const;

const currentLogLevel = process.env.NODE_ENV === 'production' 
  ? LOG_LEVELS.INFO 
  : process.env.LOG_LEVEL === 'debug' 
    ? LOG_LEVELS.DEBUG 
    : LOG_LEVELS.INFO;

export class SimpleLogger {
  private logger: ReturnType<typeof createLogger>;
  
  constructor(module: string, functionName?: string) {
    this.logger = createLogger(module, functionName);
  }

  private shouldLog(level: keyof typeof LOG_LEVELS): boolean {
    return LOG_LEVELS[level] <= currentLogLevel;
  }

  // Only log critical errors
  error(message: string, error?: Error, meta?: Record<string, any>) {
    if (this.shouldLog('ERROR')) {
      this.logger.error(message, error, meta);
    }
  }

  // Only log important warnings
  warn(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('WARN')) {
      this.logger.warn(message, meta);
    }
  }

  // Only log important business events
  info(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('INFO')) {
      this.logger.info(message, meta);
    }
  }

  // Minimal debug logging for troubleshooting
  debug(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('DEBUG')) {
      this.logger.debug(message, meta);
    }
  }
}

// Factory function for consistent logger creation
export const getLogger = (module: string, functionName?: string) => {
  return new SimpleLogger(module, functionName);
};