/**
 * Basecamp API client with rate limiting and error handling
 */

import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { ensureValidToken, refreshAccessToken } from './auth.js';
import { getErrorDetails } from '../../utils/validation.js';
import { fetchWithTimeout, TimeoutError } from '../../utils/timeout.js';
import { CONFIG } from '../../config.js';
import type { BasecampTodo, BasecampMessage, BasecampComment } from './types.js';
import type { ThreadData, ThreadComment, ParsedUrl } from '../../types.js';

const BASECAMP_API_BASE = 'https://3.basecampapi.com';
const USER_AGENT = 'CallNotesGenerator (https://github.com/satya-janghu/call-notes-generator)';

// Rate limiting: 10 concurrent requests (Basecamp allows 50 per 10 seconds)
const limit = pLimit(10);

// Mutex for token refresh to prevent race conditions
let tokenRefreshPromise: Promise<void> | null = null;

/** Refresh token with mutex to prevent concurrent refresh attempts */
async function refreshTokenWithMutex(): Promise<void> {
  if (!tokenRefreshPromise) {
    tokenRefreshPromise = refreshAccessToken().finally(() => {
      tokenRefreshPromise = null;
    });
  }
  return tokenRefreshPromise;
}

/** Make an authenticated request to Basecamp API with timeout */
async function basecampFetch<T>(
  path: string,
  accountId: string,
  retryOn401 = true
): Promise<T> {
  const token = await ensureValidToken();
  const url = `${BASECAMP_API_BASE}/${accountId}${path}`;

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
    },
    CONFIG.timeouts.basecampApi
  );

  if (response.status === 401 && retryOn401) {
    // Token might have expired during request, refresh with mutex and retry once
    await refreshTokenWithMutex();
    return basecampFetch<T>(path, accountId, false);
  }

  if (response.status === 404) {
    throw new Error('NOT_FOUND');
  }

  if (response.status === 429) {
    // Rate limited - extract retry-after header if available
    const retryAfter = response.headers.get('Retry-After');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10000;
    await sleep(waitMs);
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    // Log full error for debugging, but don't expose in thrown error
    const text = await response.text();
    console.error(getErrorDetails(new Error(`Basecamp API: ${response.status} ${text}`), 'basecampFetch'));
    throw new Error(`Basecamp API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

/** Sleep for specified milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fetch a todo by ID */
export async function getTodo(
  accountId: string,
  projectId: string,
  todoId: string
): Promise<BasecampTodo> {
  return basecampFetch<BasecampTodo>(
    `/buckets/${projectId}/todos/${todoId}.json`,
    accountId
  );
}

/** Fetch a message by ID */
export async function getMessage(
  accountId: string,
  projectId: string,
  messageId: string
): Promise<BasecampMessage> {
  return basecampFetch<BasecampMessage>(
    `/buckets/${projectId}/messages/${messageId}.json`,
    accountId
  );
}

/** Fetch comments for a recording */
export async function getComments(
  accountId: string,
  projectId: string,
  recordingId: string
): Promise<BasecampComment[]> {
  return basecampFetch<BasecampComment[]>(
    `/buckets/${projectId}/recordings/${recordingId}/comments.json`,
    accountId
  );
}

/** Strip HTML tags and decode entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Anonymize creator names as "Person A", "Person B", etc. */
function anonymizeCreators(comments: BasecampComment[]): Map<number, string> {
  const creatorMap = new Map<number, string>();
  let labelIndex = 0;

  for (const comment of comments) {
    if (!creatorMap.has(comment.creator.id)) {
      creatorMap.set(comment.creator.id, `Person ${String.fromCharCode(65 + labelIndex)}`);
      labelIndex++;
    }
  }

  return creatorMap;
}

/** Fetch full thread data for a parsed URL */
export async function fetchThreadData(parsedUrl: ParsedUrl): Promise<ThreadData> {
  const { accountId, projectId, recordingId, type, url } = parsedUrl;

  try {
    // Fetch main content and comments in parallel using Promise.allSettled
    // This ensures comments failure doesn't lose the main content
    const [mainContentResult, commentsResult] = await Promise.allSettled([
      type === 'todos'
        ? getTodo(accountId, projectId, recordingId)
        : getMessage(accountId, projectId, recordingId),
      getComments(accountId, projectId, recordingId),
    ]);

    // If main content failed, throw the error
    if (mainContentResult.status === 'rejected') {
      throw mainContentResult.reason;
    }
    const mainContent = mainContentResult.value;

    // If comments failed, use empty array but log the warning
    let comments: BasecampComment[] = [];
    if (commentsResult.status === 'fulfilled') {
      comments = commentsResult.value;
    } else {
      console.warn(`[basecamp] Failed to fetch comments for ${url}: ${commentsResult.reason}`);
    }

    // Anonymize creator names
    const creatorMap = anonymizeCreators(comments);

    // Format comments
    const formattedComments: ThreadComment[] = comments.map(comment => ({
      content: stripHtml(comment.content),
      createdAt: comment.created_at,
      creatorLabel: creatorMap.get(comment.creator.id) || 'Person',
    }));

    // Build thread data based on type
    if (type === 'todos') {
      const todo = mainContent as BasecampTodo;
      return {
        url,
        type: 'todos',
        title: todo.title,
        completed: todo.completed,
        dueOn: todo.due_on,
        description: stripHtml(todo.description || todo.content || ''),
        comments: formattedComments,
        accountId,
        projectId,
        recordingId,
      };
    } else {
      const message = mainContent as BasecampMessage;
      return {
        url,
        type: 'messages',
        title: message.subject || message.title,
        completed: false,
        dueOn: null,
        description: stripHtml(message.content || ''),
        comments: formattedComments,
        accountId,
        projectId,
        recordingId,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      // Return placeholder for deleted/moved threads
      return {
        url,
        type,
        title: 'Thread Not Found',
        completed: false,
        dueOn: null,
        description: 'This thread may have been deleted or moved. Please verify manually.',
        comments: [],
        accountId,
        projectId,
        recordingId,
      };
    }
    throw error;
  }
}

/** Fetch all threads with rate limiting and progress callback */
export async function fetchAllThreads(
  parsedUrls: ParsedUrl[],
  onProgress?: (current: number, total: number, thread: string) => void
): Promise<{ threads: ThreadData[]; errors: Array<{ url: string; error: string }> }> {
  const threads: ThreadData[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  let completed = 0;

  const fetchWithRetry = async (parsedUrl: ParsedUrl): Promise<void> => {
    try {
      const thread = await pRetry(
        () => fetchThreadData(parsedUrl),
        {
          retries: 2,
          shouldRetry: (error) => {
            // Don't retry 404s - the resource doesn't exist
            if (error.message === 'NOT_FOUND') {
              return false;
            }
            // Don't retry timeout errors - likely to timeout again
            if (error instanceof TimeoutError) {
              return false;
            }
            return true;
          },
          onFailedAttempt: (error) => {
            console.warn(`[basecamp] Retry attempt for ${parsedUrl.url}: ${error.message}`);
          },
        }
      );
      threads.push(thread);
    } catch (error) {
      errors.push({
        url: parsedUrl.url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, parsedUrls.length, parsedUrl.url);
      }
    }
  };

  // Execute with concurrency limit
  await Promise.all(
    parsedUrls.map(parsedUrl => limit(() => fetchWithRetry(parsedUrl)))
  );

  return { threads, errors };
}
