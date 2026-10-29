import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllThreads, fetchThreadData } from '../src/services/basecamp/client.js';
import type { ParsedUrl } from '../src/types.js';

// We'll test the exported functions and mock the internal fetch
// Note: The internal functions (stripHtml, anonymizeCreators) are tested indirectly through fetchThreadData

describe('Basecamp Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Set up valid tokens for tests
    process.env.BASECAMP_ACCESS_TOKEN = 'test-token';
    process.env.BASECAMP_REFRESH_TOKEN = 'test-refresh';
    process.env.BASECAMP_TOKEN_EXPIRES_AT = (Date.now() + 60 * 60 * 1000).toString();
    process.env.BASECAMP_CLIENT_ID = 'test-client-id';
    process.env.BASECAMP_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('fetchAllThreads', () => {
    it('returns empty arrays for empty input', async () => {
      const result = await fetchAllThreads([]);
      expect(result.threads).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('calls progress callback with correct values', async () => {
      // Mock fetch to return immediately
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            title: 'Test Todo',
            completed: false,
            due_on: null,
            description: 'Test description',
          }),
        } as Response)
      );

      const parsedUrls: ParsedUrl[] = [
        {
          accountId: '123',
          projectId: '456',
          recordingId: '789',
          type: 'todos',
          url: 'https://3.basecamp.com/123/buckets/456/todos/789',
        },
        {
          accountId: '123',
          projectId: '456',
          recordingId: '790',
          type: 'todos',
          url: 'https://3.basecamp.com/123/buckets/456/todos/790',
        },
      ];

      const progressCalls: Array<{ current: number; total: number }> = [];

      await fetchAllThreads(parsedUrls, (current, total) => {
        progressCalls.push({ current, total });
      });

      // Should be called for each URL
      expect(progressCalls).toHaveLength(2);
      // Total should always be 2
      expect(progressCalls.every(p => p.total === 2)).toBe(true);
      // Current should include both 1 and 2 (order may vary due to async)
      const currents = progressCalls.map(p => p.current).sort();
      expect(currents).toContain(1);
      expect(currents).toContain(2);
    });

    it('collects errors without stopping other requests', async () => {
      let callCount = 0;
      vi.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        if (callCount === 1 || callCount === 2) {
          // First call for todo fails, second for comments
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Server error'),
          } as Response);
        }
        // Subsequent calls succeed
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            title: 'Test Todo',
            completed: false,
            due_on: null,
            description: 'Test description',
          }),
        } as Response);
      });

      const parsedUrls: ParsedUrl[] = [
        {
          accountId: '123',
          projectId: '456',
          recordingId: '789',
          type: 'todos',
          url: 'https://3.basecamp.com/123/buckets/456/todos/789',
        },
        {
          accountId: '123',
          projectId: '456',
          recordingId: '790',
          type: 'todos',
          url: 'https://3.basecamp.com/123/buckets/456/todos/790',
        },
      ];

      const result = await fetchAllThreads(parsedUrls);

      // Should have at least one error
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('fetchThreadData', () => {
    it('handles 404 responses gracefully', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response)
      );

      const parsedUrl: ParsedUrl = {
        accountId: '123',
        projectId: '456',
        recordingId: '789',
        type: 'todos',
        url: 'https://3.basecamp.com/123/buckets/456/todos/789',
      };

      const result = await fetchThreadData(parsedUrl);

      expect(result.title).toBe('Thread Not Found');
      expect(result.description).toContain('deleted or moved');
    });

    it('includes url, type, and IDs in result', async () => {
      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/comments.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            title: 'Test Todo',
            completed: true,
            due_on: '2024-01-15',
            description: 'Test description',
          }),
        } as Response);
      });

      const parsedUrl: ParsedUrl = {
        accountId: '123',
        projectId: '456',
        recordingId: '789',
        type: 'todos',
        url: 'https://3.basecamp.com/123/buckets/456/todos/789',
      };

      const result = await fetchThreadData(parsedUrl);

      expect(result.url).toBe(parsedUrl.url);
      expect(result.type).toBe('todos');
      expect(result.accountId).toBe('123');
      expect(result.projectId).toBe('456');
      expect(result.recordingId).toBe('789');
      expect(result.completed).toBe(true);
      expect(result.dueOn).toBe('2024-01-15');
    });

    it('processes message type correctly', async () => {
      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/comments.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            subject: 'Test Message Subject',
            content: '<p>Message content</p>',
          }),
        } as Response);
      });

      const parsedUrl: ParsedUrl = {
        accountId: '123',
        projectId: '456',
        recordingId: '789',
        type: 'messages',
        url: 'https://3.basecamp.com/123/buckets/456/messages/789',
      };

      const result = await fetchThreadData(parsedUrl);

      expect(result.type).toBe('messages');
      expect(result.title).toBe('Test Message Subject');
      expect(result.completed).toBe(false);
    });

    it('anonymizes creator names in comments', async () => {
      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/comments.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([
              { content: 'First comment', created_at: '2024-01-01', creator: { id: 100, name: 'John Doe' } },
              { content: 'Second comment', created_at: '2024-01-02', creator: { id: 200, name: 'Jane Smith' } },
              { content: 'Third comment', created_at: '2024-01-03', creator: { id: 100, name: 'John Doe' } },
            ]),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            title: 'Test Todo',
            completed: false,
            description: 'Test',
          }),
        } as Response);
      });

      const parsedUrl: ParsedUrl = {
        accountId: '123',
        projectId: '456',
        recordingId: '789',
        type: 'todos',
        url: 'https://3.basecamp.com/123/buckets/456/todos/789',
      };

      const result = await fetchThreadData(parsedUrl);

      // Should have 3 comments
      expect(result.comments).toHaveLength(3);

      // First creator should be "Person A"
      expect(result.comments[0].creatorLabel).toBe('Person A');

      // Second creator should be "Person B"
      expect(result.comments[1].creatorLabel).toBe('Person B');

      // Third comment same as first creator should be "Person A"
      expect(result.comments[2].creatorLabel).toBe('Person A');

      // Should not contain actual names
      expect(result.comments.some(c => c.creatorLabel.includes('John'))).toBe(false);
      expect(result.comments.some(c => c.creatorLabel.includes('Jane'))).toBe(false);
    });

    it('strips HTML from content', async () => {
      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/comments.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([
              { content: '<p>Comment with <strong>HTML</strong></p>', created_at: '2024-01-01', creator: { id: 1 } },
            ]),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            title: 'Test Todo',
            completed: false,
            description: '<div>Description with <a href="#">link</a> and &amp; entity</div>',
          }),
        } as Response);
      });

      const parsedUrl: ParsedUrl = {
        accountId: '123',
        projectId: '456',
        recordingId: '789',
        type: 'todos',
        url: 'https://3.basecamp.com/123/buckets/456/todos/789',
      };

      const result = await fetchThreadData(parsedUrl);

      // HTML tags should be stripped
      expect(result.description).not.toContain('<div>');
      expect(result.description).not.toContain('<a');
      expect(result.description).toContain('link');
      expect(result.description).toContain('&');

      // Comments should also have HTML stripped
      expect(result.comments[0].content).not.toContain('<p>');
      expect(result.comments[0].content).not.toContain('<strong>');
      expect(result.comments[0].content).toContain('Comment with');
      expect(result.comments[0].content).toContain('HTML');
    });
  });
});
