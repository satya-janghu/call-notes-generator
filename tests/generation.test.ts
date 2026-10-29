import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCallNotes, type GenerationInput, type GenerationResult } from '../src/services/generation.js';
import type { SSEWriter } from '../src/utils/sse.js';
import type { ThreadData, ParsedUrl } from '../src/types.js';

// Mock all dependencies
vi.mock('../src/utils/parser.js', () => ({
  parseActivityLog: vi.fn(),
  parsePreviousNotes: vi.fn(() => []),
  extractProjectId: vi.fn((url: string) => {
    const match = url.match(/buckets\/(\d+)/);
    return match ? match[1] : null;
  }),
  stripBase64Images: vi.fn((text: string) => text),
  extractJointBasecampUrls: vi.fn(() => []),
  truncateContent: vi.fn((text: string) => text), // Pass through unchanged in tests
}));

vi.mock('../src/services/basecamp/client.js', () => ({
  fetchAllThreads: vi.fn(),
}));

vi.mock('../src/services/gemini/summarize.js', () => ({
  summarizeAllThreads: vi.fn(),
}));

vi.mock('../src/services/gemini/compile.js', () => ({
  compileReportStreaming: vi.fn(),
}));

// Import mocked modules
import { parseActivityLog, extractProjectId, extractJointBasecampUrls, stripBase64Images } from '../src/utils/parser.js';
import { fetchAllThreads } from '../src/services/basecamp/client.js';
import { summarizeAllThreads } from '../src/services/gemini/summarize.js';
import { compileReportStreaming } from '../src/services/gemini/compile.js';

// Create mock SSE writer
function createMockSSEWriter(): SSEWriter & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  return {
    calls,
    init: vi.fn(() => calls.push({ method: 'init', args: [] })),
    send: vi.fn((...args) => calls.push({ method: 'send', args })),
    sendPhase: vi.fn((...args) => calls.push({ method: 'sendPhase', args })),
    sendProgress: vi.fn((...args) => calls.push({ method: 'sendProgress', args })),
    sendContent: vi.fn((...args) => calls.push({ method: 'sendContent', args })),
    sendComplete: vi.fn((...args) => calls.push({ method: 'sendComplete', args })),
    sendError: vi.fn((...args) => calls.push({ method: 'sendError', args })),
    close: vi.fn(() => calls.push({ method: 'close', args: [] })),
    isClosed: vi.fn(() => false),
  } as unknown as SSEWriter & { calls: Array<{ method: string; args: unknown[] }> };
}

// Sample test data
const sampleParsedUrl: ParsedUrl = {
  accountId: '123',
  projectId: '456',
  recordingId: '789',
  type: 'todos',
  url: 'https://3.basecamp.com/123/buckets/456/todos/789',
};

const sampleThread: ThreadData = {
  title: 'Test Todo',
  description: 'Test description',
  completed: false,
  type: 'todos',
  url: 'https://3.basecamp.com/123/buckets/456/todos/789',
  accountId: '123',
  projectId: '456',
  recordingId: '789',
  comments: [],
};

