import { describe, it, expect } from 'vitest';
import {
  isValidId,
  isValidApiKey,
  isValidBasecampUrl,
  sanitizeError,
  getErrorDetails,
} from '../src/utils/validation.js';

describe('isValidId', () => {
  it('validates numeric IDs', () => {
    expect(isValidId('123456')).toBe(true);
    expect(isValidId('1')).toBe(true);
    expect(isValidId('999999999999')).toBe(true);
  });

  it('rejects non-numeric IDs', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('abc')).toBe(false);
    expect(isValidId('123abc')).toBe(false);
    expect(isValidId('12.34')).toBe(false);
    expect(isValidId('-123')).toBe(false);
    expect(isValidId('123 456')).toBe(false);
  });
});

describe('isValidApiKey', () => {
  it('validates proper API keys', () => {
    expect(isValidApiKey('AIzaSyD1234567890abcdefghij')).toBe(true);
    expect(isValidApiKey('abc123-def_456-ghi789-jkl')).toBe(true);
    expect(isValidApiKey('12345678901234567890')).toBe(true);
  });

  it('rejects keys that are too short', () => {
    expect(isValidApiKey('short')).toBe(false);
    expect(isValidApiKey('1234567890123456789')).toBe(false); // 19 chars
  });

  it('rejects keys with invalid characters', () => {
    expect(isValidApiKey('key with spaces 1234567890')).toBe(false);
    expect(isValidApiKey('key!@#$%^&*()1234567890')).toBe(false);
    expect(isValidApiKey('key\nwith\nnewlines1234567890')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidApiKey('')).toBe(false);
  });
});

describe('isValidBasecampUrl', () => {
  it('validates todo URLs', () => {
    expect(isValidBasecampUrl('https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451')).toBe(true);
  });

  it('validates message URLs', () => {
    expect(isValidBasecampUrl('https://3.basecamp.com/1234567/buckets/12345678/messages/9000005451')).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isValidBasecampUrl('https://example.com')).toBe(false);
    expect(isValidBasecampUrl('https://basecamp.com/1234567/buckets/12345678/todos/9000005451')).toBe(false);
    expect(isValidBasecampUrl('https://3.basecamp.com/1234567/buckets/12345678/todolists/9000005451')).toBe(false);
    expect(isValidBasecampUrl('https://3.basecamp.com/abc/buckets/def/todos/ghi')).toBe(false);
    expect(isValidBasecampUrl('')).toBe(false);
  });
});

describe('sanitizeError', () => {
  it('sanitizes authentication errors', () => {
    expect(sanitizeError(new Error('Token expired'))).toBe('Authentication failed. Please re-authorize with Basecamp.');
    expect(sanitizeError(new Error('401 Unauthorized'))).toBe('Authentication failed. Please re-authorize with Basecamp.');
    expect(sanitizeError(new Error('Failed to authenticate'))).toBe('Authentication failed. Please re-authorize with Basecamp.');
  });

  it('sanitizes rate limit errors', () => {
    expect(sanitizeError(new Error('429 Too Many Requests'))).toBe('Too many requests. Please wait a moment and try again.');
    expect(sanitizeError(new Error('Rate limit exceeded'))).toBe('Too many requests. Please wait a moment and try again.');
  });

  it('sanitizes network errors', () => {
    expect(sanitizeError(new Error('fetch failed'))).toBe('Network error. Please check your internet connection.');
    expect(sanitizeError(new Error('ECONNREFUSED'))).toBe('Network error. Please check your internet connection.');
    expect(sanitizeError(new Error('Network timeout'))).toBe('Network error. Please check your internet connection.');
  });

  it('sanitizes API errors', () => {
    expect(sanitizeError(new Error('API error 500'))).toBe('External service error. Please try again later.');
    expect(sanitizeError(new Error('502 Bad Gateway'))).toBe('External service error. Please try again later.');
    expect(sanitizeError(new Error('503 Service Unavailable'))).toBe('External service error. Please try again later.');
  });

  it('sanitizes Basecamp errors', () => {
    expect(sanitizeError(new Error('Basecamp API returned 404'))).toBe('Could not fetch data from Basecamp. The resource may have been moved or deleted.');
    expect(sanitizeError(new Error('Resource not found 404'))).toBe('Could not fetch data from Basecamp. The resource may have been moved or deleted.');
  });

  it('sanitizes Gemini/AI errors', () => {
    expect(sanitizeError(new Error('Gemini API failed'))).toBe('AI processing error. Please try again.');
    expect(sanitizeError(new Error('AI model error'))).toBe('AI processing error. Please try again.');
    expect(sanitizeError(new Error('AI processing failed'))).toBe('AI processing error. Please try again.');
  });

  it('sanitizes configuration errors', () => {
    expect(sanitizeError(new Error('API key not configured'))).toBe('Configuration incomplete. Please complete setup.');
    expect(sanitizeError(new Error('Missing required parameter'))).toBe('Configuration incomplete. Please complete setup.');
  });

  it('returns generic message for unknown errors', () => {
    expect(sanitizeError(new Error('Some random error'))).toBe('An unexpected error occurred. Please try again.');
    expect(sanitizeError('string error')).toBe('An unexpected error occurred. Please try again.');
    expect(sanitizeError({ message: 'object error' })).toBe('An unexpected error occurred. Please try again.');
  });

  it('handles non-Error objects', () => {
    expect(sanitizeError(null)).toBe('An unexpected error occurred. Please try again.');
    expect(sanitizeError(undefined)).toBe('An unexpected error occurred. Please try again.');
    expect(sanitizeError(123)).toBe('An unexpected error occurred. Please try again.');
  });
});

describe('getErrorDetails', () => {
  it('includes error message', () => {
    const error = new Error('Test error message');
    const details = getErrorDetails(error);
    expect(details).toContain('Test error message');
  });

  it('includes context when provided', () => {
    const error = new Error('Test error');
    const details = getErrorDetails(error, 'fetchData');
    expect(details).toContain('[fetchData]');
    expect(details).toContain('Test error');
  });

  it('includes stack trace for Error objects', () => {
    const error = new Error('Test error');
    const details = getErrorDetails(error);
    expect(details).toContain('at ');
  });

  it('handles string errors', () => {
    const details = getErrorDetails('String error message');
    expect(details).toBe('String error message');
  });

  it('handles non-Error objects', () => {
    const details = getErrorDetails({ foo: 'bar' });
    expect(details).toContain('[object Object]');
  });
});
