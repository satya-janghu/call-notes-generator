import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAuthorizationUrl,
  isTokenExpired,
  hasBasecampCredentials,
  hasBasecampTokens,
  hasGeminiKey,
  getCredentialStatus,
} from '../src/services/basecamp/auth.js';

describe('Basecamp Auth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAuthorizationUrl', () => {
    it('returns correct OAuth URL with params', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-client-id';

      const url = getAuthorizationUrl('http://localhost:3000/auth/callback');

      expect(url).toContain('https://launchpad.37signals.com/authorization/new');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
      expect(url).toContain('type=web_server');
    });

    it('includes state parameter when provided', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-client-id';

      const url = getAuthorizationUrl('http://localhost:3000/auth/callback', 'abc123');

      expect(url).toContain('state=abc123');
    });

    it('throws error when client ID is not configured', () => {
      delete process.env.BASECAMP_CLIENT_ID;

      expect(() => getAuthorizationUrl('http://localhost:3000/auth/callback'))
        .toThrow('BASECAMP_CLIENT_ID not configured');
    });
  });

  describe('isTokenExpired', () => {
    it('returns true when no expiration is set', () => {
      delete process.env.BASECAMP_TOKEN_EXPIRES_AT;
      expect(isTokenExpired()).toBe(true);
    });

    it('returns true for expired tokens', () => {
      // Set expiration to 1 hour ago
      const pastTime = Date.now() - 60 * 60 * 1000;
      process.env.BASECAMP_TOKEN_EXPIRES_AT = pastTime.toString();
      expect(isTokenExpired()).toBe(true);
    });

    it('returns true for tokens expiring within 5 minutes', () => {
      // Set expiration to 3 minutes from now
      const nearFuture = Date.now() + 3 * 60 * 1000;
      process.env.BASECAMP_TOKEN_EXPIRES_AT = nearFuture.toString();
      expect(isTokenExpired()).toBe(true);
    });

    it('returns false for valid tokens', () => {
      // Set expiration to 1 hour from now
      const futureTime = Date.now() + 60 * 60 * 1000;
      process.env.BASECAMP_TOKEN_EXPIRES_AT = futureTime.toString();
      expect(isTokenExpired()).toBe(false);
    });

    it('returns true for NaN expiration values', () => {
      process.env.BASECAMP_TOKEN_EXPIRES_AT = 'not-a-number';
      expect(isTokenExpired()).toBe(true);
    });

    it('returns true for zero or negative expiration values', () => {
      process.env.BASECAMP_TOKEN_EXPIRES_AT = '0';
      expect(isTokenExpired()).toBe(true);

      process.env.BASECAMP_TOKEN_EXPIRES_AT = '-1000';
      expect(isTokenExpired()).toBe(true);
    });

    it('returns true for empty string expiration', () => {
      process.env.BASECAMP_TOKEN_EXPIRES_AT = '';
      expect(isTokenExpired()).toBe(true);
    });
  });

  describe('hasBasecampCredentials', () => {
    it('returns true when both client ID and secret are set', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-id';
      process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
      expect(hasBasecampCredentials()).toBe(true);
    });

    it('returns false when client ID is missing', () => {
      delete process.env.BASECAMP_CLIENT_ID;
      process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
      expect(hasBasecampCredentials()).toBe(false);
    });

    it('returns false when client secret is missing', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-id';
      delete process.env.BASECAMP_CLIENT_SECRET;
      expect(hasBasecampCredentials()).toBe(false);
    });

    it('returns false when both are missing', () => {
      delete process.env.BASECAMP_CLIENT_ID;
      delete process.env.BASECAMP_CLIENT_SECRET;
      expect(hasBasecampCredentials()).toBe(false);
    });
  });

  describe('hasBasecampTokens', () => {
    it('returns true when both tokens are set', () => {
      process.env.BASECAMP_ACCESS_TOKEN = 'test-access-token';
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh-token';
      expect(hasBasecampTokens()).toBe(true);
    });

    it('returns false when access token is missing', () => {
      delete process.env.BASECAMP_ACCESS_TOKEN;
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh-token';
      expect(hasBasecampTokens()).toBe(false);
    });

    it('returns false when refresh token is missing', () => {
      process.env.BASECAMP_ACCESS_TOKEN = 'test-access-token';
      delete process.env.BASECAMP_REFRESH_TOKEN;
      expect(hasBasecampTokens()).toBe(false);
    });
  });

  describe('hasGeminiKey', () => {
    it('returns true when Gemini API key is set', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      expect(hasGeminiKey()).toBe(true);
    });

    it('returns false when Gemini API key is missing', () => {
      delete process.env.GEMINI_API_KEY;
      expect(hasGeminiKey()).toBe(false);
    });

    it('returns false for empty string', () => {
      process.env.GEMINI_API_KEY = '';
      expect(hasGeminiKey()).toBe(false);
    });
  });

  describe('getCredentialStatus', () => {
    it('returns isComplete true when all credentials are set', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-id';
      process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
      process.env.BASECAMP_ACCESS_TOKEN = 'test-access-token';
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh-token';
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      const status = getCredentialStatus();
      expect(status.isComplete).toBe(true);
      expect(status.hasBasecampCredentials).toBe(true);
      expect(status.hasBasecampTokens).toBe(true);
      expect(status.hasGeminiKey).toBe(true);
    });

    it('returns isComplete false when Basecamp credentials missing', () => {
      delete process.env.BASECAMP_CLIENT_ID;
      delete process.env.BASECAMP_CLIENT_SECRET;
      process.env.BASECAMP_ACCESS_TOKEN = 'test-access-token';
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh-token';
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      const status = getCredentialStatus();
      expect(status.isComplete).toBe(false);
      expect(status.hasBasecampCredentials).toBe(false);
    });

    it('returns isComplete false when tokens missing', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-id';
      process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
      delete process.env.BASECAMP_ACCESS_TOKEN;
      delete process.env.BASECAMP_REFRESH_TOKEN;
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      const status = getCredentialStatus();
      expect(status.isComplete).toBe(false);
      expect(status.hasBasecampTokens).toBe(false);
    });

    it('returns isComplete false when Gemini key missing', () => {
      process.env.BASECAMP_CLIENT_ID = 'test-id';
      process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
      process.env.BASECAMP_ACCESS_TOKEN = 'test-access-token';
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh-token';
      delete process.env.GEMINI_API_KEY;

      const status = getCredentialStatus();
      expect(status.isComplete).toBe(false);
      expect(status.hasGeminiKey).toBe(false);
    });

    it('returns all false when nothing is set', () => {
      delete process.env.BASECAMP_CLIENT_ID;
      delete process.env.BASECAMP_CLIENT_SECRET;
      delete process.env.BASECAMP_ACCESS_TOKEN;
      delete process.env.BASECAMP_REFRESH_TOKEN;
      delete process.env.GEMINI_API_KEY;

      const status = getCredentialStatus();
      expect(status.isComplete).toBe(false);
      expect(status.hasBasecampCredentials).toBe(false);
      expect(status.hasBasecampTokens).toBe(false);
      expect(status.hasGeminiKey).toBe(false);
    });
  });
});

// Test escapeRegex behavior through getAuthorizationUrl
// The escapeRegex function is private but we can verify its behavior
describe('Regex escaping (security)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('handles client IDs with special regex characters', () => {
    // If special chars weren't escaped, this could cause issues
    process.env.BASECAMP_CLIENT_ID = 'test.id+with*special(chars)';

    // Should not throw
    const url = getAuthorizationUrl('http://localhost:3000/callback');
    expect(url).toContain('client_id=test.id%2Bwith*special%28chars%29');
  });
});
