import { createErrorResponse } from './response.utils';
import { HttpStatus } from '../enums';

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidId = (id: string | number): boolean => {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;
  return !isNaN(numId) && numId > 0;
};

export const sanitizeString = (str: string): string => {
  return str.trim().toLowerCase();
};