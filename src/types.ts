/**
 * Shared TypeScript types for the Call Notes Generator application
 */

/** Extracted URL info from activity log */
export interface ParsedUrl {
  accountId: string;
  projectId: string;
  type: 'todos' | 'messages';
  recordingId: string;
  url: string;
}

/** Thread data fetched from Basecamp */
export interface ThreadData {
  url: string;
  type: 'todos' | 'messages';
  title: string;
  completed: boolean;
  dueOn: string | null;
  description: string;
  comments: ThreadComment[];
  accountId: string;
  projectId: string;
  recordingId: string;
}

/** Comment from a Basecamp thread */
export interface ThreadComment {
  content: string;
  createdAt: string;
  creatorLabel: string; // "Person A", "Person B", etc. (no real names)
}

/** Previous task from prior call notes */
export interface PreviousTask {
  url: string;
  title: string;
  status: string;
  description: string;
  /** Number of consecutive calls this task has appeared in (if trackable) */
  appearanceCount?: number;
  /** ISO date when task was first discussed (if trackable) */
  firstSeen?: string;
}

/** Context for AI summarization */
export interface SummarizationContext {
  thread: ThreadData;
  previousTask: PreviousTask | null;
  isJointProject: boolean;
  jointProjectUrl: string | null;
}

/** Output from Gemini summarization (Tier 1) */
export interface ThreadSummary {
  url: string;
  title: string;
  category: 'SEO/DEV' | 'Copywriting' | 'Linkbuilding' | 'PPC' | 'Email Marketing' | 'Social Media';
  status: 'Completed' | 'Live' | 'In Progress' | 'Blocked' | 'Upcoming';
  description: string;
  jointBasecampUrl: string | null;
  copyItems: CopyItem[];
  /** If true, this task should be excluded from the final report (stale/no meaningful update) */
  exclude?: boolean;
}

/** Copy task page item (for copywriting tasks) */
export interface CopyItem {
  pageName: string;
  liveUrl: string | null;
  docUrl: string | null;
  testUrl: string | null;
}

/** SSE event types for streaming response */
export type SSEEventType = 'phase' | 'progress' | 'content' | 'complete' | 'error';

/** Phase event data */
export interface PhaseEvent {
  phase: 'parsing' | 'fetching' | 'summarizing' | 'compiling';
  description: string;
}

/** Progress event data */
export interface ProgressEvent {
  current: number;
  total: number;
  thread: string;
}

/** Complete event data */
export interface CompleteEvent {
  threads: number;
  errors: number;
  duration: number;
}

/** Error event data */
export interface ErrorEvent {
  message: string;
  code?: string;
}

/** Request body for /api/generate */
export interface GenerateRequest {
  previousNotes: string;
  activityLog: string;
  jointBasecampUrl: string;
}

/** Credential status for setup check */
export interface CredentialStatus {
  hasBasecampCredentials: boolean;
  hasBasecampTokens: boolean;
  hasGeminiKey: boolean;
  isComplete: boolean;
}
