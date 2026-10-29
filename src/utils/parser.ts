/**
 * Activity log parser - extracts Basecamp URLs from pasted activity text
 */

import type { ParsedUrl, PreviousTask, ThreadComment } from '../types.js';

/** Regex to match Basecamp thread URLs */
const BASECAMP_URL_REGEX = /https:\/\/3\.basecamp\.com\/(\d+)\/buckets\/(\d+)\/(todos|messages)\/(\d+)/g;

/** Patterns to exclude from extraction */
const EXCLUSION_PATTERNS = [
  /#__recording_/, // Fragment anchors
  /\/todolists\//, // Todolist URLs
  /\/projects\//,  // Project URLs
];

/**
 * Extract Basecamp thread URLs from activity log text
 * @param activityLog - Raw activity log text pasted by user
 * @returns Array of parsed URL objects, deduplicated
 */
export function parseActivityLog(activityLog: string): ParsedUrl[] {
  const urlMap = new Map<string, ParsedUrl>();

  // Reset regex lastIndex for fresh matching
  BASECAMP_URL_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BASECAMP_URL_REGEX.exec(activityLog)) !== null) {
    const fullUrl = match[0];

    // Check exclusion patterns
    const shouldExclude = EXCLUSION_PATTERNS.some(pattern => pattern.test(fullUrl));
    if (shouldExclude) continue;

    // Deduplicate by full URL
    if (!urlMap.has(fullUrl)) {
      urlMap.set(fullUrl, {
        accountId: match[1],
        projectId: match[2],
        type: match[3] as 'todos' | 'messages',
        recordingId: match[4],
        url: fullUrl,
      });
    }
  }

  return Array.from(urlMap.values());
}

/**
 * Get URL extraction preview for UI display
 * @param activityLog - Raw activity log text
 * @returns Preview stats object
 */
export function getUrlPreview(activityLog: string): {
  total: number;
  todos: number;
  messages: number;
  duplicatesRemoved: number;
} {
  // Count all matches including duplicates
  BASECAMP_URL_REGEX.lastIndex = 0;
  const allMatches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = BASECAMP_URL_REGEX.exec(activityLog)) !== null) {
    const fullUrl = match[0];
    const shouldExclude = EXCLUSION_PATTERNS.some(pattern => pattern.test(fullUrl));
    if (!shouldExclude) {
      allMatches.push(fullUrl);
    }
  }

  // Parse to get deduplicated results
  const parsed = parseActivityLog(activityLog);

  return {
    total: parsed.length,
    todos: parsed.filter(p => p.type === 'todos').length,
    messages: parsed.filter(p => p.type === 'messages').length,
    duplicatesRemoved: allMatches.length - parsed.length,
  };
}

/**
 * Extract Joint Basecamp project ID from URL
 * @param url - Basecamp URL
 * @returns Project ID (bucket ID) or null
 */
export function extractProjectId(url: string): string | null {
  const match = url.match(/\/buckets\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 * Parse previous call notes to extract task information
 * @param previousNotes - Markdown text of previous call notes
 * @returns Map of URL to previous task info
 */
export function parsePreviousNotes(previousNotes: string): Map<string, PreviousTask> {
  const tasks = new Map<string, PreviousTask>();

  if (!previousNotes.trim()) return tasks;

  // Match task lines: * Task Name - Status - [View Task](url)
  // Also handles bold titles: * **Task Name** - Status - [View Task](url)
  const taskLineRegex = /^\s*\*\s+\*?\*?(.+?)\*?\*?\s+-\s+(.+?)\s+-\s+\[View Task\]\(([^)]+)\)/gm;

  // Patterns for multi-call tracking metadata
  const appearanceCountRegex = /\(Discussed in (\d+) previous calls?\)/i;
  const firstSeenRegex = /\(First discussed:?\s*(\d{4}-\d{2}-\d{2})\)/i;

  let match: RegExpExecArray | null;
  const lines = previousNotes.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    taskLineRegex.lastIndex = 0;
    match = taskLineRegex.exec(line);

    if (match) {
      const title = match[1].trim();
      const status = match[2].trim();
      const url = match[3].trim();

      // Look for description in the next line (indented with *)
      const nextLine = lines[i + 1];
      let description = '';
      let appearanceCount: number | undefined;
      let firstSeen: string | undefined;

      if (nextLine && /^\s+\*\s+/.test(nextLine)) {
        description = nextLine.replace(/^\s+\*\s+/, '').trim();

        // Check for appearance count in description
        const countMatch = description.match(appearanceCountRegex);
        if (countMatch) {
          appearanceCount = parseInt(countMatch[1], 10) + 1; // +1 because previous notes is already one call
          description = description.replace(appearanceCountRegex, '').trim();
        }

        // Check for first seen date in description
        const firstSeenMatch = description.match(firstSeenRegex);
        if (firstSeenMatch) {
          firstSeen = firstSeenMatch[1];
          description = description.replace(firstSeenRegex, '').trim();
        }
      }

      // If no explicit appearance count, this is at least the 2nd appearance
      if (!appearanceCount) {
        appearanceCount = 2; // Was in previous notes, now appearing again
      }

      tasks.set(url, {
        url,
        title,
        status,
        description,
        appearanceCount,
        firstSeen,
      });
    }
  }

  return tasks;
}

