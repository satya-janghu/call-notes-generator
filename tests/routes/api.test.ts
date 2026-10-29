import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Response } from 'express';
import request from 'supertest';
import apiRoutes from '../../src/routes/api.js';

// Track created SSE writers
let lastCreatedSSEWriter: ReturnType<typeof createTrackedSSEWriter> | null = null;

// Create a tracked SSE writer that also ends the response
function createTrackedSSEWriter(res: Response) {
  const writer = {
    init: vi.fn(),
    send: vi.fn(),
    sendPhase: vi.fn(),
    sendProgress: vi.fn(),
    sendContent: vi.fn(),
    sendComplete: vi.fn(),
    sendError: vi.fn(),
    close: vi.fn(() => res.end()),
    isClosed: vi.fn(() => false),
    _res: res,
  };
  lastCreatedSSEWriter = writer;
  return writer;
}

// Mock dependencies
vi.mock('../../src/utils/parser.js', () => ({
  getUrlPreview: vi.fn(),
}));

vi.mock('../../src/utils/sse.js', () => ({
  createSSEWriter: vi.fn((res: Response) => createTrackedSSEWriter(res)),
}));

vi.mock('../../src/services/generation.js', () => ({
  generateCallNotes: vi.fn(),
}));

vi.mock('../../src/services/basecamp/auth.js', () => ({
  getCredentialStatus: vi.fn(),
}));

vi.mock('../../src/utils/validation.js', () => ({
  sanitizeError: vi.fn((err) => err instanceof Error ? err.message : String(err)),
}));

// Import mocked modules
import { getUrlPreview } from '../../src/utils/parser.js';
import { createSSEWriter } from '../../src/utils/sse.js';
import { generateCallNotes } from '../../src/services/generation.js';
import { getCredentialStatus } from '../../src/services/basecamp/auth.js';
import { sanitizeError } from '../../src/utils/validation.js';

describe('API Routes', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    lastCreatedSSEWriter = null;

    // Create fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/preview', () => {
    it('returns URL preview stats', async () => {
      vi.mocked(getUrlPreview).mockReturnValue({
        total: 5,
        todos: 3,
        messages: 2,
      });

      const response = await request(app)
        .post('/api/preview')
        .send({ activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789' })
        .expect(200);

      expect(response.body).toEqual({
        total: 5,
        todos: 3,
        messages: 2,
      });
      expect(getUrlPreview).toHaveBeenCalledWith('https://3.basecamp.com/123/buckets/456/todos/789');
    });

    it('returns 400 when activity log is missing', async () => {
      const response = await request(app)
        .post('/api/preview')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'Activity log is required' });
    });

    it('returns 400 when activity log is empty string', async () => {
      const response = await request(app)
        .post('/api/preview')
        .send({ activityLog: '' })
        .expect(400);

      expect(response.body).toEqual({ error: 'Activity log is required' });
    });

    it('returns 400 when activity log is not a string', async () => {
      const response = await request(app)
        .post('/api/preview')
        .send({ activityLog: 123 })
        .expect(400);

      expect(response.body).toEqual({ error: 'Activity log is required' });
    });

    it('handles empty input (zero URLs)', async () => {
      vi.mocked(getUrlPreview).mockReturnValue({
        total: 0,
        todos: 0,
        messages: 0,
      });

      const response = await request(app)
        .post('/api/preview')
        .send({ activityLog: 'no urls here' })
        .expect(200);

      expect(response.body.total).toBe(0);
    });
  });

  describe('POST /api/generate', () => {
    it('returns 401 if credentials not configured', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: false,
        hasBasecampCredentials: false,
        hasBasecampTokens: false,
        hasGeminiKey: false,
      });

      const response = await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' })
        .expect(401);

      expect(response.body).toEqual({
        error: 'Credentials not configured. Please complete setup.',
      });
    });

    it('returns 400 when activity log is missing', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });

      const response = await request(app)
        .post('/api/generate')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'Activity log is required' });
    });

    it('returns 400 when activity log is empty', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });

      const response = await request(app)
        .post('/api/generate')
        .send({ activityLog: '   ' })
        .expect(400);

      expect(response.body).toEqual({ error: 'Activity log is required' });
    });

    it('creates SSE writer for generate request', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockResolvedValue({
        success: true,
        threads: 1,
        errors: 0,
        durationMs: 100,
      });

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789' });

      expect(createSSEWriter).toHaveBeenCalled();
    });

    it('calls generateCallNotes with correct input', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockResolvedValue({
        success: true,
        threads: 1,
        errors: 0,
        durationMs: 100,
      });

      await request(app)
        .post('/api/generate')
        .send({
          activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789',
          previousNotes: '# Previous Notes',
          jointBasecampUrl: 'https://3.basecamp.com/123/buckets/999/todos/111',
        });

      expect(generateCallNotes).toHaveBeenCalledWith(
        {
          previousNotes: '# Previous Notes',
          activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789',
          jointBasecampUrl: 'https://3.basecamp.com/123/buckets/999/todos/111',
        },
        expect.anything()
      );
    });

    it('handles missing previousNotes by defaulting to empty string', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockResolvedValue({
        success: true,
        threads: 1,
        errors: 0,
        durationMs: 100,
      });

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' });

      expect(generateCallNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          previousNotes: '',
          jointBasecampUrl: '',
        }),
        expect.anything()
      );
    });

    it('closes SSE connection after successful generation', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockResolvedValue({
        success: true,
        threads: 1,
        errors: 0,
        durationMs: 100,
      });

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' });

      expect(lastCreatedSSEWriter).not.toBeNull();
      expect(lastCreatedSSEWriter!.close).toHaveBeenCalled();
    });

    it('handles errors gracefully and sends error event', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockRejectedValue(new Error('Test generation error'));

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' });

      expect(lastCreatedSSEWriter).not.toBeNull();
      expect(lastCreatedSSEWriter!.sendError).toHaveBeenCalled();
      expect(sanitizeError).toHaveBeenCalled();
    });

    it('closes SSE connection even on error', async () => {
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockRejectedValue(new Error('Test error'));

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' });

      expect(lastCreatedSSEWriter).not.toBeNull();
      expect(lastCreatedSSEWriter!.close).toHaveBeenCalled();
    });

    it('sanitizes error messages before sending', async () => {
      const testError = new Error('Sensitive token: abc123');
      vi.mocked(getCredentialStatus).mockReturnValue({
        isComplete: true,
        hasBasecampCredentials: true,
        hasBasecampTokens: true,
        hasGeminiKey: true,
      });
      vi.mocked(generateCallNotes).mockRejectedValue(testError);
      vi.mocked(sanitizeError).mockReturnValue('An error occurred');

      await request(app)
        .post('/api/generate')
        .send({ activityLog: 'test activity log' });

      expect(sanitizeError).toHaveBeenCalledWith(testError);
      expect(lastCreatedSSEWriter).not.toBeNull();
      expect(lastCreatedSSEWriter!.sendError).toHaveBeenCalledWith('An error occurred');
    });
  });
});
