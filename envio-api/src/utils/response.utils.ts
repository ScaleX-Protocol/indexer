import { HttpStatus } from '../enums';
import type { ApiResponse } from '../types';

export function createSuccessResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

export function createErrorResponse(error: string, status?: HttpStatus): ApiResponse {
  return {
    success: false,
    error,
  };
}