/**
 * Extract Joint Basecamp URLs from previous notes
 * Pattern: [Joint Basecamp](url)
 * @param previousNotes - Markdown text of previous call notes
 * @returns Array of Joint Basecamp URLs found
 */
export function extractJointBasecampUrls(previousNotes: string): string[] {
  const urls: string[] = [];
  const regex = /\[Joint Basecamp\]\(([^)]+)\)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(previousNotes)) !== null) {
    urls.push(match[1]);
  }

  return [...new Set(urls)]; // Deduplicate
}

/**
 * Strip base64 images from markdown
 * Handles multiple formats:
 * - Inline: ![alt](data:image/png;base64,...)
 * - Reference with angle brackets: [image1]: <data:image/png;base64,...>
 * - Reference without angle brackets: [image1]: data:image/...
 * @param markdown - Markdown text potentially containing base64 images
 * @returns Markdown with base64 images replaced with placeholder text
 */
export function stripBase64Images(markdown: string): string {
  let result = markdown;

  // Inline images: ![alt](data:image/...)
  result = result.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '[image removed]');

  // Reference definitions with angle brackets: [id]: <data:image/...>
  result = result.replace(/^\[[^\]]+\]:\s*<data:image\/[^>]+>/gm, '[image removed]');

  // Reference definitions without angle brackets: [id]: data:image/...
  result = result.replace(/^\[[^\]]+\]:\s*data:image\/\S+/gm, '[image removed]');

  // Catch-all for any remaining data:image URIs (handles edge cases)
  result = result.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, '[base64 data removed]');

  return result;
}

/**
 * Truncate content to max character limit with smart boundary detection
 * Attempts to break at sentence or paragraph boundaries for cleaner output
 * @param content - Text content to truncate
 * @param maxChars - Maximum character count
 * @returns Truncated content with indicator if truncated
 */
export function truncateContent(content: string, maxChars: number): string {
  if (!content || content.length <= maxChars) return content;

  // Find last sentence/paragraph break before limit
  const truncated = content.slice(0, maxChars);
  const lastBreak = Math.max(
    truncated.lastIndexOf('\n\n'),
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('.\n')
  );

  // If we found a good break point in the last 20% of content, use it
  if (lastBreak > maxChars * 0.8) {
    return truncated.slice(0, lastBreak + 1) + '\n\n[... content truncated ...]';
  }

  return truncated + '\n\n[... content truncated ...]';
}

/**
 * Patterns that indicate low-value comments (acknowledgments, noise)
 * These waste tokens and don't add meaningful context
 */