describe('generateCallNotes', () => {
  let mockSSE: SSEWriter & { calls: Array<{ method: string; args: unknown[] }> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSSE = createMockSSEWriter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Phase 1: Parsing', () => {
    it('returns error when no URLs found in activity log', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([]);

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'no urls here',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.success).toBe(false);
      expect(result.threads).toBe(0);
      expect(result.errors).toBe(1);
      expect(mockSSE.sendError).toHaveBeenCalledWith(
        expect.stringContaining('No Basecamp thread URLs found')
      );
    });

    it('sends parsing phase event', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([]);

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendPhase).toHaveBeenCalledWith(
        'parsing',
        'Extracting thread URLs from activity log...'
      );
    });

    it('strips base64 images from previous notes', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({ threads: [], errors: [] });

      const input: GenerationInput = {
        previousNotes: '![image](data:image/png;base64,abc123)',
        activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(stripBase64Images).toHaveBeenCalledWith(input.previousNotes);
    });

    it('extracts joint project ID from URL when provided', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({ threads: [], errors: [] });

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789',
        jointBasecampUrl: 'https://3.basecamp.com/123/buckets/999/todos/111',
      };

      await generateCallNotes(input, mockSSE);

      expect(extractProjectId).toHaveBeenCalledWith('https://3.basecamp.com/123/buckets/999/todos/111');
    });

    it('extracts joint project ID from previous notes when URL not provided', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({ threads: [], errors: [] });
      vi.mocked(extractJointBasecampUrls).mockReturnValue([
        'https://3.basecamp.com/123/buckets/888/todos/111',
      ]);

      const input: GenerationInput = {
        previousNotes: 'Previous notes with [Joint Basecamp](https://3.basecamp.com/123/buckets/888/todos/111)',
        activityLog: 'https://3.basecamp.com/123/buckets/456/todos/789',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(extractJointBasecampUrls).toHaveBeenCalled();
    });
  });

  describe('Phase 2: Fetching', () => {
    it('sends fetching phase event with thread count', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl, sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({ threads: [], errors: [] });

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test activity log',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendPhase).toHaveBeenCalledWith(
        'fetching',
        'Fetching 2 threads from Basecamp...'
      );
    });

    it('returns error when all fetches fail', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [],
        errors: [{ url: sampleParsedUrl.url, error: 'Network error' }],
      });

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.success).toBe(false);
      expect(result.errors).toBe(1);
      expect(mockSSE.sendError).toHaveBeenCalledWith(
        'Failed to fetch any threads from Basecamp.'
      );
    });

    it('counts fetch errors in result', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl, sampleParsedUrl, sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [
          { url: 'url1', error: 'error1' },
          { url: 'url2', error: 'error2' },
        ],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.errors).toBe(2);
    });
  });

  describe('Phase 3: Summarizing', () => {
    it('sends summarizing phase event', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread, sampleThread, sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendPhase).toHaveBeenCalledWith(
        'summarizing',
        'Summarizing 3 threads with AI...'
      );
    });

    it('counts summarize errors in result', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({
        summaries: [],
        errors: [
          { thread: 'thread1', error: 'AI error 1' },
          { thread: 'thread2', error: 'AI error 2' },
          { thread: 'thread3', error: 'AI error 3' },
        ],
      });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.errors).toBe(3);
    });
  });

  describe('Phase 4: Compiling', () => {
    it('sends compiling phase event', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendPhase).toHaveBeenCalledWith(
        'compiling',
        'Compiling final report...'
      );
    });

    it('streams content chunks to SSE', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockImplementation(async (_summaries, onChunk) => {
        onChunk('# Report\n');
        onChunk('## SEO/DEV\n');
        onChunk('- Task 1\n');
      });

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendContent).toHaveBeenCalledWith('# Report\n');
      expect(mockSSE.sendContent).toHaveBeenCalledWith('## SEO/DEV\n');
      expect(mockSSE.sendContent).toHaveBeenCalledWith('- Task 1\n');
    });
  });

  describe('Completion', () => {
    it('returns success with correct thread count', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread, sampleThread, sampleThread, sampleThread, sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.success).toBe(true);
      expect(result.threads).toBe(5);
    });

    it('sends complete event with correct stats', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread, sampleThread],
        errors: [{ url: 'url', error: 'error' }],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({
        summaries: [],
        errors: [{ thread: 't', error: 'e' }],
      });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      expect(mockSSE.sendComplete).toHaveBeenCalledWith(
        2, // threads
        2, // errors (1 fetch + 1 summarize)
        expect.any(Number) // duration
      );
    });

    it('calculates duration correctly', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { threads: [sampleThread], errors: [] };
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
    });

    it('executes all 4 phases in order', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({ summaries: [], errors: [] });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      await generateCallNotes(input, mockSSE);

      // Check phase calls in order
      const phaseCalls = mockSSE.calls.filter((c) => c.method === 'sendPhase');
      expect(phaseCalls).toHaveLength(4);
      expect(phaseCalls[0].args[0]).toBe('parsing');
      expect(phaseCalls[1].args[0]).toBe('fetching');
      expect(phaseCalls[2].args[0]).toBe('summarizing');
      expect(phaseCalls[3].args[0]).toBe('compiling');
    });

    it('accumulates errors from both fetch and summarize phases', async () => {
      vi.mocked(parseActivityLog).mockReturnValue([sampleParsedUrl]);
      vi.mocked(fetchAllThreads).mockResolvedValue({
        threads: [sampleThread],
        errors: [
          { url: 'url1', error: 'fetch error 1' },
          { url: 'url2', error: 'fetch error 2' },
        ],
      });
      vi.mocked(summarizeAllThreads).mockResolvedValue({
        summaries: [],
        errors: [
          { thread: 't1', error: 'summarize error 1' },
          { thread: 't2', error: 'summarize error 2' },
          { thread: 't3', error: 'summarize error 3' },
        ],
      });
      vi.mocked(compileReportStreaming).mockResolvedValue();

      const input: GenerationInput = {
        previousNotes: '',
        activityLog: 'test',
        jointBasecampUrl: '',
      };

      const result = await generateCallNotes(input, mockSSE);

      expect(result.errors).toBe(5); // 2 fetch + 3 summarize
    });
  });
});
