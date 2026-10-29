import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEWriter, createSSEWriter } from '../src/utils/sse.js';
import type { Response } from 'express';

// Mock Express Response
function createMockResponse(): Response {
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
    on: vi.fn(),
    socket: { destroyed: false, writable: true },
  };
  return res as unknown as Response;
}

describe('SSEWriter', () => {
  let mockRes: Response;
  let writer: SSEWriter;

  beforeEach(() => {
    mockRes = createMockResponse();
    writer = new SSEWriter(mockRes);
  });

  describe('init', () => {
    it('sets Content-Type header to text/event-stream', () => {
      writer.init();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('sets Cache-Control header to no-cache', () => {
      writer.init();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });

    it('sets Connection header to keep-alive', () => {
      writer.init();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });

    it('flushes headers to client', () => {
      writer.init();
      expect(mockRes.flushHeaders).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('writes event name and data in SSE format', () => {
      writer.send('phase', { phase: 'parsing', description: 'test' });

      expect(mockRes.write).toHaveBeenCalledWith('event: phase\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: {"phase":"parsing","description":"test"}\n\n');
    });

    it('does not write when connection is closed', () => {
      writer.close();
      writer.send('phase', { phase: 'parsing', description: 'test' });

      // Only end() should have been called from close(), not write()
      expect(mockRes.write).not.toHaveBeenCalled();
    });
  });

  describe('sendPhase', () => {
    it('sends phase event with phase and description', () => {
      writer.sendPhase('fetching', 'Fetching threads...');

      expect(mockRes.write).toHaveBeenCalledWith('event: phase\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: {"phase":"fetching","description":"Fetching threads..."}\n\n');
    });
  });

  describe('sendProgress', () => {
    it('sends progress event with current, total, and phase', () => {
      writer.sendProgress(5, 10, 'fetching');

      expect(mockRes.write).toHaveBeenCalledWith('event: progress\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: {"current":5,"total":10,"phase":"fetching"}\n\n');
    });

    it('includes thread when provided', () => {
      writer.sendProgress(3, 10, 'summarizing', 'Task Title');

      expect(mockRes.write).toHaveBeenCalledWith('data: {"current":3,"total":10,"phase":"summarizing","thread":"Task Title"}\n\n');
    });
  });

  describe('sendContent', () => {
    it('sends content event with chunk string', () => {
      writer.sendContent('# Report\n\nThis is content.');

      expect(mockRes.write).toHaveBeenCalledWith('event: content\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: "# Report\\n\\nThis is content."\n\n');
    });
  });

  describe('sendComplete', () => {
    it('sends complete event with stats', () => {
      writer.sendComplete(10, 2, 5000);

      expect(mockRes.write).toHaveBeenCalledWith('event: complete\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: {"threads":10,"errors":2,"duration":5}\n\n');
    });

    it('rounds duration to one decimal place', () => {
      writer.sendComplete(5, 0, 3456);

      expect(mockRes.write).toHaveBeenCalledWith('data: {"threads":5,"errors":0,"duration":3.5}\n\n');
    });

    it('handles sub-second durations', () => {
      writer.sendComplete(1, 0, 500);

      expect(mockRes.write).toHaveBeenCalledWith('data: {"threads":1,"errors":0,"duration":0.5}\n\n');
    });
  });

  describe('sendError', () => {
    it('sends error event with message', () => {
      writer.sendError('Something went wrong');

      expect(mockRes.write).toHaveBeenCalledWith('event: error\n');
      expect(mockRes.write).toHaveBeenCalledWith('data: {"message":"Something went wrong"}\n\n');
    });
  });

  describe('close', () => {
    it('ends the response', () => {
      writer.close();
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('sets closed flag', () => {
      expect(writer.isClosed()).toBe(false);
      writer.close();
      expect(writer.isClosed()).toBe(true);
    });

    it('only ends response once on multiple close calls', () => {
      writer.close();
      writer.close();
      writer.close();

      expect(mockRes.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('isClosed', () => {
    it('returns false initially', () => {
      expect(writer.isClosed()).toBe(false);
    });

    it('returns true after close', () => {
      writer.close();
      expect(writer.isClosed()).toBe(true);
    });
  });
});

describe('createSSEWriter', () => {
  it('creates and initializes an SSE writer', () => {
    const mockRes = createMockResponse();
    const writer = createSSEWriter(mockRes);

    expect(writer).toBeInstanceOf(SSEWriter);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(mockRes.flushHeaders).toHaveBeenCalled();
  });
});
