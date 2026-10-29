/**
 * Gemini prompts for report compilation (Tier 2 - Pro model)
 */

import type { ThreadSummary } from '../types.js';
import { groupRelatedTasks, formatTaskGroupHints } from '../utils/parser.js';

/** System prompt for report compilation */
export const COMPILE_SYSTEM_PROMPT = `You are compiling a CLIENT-FACING call notes report from pre-summarized thread data.

Your job is to:
1. Assemble the summaries into properly formatted Markdown
2. Group by category, then by status
3. Ensure consistent formatting throughout
4. Perform a final quality check

=== QUALITY CHECKLIST (VERIFY BEFORE OUTPUT) ===
Content filtering:
- [ ] No first names (John, Jordan, Mike, etc.)
- [ ] No @mentions or email addresses
- [ ] No "Per [Name]'s feedback" patterns
- [ ] No internal deadlines ("EOD", "Friday sync")
- [ ] No "team discussed", "we decided"
- [ ] No Slack/Asana/Jira references
- [ ] No "the client" in third person
- [ ] Uses "you/your" when addressing client's assets

Voice normalization:
- [ ] No em dashes (—) - replace with commas or periods
- [ ] No hedging words: may, might, could, potentially, possibly
- [ ] No buzzwords: leverage, utilize, synergy, robust, comprehensive, seamless, holistic
- [ ] No filler phrases: "In order to" → "To", "Due to the fact that" → "Because"
- [ ] Sentences under 25 words (split longer ones)

=== FINAL NORMALIZATION (APPLY TO ALL OUTPUT) ===
Before generating the final report, apply these transformations:
1. Replace all em dashes (—) with commas or periods
2. Replace "utilize" → "use", "leverage" → "use"
3. Remove hedging words: delete "may", "might", "could potentially", "possibly"
4. Remove filler: "In order to" → "To", "Due to the fact that" → "Because"
5. Split any sentence over 25 words into two sentences
6. Ensure every description addresses client as "you/your" not "the client"
7. Remove any remaining AI-isms or overly formal language

=== MARKDOWN FORMAT ===
## Category Name

### Status Group

* **Task Name** - Status - [View Task](url)
  * Description text here. [Joint Basecamp](url) if applicable.
    * Page Name | [Live Page](url) | [Doc](url) | [Test Page](url)

* **Next Task Name** - Status - [View Task](url)
  * Description text here.

NOTE: For Blocked tasks, status line should read "Blocked - [reason]" where reason briefly explains what's needed (e.g., "Blocked - Awaiting client feedback").

=== FORMATTING RULES ===
1. Category headers: ## Category Name
2. Status subheaders: ### Completed / ### Live / ### In Progress / ### Blocked / ### Upcoming
3. Task line: * **Task Name** - Status - [View Task](url) (task name in bold)
4. Description: Indented 2 spaces with *
5. Copy items: Indented 4 spaces with *
6. Section dividers: --- between categories ONLY (not between statuses)
7. Empty sections: OMIT ENTIRELY
8. Blank line between tasks: Add one blank line between each task entry

=== CATEGORY ORDER ===
1. SEO/DEV
2. Copywriting
3. Linkbuilding
4. PPC
5. Email Marketing
6. Social Media

=== STATUS ORDER (within each category) ===
1. Completed
2. Live
3. In Progress
4. Blocked
5. Upcoming

=== COPY ITEM FORMAT ===
For copywriting tasks with page items, format as:
* Page Name | [Live Page](url) | [Doc](url) | [Test Page](url)

Only include links that exist (skip null values).`;

/** Build the user prompt for report compilation */
export function buildCompilePrompt(summaries: ThreadSummary[]): string {
  // Group summaries by category
  const grouped = {
    'SEO/DEV': [] as ThreadSummary[],
    'Copywriting': [] as ThreadSummary[],
    'Linkbuilding': [] as ThreadSummary[],
    'PPC': [] as ThreadSummary[],
    'Email Marketing': [] as ThreadSummary[],
    'Social Media': [] as ThreadSummary[],
  };

  for (const summary of summaries) {
    if (summary.category in grouped) {
      grouped[summary.category].push(summary);
    } else {
      // Default to SEO/DEV if category is unexpected
      grouped['SEO/DEV'].push(summary);
    }
  }

  // Detect groupable tasks by title prefix
  const taskGroups = groupRelatedTasks(summaries.map(s => ({ url: s.url, title: s.title })));
  const groupingHints = formatTaskGroupHints(taskGroups);

  const prompt = `Compile these thread summaries into a formatted Markdown call notes report.

=== THREAD SUMMARIES ===
${JSON.stringify(summaries, null, 2)}
=== END SUMMARIES ===

=== TASK COUNTS BY CATEGORY ===
- SEO/DEV: ${grouped['SEO/DEV'].length} tasks
- Copywriting: ${grouped['Copywriting'].length} tasks
- Linkbuilding: ${grouped['Linkbuilding'].length} tasks
- PPC: ${grouped['PPC'].length} tasks
- Email Marketing: ${grouped['Email Marketing'].length} tasks
- Social Media: ${grouped['Social Media'].length} tasks

Instructions:
1. Group tasks by category (SEO/DEV, Copywriting, Linkbuilding, PPC, Email Marketing, Social Media)
2. Within each category, group by status (Completed, Live, In Progress, Blocked, Upcoming)
3. Format each task as: * **Title** - Status - [View Task](url) (title in bold)
4. For Blocked tasks, include reason: "Blocked - Awaiting client feedback" etc.
5. Add description as indented bullet below
6. For tasks with copyItems, add page items as double-indented bullets
7. Include [Joint Basecamp](url) at end of description if jointBasecampUrl exists
8. Add --- divider between categories (not between status groups)
9. OMIT empty categories and status groups entirely
10. Add one blank line between each task entry for readability
11. Perform final quality check per the checklist
${groupingHints}
Return ONLY the formatted Markdown report. No explanations or wrapper text.`;

  return prompt;
}

/** Categorize status string into status group */
export function getStatusGroup(status: string): 'Completed' | 'Live' | 'In Progress' | 'Blocked' | 'Upcoming' {
  // With standardized status values, map directly
  const validStatuses = ['Completed', 'Live', 'In Progress', 'Blocked', 'Upcoming'] as const;

  // Check for exact match first
  if (validStatuses.includes(status as typeof validStatuses[number])) {
    return status as 'Completed' | 'Live' | 'In Progress' | 'Blocked' | 'Upcoming';
  }

  // Fallback for any legacy or unexpected status values
  const statusLower = status.toLowerCase();

  if (statusLower.includes('live') || statusLower.includes('deployed') ||
      statusLower.includes('published') || statusLower.includes('indexed') ||
      statusLower.includes('launched') || statusLower.includes('shipped')) {
    return 'Live';
  }

  if (statusLower.includes('complete') || statusLower.includes('done') ||
      statusLower.includes('resolved') || statusLower.includes('finished')) {
    return 'Completed';
  }

  if (statusLower.includes('blocked') || statusLower.includes('waiting') ||
      statusLower.includes('on hold') || statusLower.includes('pending approval')) {
    return 'Blocked';
  }

  if (statusLower.includes('scheduled') || statusLower.includes('upcoming') ||
      statusLower.includes('planned') || statusLower.includes('queued') ||
      statusLower.includes('not started') || statusLower.includes('will start')) {
    return 'Upcoming';
  }

  return 'In Progress';
}
