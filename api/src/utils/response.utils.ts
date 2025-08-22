import { ApiResponse, PaginatedResponse } from '../types';
import { HttpStatus } from '../enums';

export const createSuccessResponse = <T>(
  data: T,
  message?: string
): ApiResponse<T> => ({
  success: true,
  data,
  message
});

export const createErrorResponse = (
  error: string,
  statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR
): ApiResponse => ({
  success: false,
  error
});

export const createPaginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  total: number
): PaginatedResponse<T> => ({
  success: true,
  data,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit)
  }
});