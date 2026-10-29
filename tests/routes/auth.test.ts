import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import authRoutes from '../../src/routes/auth.js';

// Mock dependencies
vi.mock('../../src/services/basecamp/auth.js', () => ({
  getAuthorizationUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  saveTokens: vi.fn(),
  getCredentialStatus: vi.fn(),
  saveBasecampCredentials: vi.fn(),
  saveGeminiKey: vi.fn(),
  hasBasecampCredentials: vi.fn(),
}));

// Import mocked modules
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  saveTokens,
  getCredentialStatus,
  saveBasecampCredentials,
  saveGeminiKey,
  hasBasecampCredentials,
} from '../../src/services/basecamp/auth.js';

describe('Auth Routes', () => {
  let app: Express;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    // Create fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('GET /auth/status', () => {
    it('returns credential status', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });

      const response = await request(app)
        .get('/auth/status')
        .expect(200);

      expect(response.body).toEqual({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      expect(getCredentialStatus).toHaveBeenCalled();
    });

    it('returns incomplete status when credentials missing', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: false,
        hasBasecampCredentials: false,
        hasBasecampTokens: false,
        hasGeminiKey: false,
      });

      const response = await request(app)
        .get('/auth/status')
        .expect(200);

      expect(response.body.isComplete).toBe(false);
    });
  });

  describe('POST /auth/basecamp-credentials', () => {
    it('saves valid credentials', async () => {
      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientId: 'test-id', clientSecret: 'test-secret' })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(saveBasecampCredentials).toHaveBeenCalledWith('test-id', 'test-secret');
    });

    it('trims whitespace from credentials', async () => {
      await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientId: '  test-id  ', clientSecret: '  test-secret  ' })
        .expect(200);

      expect(saveBasecampCredentials).toHaveBeenCalledWith('test-id', 'test-secret');
    });

    it('returns 400 when client ID is missing', async () => {
      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientSecret: 'test-secret' })
        .expect(400);

      expect(response.body).toEqual({ error: 'Client ID and Client Secret are required' });
      expect(saveBasecampCredentials).not.toHaveBeenCalled();
    });

    it('returns 400 when client secret is missing', async () => {
      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientId: 'test-id' })
        .expect(400);

      expect(response.body).toEqual({ error: 'Client ID and Client Secret are required' });
    });

    it('returns 400 when both are missing', async () => {
      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'Client ID and Client Secret are required' });
    });

    it('returns 500 when save fails', async () => {
      vi.mocked(saveBasecampCredentials).mockImplementation(() => {
        throw new Error('Write failed');
      });

      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientId: 'test-id', clientSecret: 'test-secret' })
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to save credentials' });
    });
  });

  describe('GET /auth/setup', () => {
    it('redirects to Basecamp OAuth when credentials exist', async () => {
      vi.mocked(hasBasecampCredentials).mockReturnValue(true);
      vi.mocked(getAuthorizationUrl).mockReturnValue('https://launchpad.37signals.com/authorization/new?client_id=test');

      const response = await request(app)
        .get('/auth/setup')
        .expect(302);

      expect(response.headers.location).toBe('https://launchpad.37signals.com/authorization/new?client_id=test');
      expect(getAuthorizationUrl).toHaveBeenCalled();
    });

    it('redirects to setup.html with error when credentials missing', async () => {
      vi.mocked(hasBasecampCredentials).mockReturnValue(false);

      const response = await request(app)
        .get('/auth/setup')
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=missing_credentials');
      expect(getAuthorizationUrl).not.toHaveBeenCalled();
    });

    it('redirects to setup.html with error when getAuthorizationUrl throws', async () => {
      vi.mocked(hasBasecampCredentials).mockReturnValue(true);
      vi.mocked(getAuthorizationUrl).mockImplementation(() => {
        throw new Error('Invalid client ID');
      });

      const response = await request(app)
        .get('/auth/setup')
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=oauth_start_failed');
    });
  });

  describe('GET /auth/callback', () => {
    /** Start the OAuth flow and return the state value passed to Basecamp */
    async function startOAuth(): Promise<string> {
      vi.mocked(hasBasecampCredentials).mockReturnValue(true);
      vi.mocked(getAuthorizationUrl).mockReturnValue('https://launchpad.37signals.com/authorization/new');
      await request(app).get('/auth/setup').expect(302);
      return vi.mocked(getAuthorizationUrl).mock.calls.at(-1)![1] as string;
    }

    it('exchanges code for tokens and redirects to setup completion', async () => {
      const mockTokens = {
        access_token: 'access123',
        refresh_token: 'refresh123',
        expires_in: 1209600,
      };
      vi.mocked(exchangeCodeForTokens).mockResolvedValue(mockTokens);
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });

      const response = await request(app)
        .get(`/auth/callback?code=test-auth-code&state=${await startOAuth()}`)
        .expect(302);

      expect(response.headers.location).toBe('/?setup=complete');
      expect(exchangeCodeForTokens).toHaveBeenCalledWith('test-auth-code', expect.stringContaining('http://localhost:'));
      expect(saveTokens).toHaveBeenCalledWith(mockTokens);
    });

    it('redirects to Gemini step when Gemini key is missing', async () => {
      const mockTokens = {
        access_token: 'access123',
        refresh_token: 'refresh123',
        expires_in: 1209600,
      };
      vi.mocked(exchangeCodeForTokens).mockResolvedValue(mockTokens);
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: false,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: false,
      });

      const response = await request(app)
        .get(`/auth/callback?code=test-auth-code&state=${await startOAuth()}`)
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?step=gemini');
    });

    it('handles OAuth denied error', async () => {
      const response = await request(app)
        .get('/auth/callback?error=access_denied')
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=oauth_denied');
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it('handles missing code', async () => {
      const response = await request(app)
        .get('/auth/callback')
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=no_code');
    });

    it('handles token exchange failure', async () => {
      vi.mocked(exchangeCodeForTokens).mockRejectedValue(new Error('Token exchange failed'));

      const response = await request(app)
        .get(`/auth/callback?code=bad-code&state=${await startOAuth()}`)
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=token_exchange_failed');
    });

    it('rejects callback with mismatched state', async () => {
      await startOAuth();

      const response = await request(app)
        .get('/auth/callback?code=test-auth-code&state=wrong-state')
        .expect(302);

      expect(response.headers.location).toBe('/setup.html?error=invalid_state');
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/gemini-key', () => {
    it('saves valid API key', async () => {
      const response = await request(app)
        .post('/auth/gemini-key')
        .send({ apiKey: 'test-gemini-key-12345' })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(saveGeminiKey).toHaveBeenCalledWith('test-gemini-key-12345');
    });

    it('trims whitespace from API key', async () => {
      await request(app)
        .post('/auth/gemini-key')
        .send({ apiKey: '  test-gemini-key  ' })
        .expect(200);

      expect(saveGeminiKey).toHaveBeenCalledWith('test-gemini-key');
    });

    it('returns 400 when API key is missing', async () => {
      const response = await request(app)
        .post('/auth/gemini-key')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'API key is required' });
      expect(saveGeminiKey).not.toHaveBeenCalled();
    });

    it('returns 400 when API key is empty string', async () => {
      const response = await request(app)
        .post('/auth/gemini-key')
        .send({ apiKey: '' })
        .expect(400);

      expect(response.body).toEqual({ error: 'API key is required' });
    });

    it('returns 500 when save fails', async () => {
      vi.mocked(saveGeminiKey).mockImplementation(() => {
        throw new Error('Write failed');
      });

      const response = await request(app)
        .post('/auth/gemini-key')
        .send({ apiKey: 'test-key' })
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to save API key' });
    });
  });

  describe('POST /auth/disconnect', () => {
    it('clears tokens from process.env', async () => {
      process.env.BASECAMP_ACCESS_TOKEN = 'test-token';
      process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh';
      process.env.BASECAMP_TOKEN_EXPIRES_AT = '1234567890';

      const response = await request(app)
        .post('/auth/disconnect')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(process.env.BASECAMP_ACCESS_TOKEN).toBeUndefined();
      expect(process.env.BASECAMP_REFRESH_TOKEN).toBeUndefined();
      expect(process.env.BASECAMP_TOKEN_EXPIRES_AT).toBeUndefined();
    });

    it('succeeds even when tokens do not exist', async () => {
      delete process.env.BASECAMP_ACCESS_TOKEN;
      delete process.env.BASECAMP_REFRESH_TOKEN;
      delete process.env.BASECAMP_TOKEN_EXPIRES_AT;

      const response = await request(app)
        .post('/auth/disconnect')
        .expect(200);

      expect(response.body).toEqual({ success: true });
    });
  });
});
