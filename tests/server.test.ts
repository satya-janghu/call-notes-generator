import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import type { Express } from 'express';

// Mock the auth module - this affects all files that import from it
vi.mock('../src/services/basecamp/auth.js', () => ({
  getCredentialStatus: vi.fn(() => ({
    isComplete: true,
    hasBasecampCredentials: true,
    hasBasecampTokens: true,
    hasGeminiKey: true,
  })),
  getAuthorizationUrl: vi.fn(() => 'https://example.com/auth'),
  exchangeCodeForTokens: vi.fn(),
  saveTokens: vi.fn(),
  saveBasecampCredentials: vi.fn(),
  saveGeminiKey: vi.fn(),
  hasBasecampCredentials: vi.fn(() => true),
}));

// Import mocked modules
import { getCredentialStatus } from '../src/services/basecamp/auth.js';

describe('Server', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default "complete" status
    vi.mocked(getCredentialStatus).mockReturnValue({
      isComplete: true,
      hasBasecampCredentials: true,
      hasBasecampTokens: true,
      hasGeminiKey: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createApp', () => {
    it('returns an Express app', () => {
      app = createApp();
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
    });

    it('registers health check route', async () => {
      app = createApp();

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('mounts auth routes at /auth', async () => {
      app = createApp();

      const response = await request(app)
        .get('/auth/status')
        .expect(200);

      expect(response.body.isComplete).toBe(true);
    });

    it('mounts api routes at /api', async () => {
      app = createApp();

      // The preview endpoint should be available
      const response = await request(app)
        .post('/api/preview')
        .send({ activityLog: '' })
        .expect(400);

      expect(response.body.error).toBe('Activity log is required');
    });
  });

  describe('GET /', () => {
    it('serves index.html when credentials are configured', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });

      app = createApp();

      const response = await request(app)
        .get('/');

      // Should NOT redirect to setup.html when configured
      expect(response.status).not.toBe(302);
      expect(response.headers.location).toBeUndefined();
    });

    // Note: Testing redirect to setup.html when credentials are incomplete
    // requires module isolation which is complex in vitest due to how ESM caching works.
    // The redirect behavior is already tested in the auth routes tests.
  });

  describe('GET /health', () => {
    it('returns status ok', async () => {
      app = createApp();

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('returns JSON content type', async () => {
      app = createApp();

      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('Body parser limits', () => {
    it('accepts JSON payloads', async () => {
      app = createApp();

      // Test that JSON body parser works
      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .send({ clientId: 'test', clientSecret: 'test' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('parses URL-encoded bodies', async () => {
      app = createApp();

      const response = await request(app)
        .post('/auth/basecamp-credentials')
        .type('form')
        .send('clientId=test&clientSecret=test')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Static file serving', () => {
    it('returns 404 for non-existent static files', async () => {
      app = createApp();

      const response = await request(app)
        .get('/nonexistent-file-12345.txt');

      expect(response.status).toBe(404);
    });
  });
});
