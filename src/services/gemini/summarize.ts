/**
 * Gemini summarization service (Tier 1 - Flash model)
 */

import { GoogleGenAI, Type } from '@google/genai';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { SUMMARIZE_SYSTEM_PROMPT, buildThreadPrompt } from '../../prompts/summarize.js';
import { CONFIG } from '../../config.js';
import { getErrorDetails } from '../../utils/validation.js';
import { parseJsonResponse } from '../../utils/markdown.js';
import { withTimeout, TimeoutError } from '../../utils/timeout.js';
import type { ThreadData, ThreadSummary, PreviousTask } from '../../types.js';

// Concurrency limit for summarization
const limit = pLimit(CONFIG.gemini.summarizeConcurrency);

/** JSON schema for structured output - ensures Gemini returns valid JSON */
const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    url: { type: Type.STRING, description: 'The Basecamp thread URL' },
    title: { type: Type.STRING, description: 'Brief task title (5-10 words)' },
    category: {
      type: Type.STRING,
      description: 'Task category',
      enum: ['SEO/DEV', 'Copywriting', 'Linkbuilding', 'PPC', 'Email Marketing', 'Social Media'],
    },
    status: {
      type: Type.STRING,
      description: 'Current status of the task',
      enum: ['Completed', 'Live', 'In Progress', 'Blocked', 'Upcoming'],
    },
    description: { type: Type.STRING, description: 'Client-facing description of the task' },
    jointBasecampUrl: {
      type: Type.STRING,
      description: 'Joint Basecamp URL if this task references client-visible project',
      nullable: true,
    },
    copyItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          pageName: { type: Type.STRING, description: 'Name of the page' },
          liveUrl: { type: Type.STRING, description: 'Live URL', nullable: true },
          docUrl: { type: Type.STRING, description: 'Doc URL', nullable: true },
          testUrl: { type: Type.STRING, description: 'Test URL', nullable: true },
        },
        required: ['pageName'],
      },
      description: 'List of copy items for copywriting tasks',
    },
    exclude: {
      type: Type.BOOLEAN,
      description: 'Set to true if this task should be excluded from call notes (stale, no meaningful update)',
    },
  },
  required: ['url', 'title', 'category', 'status', 'description'],
} as const;

/** Get the Gemini client */
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenAI({ apiKey });
}

/** Valid category values */
const VALID_CATEGORIES = ['SEO/DEV', 'Copywriting', 'Linkbuilding', 'PPC', 'Email Marketing', 'Social Media'] as const;
type ValidCategory = typeof VALID_CATEGORIES[number];

/** Valid status values */
const VALID_STATUSES = ['Completed', 'Live', 'In Progress', 'Blocked', 'Upcoming'] as const;
type ValidStatus = typeof VALID_STATUSES[number];

/** Check if a string is a valid category */
function isValidCategory(value: unknown): value is ValidCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as ValidCategory);
}

/** Check if a string is a valid status */
function isValidStatus(value: unknown): value is ValidStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as ValidStatus);
}

/** Parse and validate thread summary from Gemini response */
function parseSummaryResponse(text: string): ThreadSummary {
  // Use robust parser that handles markdown wrapping, truncation, and trailing commas
  const parsed = parseJsonResponse<Record<string, unknown>>(text);

  // Validate required fields (schema enforces this, but double-check)
  if (!parsed.url || !parsed.title || !parsed.category || !parsed.status || !parsed.description) {
    throw new Error('Missing required fields in response');
  }

  // Validate category is one of the allowed values
  const category = isValidCategory(parsed.category) ? parsed.category : 'SEO/DEV';

  // Validate status is one of the allowed values
  const status = isValidStatus(parsed.status) ? parsed.status : 'In Progress';

  return {
    url: parsed.url as string,
    title: parsed.title as string,
    category,
    status,
    description: parsed.description as string,
    jointBasecampUrl: (parsed.jointBasecampUrl as string) || null,
    copyItems: (parsed.copyItems as ThreadSummary['copyItems']) || [],
    exclude: Boolean(parsed.exclude),
  };
}

/** Summarize a single thread */
async function summarizeThread(
  thread: ThreadData,
  previousTask: PreviousTask | null,
  isJointProject: boolean,
  currentDate: string
): Promise<ThreadSummary> {
  const client = getClient();
  const userPrompt = buildThreadPrompt(thread, previousTask, isJointProject, currentDate);

  // Inject current date into system prompt for stale detection
  const agency = CONFIG.agency.name
    ? `${CONFIG.agency.name}, a digital marketing agency`
    : 'a digital marketing agency';
  const systemPromptWithDate = SUMMARIZE_SYSTEM_PROMPT
    .replace('{currentDate}', currentDate)
    .replace('{agency}', agency);

  // Wrap the API call with a timeout to prevent indefinite hangs
  const response = await withTimeout(
    client.models.generateContent({
      model: CONFIG.gemini.summarizeModel,
      contents: userPrompt,
      config: {
        systemInstruction: systemPromptWithDate,
        temperature: CONFIG.gemini.summarizeTemp,
        responseMimeType: 'application/json',
        responseSchema: SUMMARY_SCHEMA,
      },
    }),
    CONFIG.timeouts.geminiApi,
    `Gemini API timed out after ${CONFIG.timeouts.geminiApi / 1000}s`
  );

  // Validate response structure - check for blocked/truncated content
  // The response object may have candidates with finish reasons
  const candidates = (response as { candidates?: Array<{ finishReason?: string }> }).candidates;
  if (candidates && candidates.length > 0) {
    const finishReason = candidates[0].finishReason;
    if (finishReason === 'SAFETY') {
      throw new Error('Content blocked by safety filter - thread may contain sensitive content');
    }
    if (finishReason === 'MAX_TOKENS') {
      // Log warning but try to parse - JSON might still be valid if truncated at end
      console.warn(`[summarize] Response may be truncated (MAX_TOKENS) for ${thread.url}`);
    }
  }

  const text = response.text?.trim();
  if (!text || text.length === 0) {
    throw new Error('Empty response from Gemini - content may have been blocked');
  }

  return parseSummaryResponse(text);
}

