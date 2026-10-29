/**
 * Call notes generation orchestration service
 * Coordinates the multi-phase generation process
 */

import { parseActivityLog, parsePreviousNotes, extractProjectId, stripBase64Images, extractJointBasecampUrls, truncateContent } from '../utils/parser.js';
import { CONFIG } from '../config.js';
import { fetchAllThreads } from './basecamp/client.js';
import { summarizeAllThreads } from './gemini/summarize.js';
import { compileReportStreaming } from './gemini/compile.js';
import type { SSEWriter } from '../utils/sse.js';

/**
 * Input for call notes generation
 */
export interface GenerationInput {
  previousNotes: string;
  activityLog: string;
  jointBasecampUrl: string;
}

/**
 * Result of call notes generation
 */
export interface GenerationResult {
  success: boolean;
  threads: number;
  errors: number;
  durationMs: number;
}

/**
 * Generate call notes from Basecamp activity
 *
 * Orchestrates the 4-phase generation process:
 * 1. Parse activity log to extract thread URLs
 * 2. Fetch thread data from Basecamp API
 * 3. Summarize each thread with AI
 * 4. Compile final report with streaming output
 *
 * @param input - Generation input containing activity log and optional previous notes
 * @param sse - SSE writer for streaming progress and content to client
 * @returns Generation result with stats
 */
export async function generateCallNotes(
  input: GenerationInput,
  sse: SSEWriter
): Promise<GenerationResult> {
  const startTime = Date.now();
  let errorCount = 0;

  // Phase 1: Parse activity log
  sse.sendPhase('parsing', 'Extracting thread URLs from activity log...');

  // Truncate user inputs to prevent token overflow (~30K tokens each)
  const maxUserContent = CONFIG.gemini.inputLimits.userContent;
  const truncatedActivityLog = truncateContent(input.activityLog, maxUserContent);

  const parsedUrls = parseActivityLog(truncatedActivityLog);

  if (parsedUrls.length === 0) {
    sse.sendError(
      'No Basecamp thread URLs found in the activity log. Please paste a Basecamp activity log containing URLs in this format: https://3.basecamp.com/XXXXXX/buckets/XXXXXX/todos/XXXXXX'
    );
    return {
      success: false,
      threads: 0,
      errors: 1,
      durationMs: Date.now() - startTime,
    };
  }

  // Parse previous notes if provided (strip images first, then truncate)
  const strippedPreviousNotes = input.previousNotes ? stripBase64Images(input.previousNotes) : '';
  const cleanedPreviousNotes = truncateContent(strippedPreviousNotes, maxUserContent);
  const previousTasks = parsePreviousNotes(cleanedPreviousNotes);

  // Determine Joint project ID
  let jointProjectId: string | null = null;
  if (input.jointBasecampUrl && input.jointBasecampUrl.trim()) {
    jointProjectId = extractProjectId(input.jointBasecampUrl.trim());
  } else if (cleanedPreviousNotes) {
    // Try to extract from previous notes
    const jointUrls = extractJointBasecampUrls(cleanedPreviousNotes);
    if (jointUrls.length > 0) {
      jointProjectId = extractProjectId(jointUrls[0]);
    }
  }

  // Phase 2: Fetch thread data from Basecamp
  sse.sendPhase('fetching', `Fetching ${parsedUrls.length} threads from Basecamp...`);

  const { threads, errors: fetchErrors } = await fetchAllThreads(
    parsedUrls,
    (current, total, thread) => {
      sse.sendProgress(current, total, 'fetching', thread);
    }
  );

  errorCount += fetchErrors.length;

  if (threads.length === 0) {
    sse.sendError('Failed to fetch any threads from Basecamp.');
    return {
      success: false,
      threads: 0,
      errors: errorCount,
      durationMs: Date.now() - startTime,
    };
  }

  // Phase 3: Summarize threads with AI
  sse.sendPhase('summarizing', `Summarizing ${threads.length} threads with AI...`);

  const { summaries, errors: summarizeErrors } = await summarizeAllThreads(
    threads,
    previousTasks,
    jointProjectId,
    (current, total, thread) => {
      sse.sendProgress(current, total, 'summarizing', thread);
    }
  );

  errorCount += summarizeErrors.length;

  // Filter out excluded tasks (stale, no meaningful update, etc.)
  const includedSummaries = summaries.filter(s => !s.exclude);
  const excludedCount = summaries.length - includedSummaries.length;

  if (excludedCount > 0) {
    sse.sendPhase('compiling', `Compiling final report... (${excludedCount} stale task${excludedCount > 1 ? 's' : ''} filtered out)`);
  } else {
    sse.sendPhase('compiling', 'Compiling final report...');
  }

  // Phase 4: Compile final report
  await compileReportStreaming(includedSummaries, (chunk) => {
    sse.sendContent(chunk);
  });

  // Complete
  const durationMs = Date.now() - startTime;
  sse.sendComplete(threads.length, errorCount, durationMs);

  return {
    success: true,
    threads: threads.length,
    errors: errorCount,
    durationMs,
  };
}
