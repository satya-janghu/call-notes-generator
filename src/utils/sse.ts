/**
 * Server-Sent Events (SSE) utilities
 */

import type { Response } from 'express';

/**
 * SSE event types used by the application
 */
export type SSEEventType = 'phase' | 'progress' | 'content' | 'complete' | 'error';

/**
 * Phase event data
 */
export interface PhaseEvent {
  phase: 'parsing' | 'fetching' | 'summarizing' | 'compiling';
  description: string;
}

/**
 * Progress event data
 */
export interface ProgressEvent {
  current: number;
  total: number;
  thread?: string;
  phase: 'fetching' | 'summarizing';
}

/**
 * Complete event data
 */
export interface CompleteEvent {
  threads: number;
  errors: number;
  duration: number;
}

/**
 * Error event data
 */
export interface ErrorEvent {
  message: string;
}

/**
 * Union type for all SSE event data
 */
export type SSEEventData = PhaseEvent | ProgressEvent | CompleteEvent | ErrorEvent | string;

/**
 * SSE Writer class for managing Server-Sent Events responses
 */
export class SSEWriter {
  private res: Response;
  private closed = false;
  private writeError = false;

  constructor(res: Response) {
    this.res = res;
  }

  /**
   * Initialize SSE headers and flush to client.
   * Sets up event listeners to detect client disconnection.
   */
  init(): void {
    this.res.setHeader('Content-Type', 'text/event-stream');
    this.res.setHeader('Cache-Control', 'no-cache');
    this.res.setHeader('Connection', 'keep-alive');

    // Detect client disconnection
    this.res.on('close', () => {
      if (!this.closed) {
        console.log('[sse] Client disconnected');
        this.closed = true;
      }
    });

    this.res.on('error', (err) => {
      console.error('[sse] Response error:', err.message);
      this.writeError = true;
      this.closed = true;
    });

    this.res.flushHeaders();
  }

  /**
   * Send an SSE event to the client.
   * Includes error handling for failed writes.
   * @returns true if write succeeded, false if it failed or connection is closed
   */
  send(event: SSEEventType, data: SSEEventData): boolean {
    if (this.closed || this.writeError) {
      return false;
    }

    try {
      // Check if the socket is still writable
      const socket = this.res.socket;
      if (!socket || socket.destroyed || !socket.writable) {
        console.warn('[sse] Socket not writable, marking connection as closed');
        this.closed = true;
        return false;
      }

      const eventLine = `event: ${event}\n`;
      const dataLine = `data: ${JSON.stringify(data)}\n\n`;

      const eventWritten = this.res.write(eventLine);
      const dataWritten = this.res.write(dataLine);

      if (!eventWritten || !dataWritten) {
        // Buffer is full but write will complete eventually
        // This isn't necessarily an error, just backpressure
        console.warn('[sse] Write buffer full, backpressure detected');
      }

      return true;
    } catch (error) {
      console.error('[sse] Write failed:', error instanceof Error ? error.message : 'Unknown error');
      this.writeError = true;
      this.closed = true;
      return false;
    }
  }

  /**
   * Send a phase update event
   */
  sendPhase(phase: PhaseEvent['phase'], description: string): void {
    this.send('phase', { phase, description });
  }

  /**
   * Send a progress update event
   */
  sendProgress(current: number, total: number, phase: ProgressEvent['phase'], thread?: string): void {
    this.send('progress', { current, total, phase, thread });
  }

  /**
   * Send content chunk (for streaming)
   */
  sendContent(chunk: string): void {
    this.send('content', chunk);
  }

  /**
   * Send completion event with stats
   */
  sendComplete(threads: number, errors: number, durationMs: number): void {
    const duration = Math.round((durationMs / 1000) * 10) / 10;
    this.send('complete', { threads, errors, duration });
  }

  /**
   * Send error event
   */
  sendError(message: string): void {
    this.send('error', { message });
  }

  /**
   * Close the SSE connection safely
   */
  close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.res.end();
      } catch (error) {
        // Ignore errors when closing - connection may already be gone
        console.warn('[sse] Error during close:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  /**
   * Check if connection is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Check if there was a write error (client likely disconnected)
   */
  hasWriteError(): boolean {
    return this.writeError;
  }
}

/**
 * Create and initialize an SSE writer for a response
 */
export function createSSEWriter(res: Response): SSEWriter {
  const writer = new SSEWriter(res);
  writer.init();
  return writer;
}