const LOW_VALUE_PATTERNS = [
  // Simple acknowledgments (case insensitive, full comment match)
  /^\s*(sounds good|thank you|thanks|thanks!|thank you!|\+1|lgtm|ok|okay|ok!|okay!|got it|noted|sure|yes|no|yep|nope|nice|great|perfect|awesome|cool|done|will do|on it|agreed)\s*[!.]*\s*$/i,
  // Just a mention with nothing else
  /^\s*@\w+\s*$/,
  // Just emoji
  /^\s*[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+\s*$/u,
  // Very short responses (3 words or less, no URLs)
  /^(?!.*https?:\/\/)[\w\s]{1,15}[!.?]*$/,
];

/**
 * Filter out low-value comments that don't add meaningful context
 * @param comments - Array of thread comments
 * @returns Filtered array with only substantive comments
 */
export function filterLowValueComments(comments: ThreadComment[]): ThreadComment[] {
  return comments.filter(comment => {
    const content = comment.content.trim();
    // Keep empty check separate - empty comments should still be filtered
    if (!content) return false;
    // Check against low-value patterns
    return !LOW_VALUE_PATTERNS.some(pattern => pattern.test(content));
  });
}

/**
 * Calculate recency weight for a comment (used for prioritization)
 * Comments from last 7 days get 2x weight, last 14 days get 1.5x
 * @param createdAt - ISO date string
 * @returns Weight multiplier (1, 1.5, or 2)
 */
function getRecencyWeight(createdAt: string): number {
  const commentDate = new Date(createdAt);
  const now = new Date();
  const daysDiff = (now.getTime() - commentDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff <= 7) return 2;    // Last week: double weight
  if (daysDiff <= 14) return 1.5; // Last 2 weeks: 1.5x weight
  return 1;                        // Older: normal weight
}

/**
 * Smart truncation for comments that prioritizes recent content
 * Filters out noise first, then allocates more budget to recent comments
 * @param comments - Array of thread comments
 * @param maxChars - Maximum total character count
 * @returns Truncated and formatted comments string
 */
export function truncateCommentsWithPriority(
  comments: ThreadComment[],
  maxChars: number
): string {
  if (comments.length === 0) return '(no comments)';

  // Step 1: Filter out low-value comments
  const filtered = filterLowValueComments(comments);
  if (filtered.length === 0) return '(no substantive comments)';

  // Step 2: Format each comment
  const formatted = filtered.map(c => {
    const date = new Date(c.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      text: `[${date}] ${c.creatorLabel}: ${c.content}`,
      createdAt: c.createdAt,
      weight: getRecencyWeight(c.createdAt),
    };
  });

  // Step 3: Calculate weighted budget allocation
  const totalWeight = formatted.reduce((sum, c) => sum + c.weight, 0);

  // Step 4: Truncate each comment proportionally to its weight
  let result: string[] = [];
  let usedChars = 0;
  const separator = '\n\n';
  const separatorChars = (filtered.length - 1) * separator.length;
  const availableChars = maxChars - separatorChars;

  for (const comment of formatted) {
    const proportionalBudget = Math.floor((comment.weight / totalWeight) * availableChars);
    const actualBudget = Math.min(proportionalBudget, availableChars - usedChars);

    if (actualBudget <= 0) continue;

    if (comment.text.length <= actualBudget) {
      result.push(comment.text);
      usedChars += comment.text.length;
    } else {
      // Truncate this comment at a sentence/word boundary
      const truncated = comment.text.slice(0, actualBudget);
      const lastBreak = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf(' ')
      );
      if (lastBreak > actualBudget * 0.5) {
        result.push(truncated.slice(0, lastBreak) + '...');
      } else {
        result.push(truncated + '...');
      }
      usedChars += actualBudget;
    }
  }

  return result.join(separator);
}

/**
 * URL type classification for copy items
 */
export type UrlType = 'doc' | 'test' | 'live' | 'unknown';

/**
 * Patterns for classifying URLs by type
 */
const URL_TYPE_PATTERNS: [RegExp, UrlType][] = [
  // Document URLs
  [/docs\.google\.com/, 'doc'],
  [/drive\.google\.com/, 'doc'],
  [/notion\.so/, 'doc'],
  [/dropbox\.com/, 'doc'],
  [/\.docx?$/i, 'doc'],
  [/\.pdf$/i, 'doc'],

  // Test/Staging URLs
  [/\.staging\./, 'test'],
  [/\.test\./, 'test'],
  [/\.dev\./, 'test'],
  [/-staging\./, 'test'],
  [/-test\./, 'test'],
  [/staging-/, 'test'],
  [/test-/, 'test'],
  [/\.local/, 'test'],
  [/localhost/, 'test'],
  [/\.vercel\.app/, 'test'],
  [/\.netlify\.app/, 'test'],
  [/\.pages\.dev/, 'test'],
];

