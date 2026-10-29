/**
 * Gemini prompts for per-thread summarization (Tier 1 - Flash model)
 */

import type { ThreadData, PreviousTask } from '../types.js';
import { CONFIG } from '../config.js';
import { truncateContent, truncateCommentsWithPriority, extractAndClassifyUrls, formatUrlClassifications } from '../utils/parser.js';

/** System prompt with content filtering and style rules */
export const SUMMARIZE_SYSTEM_PROMPT = `You are a call notes generator for {agency}.
Transform internal Basecamp threads into CLIENT-FACING summaries.

=== CRITICAL RULES ===
1. NEVER include team member names - use passive voice
2. NEVER include internal process details
3. ALWAYS follow Voice & Style Guidelines below
4. Extract and preserve Joint Basecamp URLs if mentioned
5. For copy tasks, extract individual page items with Doc/Test/Live URLs

=== CONTENT FILTERING ===
FILTER OUT ENTIRELY:
- Team member names (John, Jordan, Mike, etc.)
- @mentions and email addresses
- Internal deadlines ("EOD", "by Friday sync", "before standup")
- Process debates ("should we use X or Y?")
- Internal questions ("can you check this?")
- Tool references ("see Slack", "updated in Asana")
- Status check-ins between team members

REWRITE TO PASSIVE VOICE:
- "John fixed the issue" → "Issue has been resolved"
- "Jordan deployed it" → "Deployed to production"
- "Team discussed and decided" → "Approach finalized"
- "Waiting on internal review" → "Under review"

=== VOICE & STYLE ===
- Address client as "you/your" when referring to their assets (never "the client" in third person)
- Confident: State facts directly without hedging (no may/might/could/potentially)
- No em dashes (---) - use commas, periods, or parentheses instead
- No buzzwords: leverage, utilize, synergy, robust, comprehensive, seamless, holistic
- No filler: "In order to" → "To", "Due to the fact that" → "Because"
- Sentence length: 12-18 words average; split if over 25 words
- Only state information explicitly mentioned - NEVER invent results, metrics, or timelines

=== CATEGORY PRIORITY (if multiple match, use FIRST applicable) ===
When a task matches keywords for multiple categories, use this priority order:

1. PPC - Explicit ad platform mention takes highest priority
   Keywords: PPC, paid search, Google Ads, Meta Ads, Facebook Ads, ad copy, campaigns, bidding, ROAS, CPC, CPM, remarketing, display ads, shopping ads, Performance Max, paid media, ad spend, conversion tracking
   Example: "Landing page for Google Ads campaign" → PPC (not Copywriting)

2. Email Marketing - Explicit email tool/campaign mention
   Keywords: email campaign, newsletter, drip campaign, automation, Klaviyo, Mailchimp, email sequence, broadcast, subscriber, open rate, click rate, email template, email design, email list
   Example: "Landing page for Klaviyo email campaign" → Email Marketing (not Copywriting)

3. Social Media - Explicit social platform mention
   Keywords: Instagram, Facebook post, LinkedIn post, TikTok, social post, content calendar, social engagement, social strategy, reels, stories
   NOTE: Reddit/forum engagement is SEO/Linkbuilding, NOT Social Media

4. Linkbuilding - Outreach and backlink acquisition
   Keywords: link, backlink, outreach, publisher, guest post, PR, press release, mention, citation, directory, DA, placement, link prospect

5. Copywriting - Content creation without distribution channel specified
   Keywords: copy, content, writing, blog, article, landing page, headline, messaging, draft, revision, edit, page content, website copy, FAQ, copywriter, writer, product descriptions
   Example: "Blog post about new product" → Copywriting (no email/social distribution)

6. SEO/DEV - Technical work, analytics, bugs (DEFAULT for ambiguous)
   Keywords: SEO, meta, title tag, schema, JSON-LD, Search Console, GSC, indexing, sitemap, robots.txt, canonical, redirect, 301, 404, analytics, GA4, GTM, tracking, speed, Core Web Vitals, development, dev, code, bug, fix, deploy, staging, design, UI, UX, mobile, responsive, reddit engagement, forum engagement, Quora

If still ambiguous after applying priority order, default to SEO/DEV.

=== STATUS DETERMINATION ===
Use ONLY these five status values:
- "Completed" - Task is done, finished, resolved
- "Live" - Task is deployed, published, indexed, launched, shipped (visible to end users)
- "In Progress" - Task is actively being worked on (active development, testing, reviewing)
- "Blocked" - Task cannot proceed (waiting on client, pending approval, needs external input)
- "Upcoming" - Task is planned but not started (scheduled, queued, will start)

Priority order for determining status:
1. Checkbox state: completed=true → "Completed" or "Live" (use "Live" for SEO/dev tasks that are user-facing)
2. BLOCKED indicators (if incomplete AND any apply):
   - Comments contain: "waiting on client", "need client feedback", "pending approval", "waiting for", "blocked by", "need from client", "on hold"
   - No activity in 14+ days despite being incomplete
   - Due date passed but task still incomplete
   → Use "Blocked" status
3. Recent activity (7 days) + not completed = "In Progress"
4. No recent activity + not completed + not blocked = "Upcoming"

=== STALE TASK DETECTION (PRECISE RULES) ===
Set "exclude": true if the task should NOT appear in call notes. Use these explicit thresholds:

CURRENT DATE FOR REFERENCE: {currentDate}

1. ZOMBIE TASK (completed=true AND stale):
   - If most recent SUBSTANTIVE comment (not just "thanks" or checkbox click) is MORE than 21 days old → exclude:true
   - "Substantive" means: actual work update, progress report, decision, or deliverable
   - Example: Last real update was Nov 15, marked complete Dec 10 → EXCLUDE

2. NO MEANINGFUL UPDATE (has previous notes context):
   - If previous notes provided AND current status matches previous status AND no new comments with dates AFTER the previous call → exclude:true
   - This applies when: same status + same or very similar description + no fresh activity

3. PURELY ADMINISTRATIVE:
   - If ALL comments in the last 21 days are ONLY: checkbox changes, reassignments, "closing this out", "moved to X" → exclude:true
   - No actual progress or deliverables = exclude

DO NOT exclude tasks that:
- Have ANY substantive comment dated within the last 14 days
- Are newly created (not in previous notes)
- Have status changes WITH meaningful context (e.g., "Now live at [url]")
- Contain deliverables or results the client hasn't seen

=== OUTPUT FORMAT ===
Return ONLY valid JSON with this exact structure:
{
  "url": "original_basecamp_url",
  "title": "cleaned_title_without_prefixes",
  "category": "SEO/DEV|Copywriting|Linkbuilding|PPC|Email Marketing|Social Media",
  "status": "Completed|Live|In Progress|Upcoming",
  "description": "1-3_sentence_client_facing_summary",
  "jointBasecampUrl": "url_or_null",
  "copyItems": [],
  "exclude": false
}

Set "exclude": true if this task should be omitted from the final call notes (see STALE TASK DETECTION above).

For copy tasks with multiple pages, populate copyItems:
{
  "copyItems": [
    {"pageName": "Page Name", "liveUrl": "url|null", "docUrl": "url|null", "testUrl": "url|null"}
  ]
}

=== TITLE CLEANING ===
Remove these prefixes from titles: "SEO:", "Dev:", "Copy:", "LB:", "SEO -", "Dev -", "Copy -", "LB -"`;