/**
 * Infer category from task title using keyword matching
 * Follows the priority chain: PPC > Email > Social > Linkbuilding > Copywriting > SEO/DEV
 */
function inferCategoryFromTitle(title: string): ValidCategory {
  const titleLower = title.toLowerCase();

  // Priority 1: PPC - Explicit ad platform mentions
  if (/\b(ppc|google ads?|meta ads?|facebook ads?|paid search|campaign|roas|cpc|cpm|remarketing|display ads?|shopping ads?|performance max)\b/i.test(titleLower)) {
    return 'PPC';
  }

  // Priority 2: Email Marketing - Explicit email tool/campaign mentions
  if (/\b(email|newsletter|drip|klaviyo|mailchimp|email campaign|broadcast|subscriber)\b/i.test(titleLower)) {
    return 'Email Marketing';
  }

  // Priority 3: Social Media - Explicit platform mentions
  if (/\b(instagram|tiktok|linkedin post|facebook post|social post|reels|stories|social media)\b/i.test(titleLower)) {
    return 'Social Media';
  }

  // Priority 4: Linkbuilding - Outreach and backlink mentions
  if (/\b(link|backlink|outreach|guest post|pr|press|placement|da\s*\d+)\b/i.test(titleLower)) {
    return 'Linkbuilding';
  }

  // Priority 5: Copywriting - Content creation mentions
  if (/\b(copy|content|blog|article|landing page|headline|faq|writer|copywriter|product description)\b/i.test(titleLower)) {
    return 'Copywriting';
  }

  // Default to SEO/DEV
  return 'SEO/DEV';
}

/**
 * Infer status from thread metadata
 */
function inferStatusFromThread(thread: ThreadData): ValidStatus {
  // If completed checkbox is checked
  if (thread.completed) {
    // Check if it's likely "Live" (user-facing) vs just "Completed"
    const titleLower = thread.title.toLowerCase();
    if (/\b(deploy|launch|publish|index|live|ship)\b/i.test(titleLower)) {
      return 'Live';
    }
    return 'Completed';
  }

  // Check for blocked indicators in title
  if (/\b(waiting|blocked|on hold|pending)\b/i.test(thread.title.toLowerCase())) {
    return 'Blocked';
  }

  // Check due date - if past due and not completed, might be blocked
  if (thread.dueOn) {
    const dueDate = new Date(thread.dueOn);
    const now = new Date();
    if (dueDate < now) {
      return 'Blocked';
    }
  }

  return 'In Progress';
}

/**
 * Clean title by removing common prefixes
 */
function cleanTitle(title: string): string {
  return title
    .replace(/^(SEO|Dev|Copy|LB|PPC|Email|Social)[\s:-]+/i, '')
    .trim() || title;
}

/** Create a fallback summary for failed threads with intelligent defaults */
function createFallbackSummary(thread: ThreadData): ThreadSummary {
  return {
    url: thread.url,
    title: cleanTitle(thread.title) || 'Unable to process',
    category: inferCategoryFromTitle(thread.title),
    status: inferStatusFromThread(thread),
    description: 'This thread could not be automatically summarized. Please review manually.',
    jointBasecampUrl: null,
    copyItems: [],
    exclude: false,
  };
}

/** Summarize all threads with concurrency control and progress callback */
export async function summarizeAllThreads(
  threads: ThreadData[],
  previousTasks: Map<string, PreviousTask>,
  jointProjectId: string | null,
  onProgress?: (current: number, total: number, thread: string) => void
): Promise<{ summaries: ThreadSummary[]; errors: Array<{ url: string; error: string }> }> {
  const summaries: ThreadSummary[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  let completed = 0;

  // Get current date for stale detection
  const currentDate = new Date().toISOString().split('T')[0];

  const processThread = async (thread: ThreadData): Promise<void> => {
    const previousTask = previousTasks.get(thread.url) || null;
    const isJointProject = jointProjectId !== null && thread.projectId === jointProjectId;

    try {
      const summary = await pRetry(
        () => summarizeThread(thread, previousTask, isJointProject, currentDate),
        {
          retries: CONFIG.gemini.retries,
          minTimeout: 1000,  // Start with 1 second delay
          factor: 2,         // Double each time: 1s, 2s, 4s, 8s
          randomize: true,   // Add jitter to prevent thundering herd
          shouldRetry: (error) => {
            // Don't retry timeout errors - if it timed out once, it's likely to timeout again
            if (error instanceof TimeoutError) {
              return false;
            }
            // Don't retry config errors (missing API key)
            if (error.message?.includes('not configured')) {
              return false;
            }
            // Don't retry safety filter blocks
            if (error.message?.includes('safety filter')) {
              return false;
            }
            return true;
          },
          onFailedAttempt: (error) => {
            console.error(getErrorDetails(error, `summarize attempt ${thread.url}`));
          },
        }
      );
      summaries.push(summary);
    } catch (error) {
      console.error(getErrorDetails(error, `summarize ${thread.url}`));
      errors.push({
        url: thread.url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Add fallback summary
      summaries.push(createFallbackSummary(thread));
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, threads.length, thread.title);
      }
    }
  };

  // Execute with concurrency limit
  await Promise.all(
    threads.map(thread => limit(() => processThread(thread)))
  );

  return { summaries, errors };
}