/**
 * Classify a URL as doc, test, or live
 * @param url - URL to classify
 * @returns URL type classification
 */
export function classifyUrl(url: string): UrlType {
  const urlLower = url.toLowerCase();

  for (const [pattern, type] of URL_TYPE_PATTERNS) {
    if (pattern.test(urlLower)) return type;
  }

  // If no test/doc patterns match and looks like a real URL, assume live
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'live';
  }

  return 'unknown';
}

/**
 * Extract and classify URLs from text content
 * @param content - Text content to extract URLs from
 * @returns Map of URL to its classification
 */
export function extractAndClassifyUrls(content: string): Map<string, UrlType> {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const urls = new Map<string, UrlType>();

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, ''); // Trim trailing punctuation
    if (!urls.has(url)) {
      urls.set(url, classifyUrl(url));
    }
  }

  return urls;
}

/**
 * Format URL classifications as hints for AI prompt
 * @param urls - Map of URLs to their types
 * @returns Formatted string for prompt injection
 */
export function formatUrlClassifications(urls: Map<string, UrlType>): string {
  if (urls.size === 0) return '';

  const grouped = {
    doc: [] as string[],
    test: [] as string[],
    live: [] as string[],
    unknown: [] as string[],
  };

  for (const [url, type] of urls) {
    grouped[type].push(url);
  }

  const parts: string[] = [];
  if (grouped.doc.length > 0) {
    parts.push(`Doc URLs: ${grouped.doc.join(', ')}`);
  }
  if (grouped.test.length > 0) {
    parts.push(`Test/Staging URLs: ${grouped.test.join(', ')}`);
  }
  if (grouped.live.length > 0) {
    parts.push(`Live URLs: ${grouped.live.join(', ')}`);
  }

  return parts.length > 0
    ? `\n\nURL CLASSIFICATION HINTS (use for copyItems):\n${parts.join('\n')}`
    : '';
}

/**
 * Task group for semantic grouping
 */
export interface TaskGroup {
  prefix: string;
  urls: string[];
}

/**
 * Extract a title prefix if one exists (e.g., "Homepage - Header" → "Homepage")
 * @param title - Task title
 * @returns Prefix or null if no clear prefix
 */
export function extractTitlePrefix(title: string): string | null {
  // Match patterns like "Prefix - Rest" or "Prefix: Rest" or "Prefix — Rest"
  const match = title.match(/^(.{3,30}?)\s*[-–—:]\s+/);
  if (match) {
    const prefix = match[1].trim();
    // Avoid generic prefixes that aren't really groupings
    const genericPrefixes = ['seo', 'dev', 'copy', 'lb', 'ppc', 'task', 'todo', 'urgent', 'fix'];
    if (genericPrefixes.includes(prefix.toLowerCase())) {
      return null;
    }
    return prefix;
  }
  return null;
}

/**
 * Group related tasks by title prefix
 * @param tasks - Array of objects with url and title
 * @returns Array of task groups (only groups with 2+ tasks)
 */
export function groupRelatedTasks(tasks: Array<{ url: string; title: string }>): TaskGroup[] {
  const groups = new Map<string, string[]>();

  for (const task of tasks) {
    const prefix = extractTitlePrefix(task.title);
    if (prefix) {
      const existing = groups.get(prefix) || [];
      existing.push(task.url);
      groups.set(prefix, existing);
    }
  }

  // Only return groups with 2+ tasks
  return Array.from(groups.entries())
    .filter(([_, urls]) => urls.length >= 2)
    .map(([prefix, urls]) => ({ prefix, urls }));
}

/**
 * Format task groups as hints for the compile prompt
 * @param groups - Array of task groups
 * @returns Formatted string for prompt injection
 */
export function formatTaskGroupHints(groups: TaskGroup[]): string {
  if (groups.length === 0) return '';

  const hints = groups.map(g =>
    `"${g.prefix}" (${g.urls.length} tasks): Consider consolidating into single entry "${g.prefix} Updates"`
  ).join('\n');

  return `\n\n=== TASK GROUPING SUGGESTIONS ===
The following tasks share common prefixes and could be consolidated:
${hints}

For each group, you may consolidate into a single entry with nested sub-items if the tasks are closely related.`;
}