/** Build the user prompt for a specific thread */
export function buildThreadPrompt(
  thread: ThreadData,
  previousTask: PreviousTask | null,
  isJointProject: boolean,
  currentDate?: string
): string {
  // Apply thread content limits (~5K tokens)
  const maxThreadChars = CONFIG.gemini.inputLimits.threadContent;
  const descriptionLimit = Math.floor(maxThreadChars / 3);
  const commentsLimit = Math.floor((maxThreadChars * 2) / 3);

  const truncatedDescription = truncateContent(
    thread.description || '(no description)',
    descriptionLimit
  );
  // Use smart truncation that filters noise and prioritizes recent comments
  const truncatedComments = truncateCommentsWithPriority(
    thread.comments,
    commentsLimit
  );

  let prompt = `Summarize this Basecamp thread for client-facing call notes.

=== THREAD DATA ===
Type: ${thread.type}
Title: ${thread.title}
URL: ${thread.url}
Completed: ${thread.completed}
Due Date: ${thread.dueOn || 'none'}

Description:
${truncatedDescription}

Comments (oldest to newest):
${truncatedComments}
=== END THREAD DATA ===`;

  if (previousTask) {
    const appearanceInfo = previousTask.appearanceCount && previousTask.appearanceCount > 2
      ? `\n- Appearance Count: This task has been discussed in ${previousTask.appearanceCount} consecutive calls`
      : '';
    const firstSeenInfo = previousTask.firstSeen
      ? `\n- First Discussed: ${previousTask.firstSeen}`
      : '';
    const stuckWarning = previousTask.appearanceCount && previousTask.appearanceCount >= 3 && previousTask.status === 'In Progress'
      ? `\n\nWARNING: This task has been "In Progress" for ${previousTask.appearanceCount}+ calls. If no meaningful progress, consider:
   - Marking as "Blocked" if waiting on something
   - Adding timeline context ("ongoing since [date]")
   - Flagging if truly stuck without progress`
      : '';

    prompt += `

=== PREVIOUS CALL NOTES CONTEXT ===
This task appeared in previous call notes:
- Previous Title: ${previousTask.title}
- Previous Status: ${previousTask.status}
- Previous Description: ${previousTask.description}${appearanceInfo}${firstSeenInfo}

Since the client already knows about this task, be CONCISE. Focus only on what changed since the last call. If status changed (e.g., In-Progress → Completed), note that briefly.${stuckWarning}
=== END PREVIOUS CONTEXT ===`;
  }

  if (isJointProject) {
    prompt += `

=== JOINT BASECAMP PROJECT (STRICT LIMITS) ===
This task is from a Joint Basecamp project that the client can view directly.

HARD REQUIREMENTS for Joint project tasks:
1. Description MUST be exactly 1 sentence
2. Maximum 15 words in description
3. Focus ONLY on outcome: "Completed", "Changes deployed", "Awaiting feedback"
4. NEVER explain process, context, or anything they can read themselves
5. Include the thread URL as jointBasecampUrl in your response

GOOD examples:
- "Header layout updated per your feedback."
- "Blog post live on your site."
- "Awaiting your approval on the mockup."

BAD examples (too verbose):
- "Based on the discussion in the thread, we've implemented the requested changes to the header section as per the feedback provided."
- "The team has been working on this and made several updates that you can see in the thread."
=== END JOINT PROJECT NOTE ===`;
  }

  // For copy/content tasks, extract and classify URLs for copyItems hints
  const titleLower = thread.title.toLowerCase();
  const isCopyTask = /copy|content|blog|article|landing page|faq|page/i.test(titleLower);

  if (isCopyTask) {
    const allContent = `${thread.description || ''} ${thread.comments.map(c => c.content).join(' ')}`;
    const classifiedUrls = extractAndClassifyUrls(allContent);
    const urlHints = formatUrlClassifications(classifiedUrls);
    if (urlHints) {
      prompt += urlHints;
    }
  }

  prompt += `

Remember:
- Return ONLY valid JSON
- No team member names
- Use passive voice
- Client-facing language only`;

  return prompt;
}

/** Format comments for the prompt */
function formatComments(comments: Array<{ content: string; createdAt: string; creatorLabel: string }>): string {
  if (comments.length === 0) {
    return '(no comments)';
  }

  return comments
    .map(c => {
      const date = new Date(c.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `[${date}] ${c.creatorLabel}: ${c.content}`;
    })
    .join('\n\n');
}
