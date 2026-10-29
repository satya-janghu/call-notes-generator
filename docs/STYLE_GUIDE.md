# Style Guide & Content Filtering

> **Related Documentation:** [PRD](PRD.md) | [Processing](PROCESSING.md) | [AI Prompts](AI_PROMPTS.md) | [Architecture](ARCHITECTURE.md)

This document covers voice guidelines, content filtering rules, output format, and previous call notes integration.

---

## Previous Call Notes Integration

Call Notes Generator accepts **two inputs**:

1. **Previous call notes** (optional but recommended) - Markdown from the last client call
2. **Basecamp activity log** - Recent activity to process into new notes

The previous notes provide critical context for generating better, more relevant call notes.

### Why Previous Notes Matter

#### 1. Joint Basecamp Identification

"Joint Basecamp" refers to client-facing Basecamp projects where the client can see all comments.

**Why this matters:**
- Tasks in Joint projects require extra scrutiny
- Client may have already read the Basecamp thread
- Our summary must align with (not contradict) what's visible in Basecamp
- Focus on synthesizing, not rehashing what client already saw

**How Joint projects are identified (Priority Order):**

1. **User provides URL in Step 2** (Primary) - Most reliable method. User pastes the Joint Basecamp project URL alongside the activity log.

2. **Extract from previous notes** (Fallback) - Scan for `[Joint Basecamp](url)` patterns if user didn't provide URL.

```javascript
// Extract project ID from user-provided or detected URL
const projectIdMatch = jointUrl.match(/buckets\/(\d+)/);
const jointProjectId = projectIdMatch ? projectIdMatch[1] : null;
```

If the current activity log contains tasks from a Joint project:
- Apply stricter content filtering
- Assume client has context
- Be more concise in descriptions

#### 2. Task Continuity Tracking

Previous notes show what was discussed last time and its status then.

**Example previous notes:**
```markdown
## SEO/DEV

### In Progress

* Schema Markup Implementation - In development - [View Task](url)
  * LocalBusiness schema being added to service pages. Expected completion next week.
```

**Current activity shows task completed.**

**New call notes should reference the progress:**
```markdown
### Completed

* Schema Markup Implementation - Live - [View Task](url)
  * LocalBusiness schema implementation completed and validated. Rich results now appearing in Search Console. (Previously: in development as of last call)
```

#### 3. Avoiding Repetition

If a task was explained in detail last call and has no new updates, we can be briefer:

**Previous notes (detailed):**
```markdown
* Site Speed Optimization - In progress - [View Task](url)
  * Comprehensive audit identified 15 optimization opportunities including image compression,
    lazy loading implementation, and render-blocking resource elimination. Work has begun
    on highest-impact items.
```

**New notes (if still in progress, minimal change):**
```markdown
* Site Speed Optimization - 60% complete - [View Task](url)
  * Continuing optimization work. 9 of 15 items completed. Remaining items in progress.
```

### Parsing Previous Call Notes

#### Input Format

Previous notes follow the same Markdown structure as output:

```markdown
## SEO/DEV

### Completed

* Task Name - Status - [View Task](url)
  * Description. [Joint Basecamp](joint-url)

### In Progress

* Task Name - Status - [View Task](url)
  * Description.

---

## Copywriting

### Completed

* Task Name - Status - [View Task](url)
  * Description.
    * Page 1 | [Live Page](url) | [Doc](url)
    * Page 2 | [Live Page](url) | [Doc](url)
```

#### Data to Extract

For each task in previous notes:

```javascript
{
  url: "basecamp task url",
  title: "Task Name",
  category: "SEO/DEV|Copywriting|Linkbuilding|PPC|Email Marketing|Social Media",
  previous_status: "In Progress",
  previous_description: "Description text",
  joint_basecamp_url: "url or null",
  discussed_date: "date of previous call if known"
}
```

#### Joint Basecamp Extraction from Previous Notes

Scan entire previous notes for Joint Basecamp URLs:

**Patterns to match:**
```
[Joint Basecamp](url)
[Joint](url)
[Joint Project](url)
```

**Regex:**
```javascript
/\[Joint(?:\s+Basecamp|\s+Project)?\]\((https:\/\/3\.basecamp\.com\/[^)]+)\)/gi
```

**Store as list of Joint project URLs** - any task from these projects gets flagged.

### Matching Previous Tasks to Current Activity

#### Matching Logic

For each task in current activity log, check if it appeared in previous notes:

1. **Primary match:** Same Basecamp URL
2. **Fallback match:** Similar title + same category (handles URL changes)

#### Match Outcomes

| Previous Status | Current Status | Action |
|-----------------|----------------|--------|
| In Progress | Completed | Note progress: "Now complete" or "Completed since last call" |
| In Progress | Still In Progress | Note what changed, or keep brief if no change |
| Upcoming | In Progress | Note that work has started |
| Upcoming | Completed | Note completion |
| Completed | (appears again) | Only include if meaningful new activity |
| Not in previous | Any | New task, describe fully |

#### Description Adjustments

**Task was in previous notes → already explained:**
- Be more concise in new description
- Focus on what changed
- Reference previous status if helpful

**Task is new → not in previous notes:**
- Provide full context
- Explain what the task is about
- Standard description length (2-4 sentences)

### Joint Project Handling

#### Identification

A task is from a Joint project if its `bucket_id` (project_id) matches the known Joint project ID. The Joint project ID is determined by (in priority order):

1. User-provided Joint Basecamp URL in Step 2 (alongside activity log)
2. URLs extracted from previous notes matching `[Joint Basecamp](url)` pattern
3. Explicit mentions found in thread comments

#### Special Rules for Joint Tasks

When generating descriptions for Joint project tasks:

1. **Assume client has context**
   - They can see the Basecamp thread
   - Don't over-explain what they can read themselves

2. **Align with Basecamp**
   - Don't contradict what's visible in the thread
   - Synthesize rather than summarize

3. **Be extra careful with filtering**
   - Double-check no internal names slip through
   - Avoid any internal process references

4. **Focus on outcomes and next steps**
   - "Schema implementation complete and validated"
   - NOT "Team discussed options, decided on approach, implemented it"

#### Output Indicator

When a task is from a Joint project, include the Joint Basecamp link:

```markdown
* Task Name - Status - [View Task](internal-url)
  * Description of outcome. [Joint Basecamp](joint-project-url)
```

---

## Output Format

### Structure

```markdown
## SEO/DEV

### Completed

* Task Name - Status context - [View Task](basecamp-url)
  * Description sentence(s). [Joint Basecamp](joint-url) if applicable.

* Another Task - Live - [View Task](basecamp-url)
  * Description here.

### In Progress

* Task Name - Status context - [View Task](basecamp-url)
  * Description.

### Upcoming

* Task Name - Scheduled for next sprint - [View Task](basecamp-url)
  * Description.

---

## Copywriting

### Completed

* Homepage Copy Refresh - Live - [View Task](basecamp-url)
  * All homepage copy has been updated and published. Below are the individual pages:
    * FAQs | [Live Page](url) | [Doc](url) | [Test Page](url)
    * About Us | [Live Page](url) | [Doc](url)
    * Services | [Live Page](url) | [Doc](url) | [Test Page](url)

### In Progress

* Blog Content Q1 - With copywriting team, due Jan 15 - [View Task](basecamp-url)
  * Q1 blog calendar in progress. First drafts expected next week.

---

## Linkbuilding

### Completed

* Publisher Outreach Campaign - 12 placements secured - [View Task](basecamp-url)
  * Outreach campaign completed with 12 confirmed guest post placements across industry publications.

### In Progress

...
```

### Hierarchy

```
Category (SEO/DEV, Copywriting, Linkbuilding, PPC, Email Marketing, Social Media)
  └── Status Group (Completed, Live, In Progress, Blocked, Upcoming)
        └── Task Item
              └── Description
                    └── Copy Items (if applicable)
```

### Formatting Rules

| Element | Format |
|---------|--------|
| Category headers | `## Category Name` |
| Status subheaders | `### Completed` / `### Live` / `### In Progress` / `### Blocked` / `### Upcoming` |
| Task line | `* Task Name - Status - [View Task](url)` |
| Description | Indented bullet: `  * Description text.` |
| Copy items | Double-indented: `    * Page | [Live](url) | [Doc](url)` |
| Section dividers | `---` between categories |
| Empty sections | Omit entirely (don't show empty categories or status groups) |

### Empty Sections

**Omit entirely:**
- Categories with no tasks
- Status groups with no tasks

```markdown
## SEO/DEV

### Completed

* Task here...

### In Progress

* Task here...

// NO "### Upcoming" section if there are no upcoming SEO/DEV tasks

---

## Copywriting

// Skip entirely if no copywriting tasks

---

## Linkbuilding

### In Progress

* Task here...

// NO Completed or Upcoming sections if empty
```

### Section Dividers

Use `---` between top-level categories (## headers), not between status groups (### headers).

### Status Values

Every task uses one of five fixed statuses so reports stay comparable from call to call: **Completed**, **Live**, **In Progress**, **Blocked** or **Upcoming**. Blocked tasks add a short reason ("Blocked - Awaiting client feedback"). The description carries the context: what shipped, what is in review, what is needed from the client.

---

## Voice & Style Guidelines

These reports are emailed directly TO the client after calls. Every sentence should sound like it comes from a professional account manager, not a robot.

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Direct** | Address outcomes, not processes. Get to the point. |
| **Confident** | State facts without hedging. Avoid "may", "might", "could potentially". |
| **Warm but Professional** | Friendly enough to maintain the relationship, formal enough for business. |
| **Action-Oriented** | Focus on what was done and what's next, not how decisions were made. |
| **Concise** | Every word earns its place. 1-3 sentences per task description. |

### Client Addressing

These reports are sent DIRECTLY TO the client. Never refer to "the client" in third person.

**Transformation Rules:**

| Avoid (Third Person) | Use Instead (Direct/Neutral) |
|----------------------|------------------------------|
| "This report was prepared for the client" | "This report covers recent activity on your project" |
| "The client's website was updated" | "Your website has been updated" |
| "Waiting on the client to approve" | "Awaiting your approval" |
| "Delivered to the client" | "Delivered" or "Now live on your site" |
| "Per client feedback" | "Per your feedback" or "Based on feedback provided" |
| "The client can view this in Joint Basecamp" | "You can view this in Joint Basecamp" |

**Rules:**
- Use "you/your" when addressing client directly about their assets
- Use neutral phrasing when "you" feels awkward (e.g., "The homepage" instead of "Your homepage")
- Never use "the client" or "client's" to refer to THIS specific client
- Exception: Generic process terms like "client feedback" or "client approval" are acceptable when not referring to this specific client

### Forbidden Patterns

The following patterns make content sound robotic or AI-generated. Avoid them.

#### Punctuation

| Pattern | Problem | Fix |
|---------|---------|-----|
| Em dashes (---) | Overused; looks dramatic | Use commas, periods, or parentheses |
| Excessive semicolons (;) | Creates run-on sentences | Split into two sentences |
| Ellipses (...) | Sounds uncertain | End sentences decisively |

**Principle:** Prefer simple punctuation. When in doubt, use a period and start a new sentence.

#### Hedging Language

Remove these words unless genuinely uncertain:
- may, might, could, potentially, possibly
- appears to, seems to, it looks like
- likely, probably, presumably

**Principle:** State facts confidently. If something is done, say it's done. If it improved performance, say so directly.

| Avoid | Use Instead |
|-------|-------------|
| "This may help improve rankings" | "This improves ranking signals" |
| "The changes could potentially increase conversions" | "The changes target conversion improvement" |
| "It appears the issue has been resolved" | "The issue has been resolved" |

#### Buzzwords

Replace vague corporate language with specifics:
- leverage, utilize → "use"
- synergy, robust, comprehensive → describe what's actually included
- seamless, seamlessly → describe what actually happens
- holistic, best-in-class, cutting-edge → remove or be specific
- moving forward, going forward → "next" or just state what's next

**Principle:** If a word sounds like it belongs in a press release, replace it with plain language.

| Avoid | Use Instead |
|-------|-------------|
| "Leveraging best-in-class SEO practices" | "Applied schema markup and improved meta descriptions" |
| "Seamlessly integrated tracking" | "Tracking installed and verified working" |
| "Moving forward, we'll focus on optimization" | "Next: updating service page content" |

#### Filler Phrases

Delete these entirely - they add no value:
- "In order to" → "To"
- "It's important to note that" → just state it
- "Due to the fact that" → "Because"
- "With regard to" / "With respect to" → "About" or "For"
- "That being said" / "Having said that" → delete or use "However"
- "At the end of the day" → delete

**Principle:** If removing a phrase doesn't change the meaning, remove it.

### Sentence Structure

#### Length
- **Target:** 12-18 words per sentence on average
- **Maximum:** Split sentences over 25 words
- **Vary:** Mix short (5-10 words) and medium sentences for natural rhythm

#### Voice
- **Default:** Active voice ("The homepage now loads in under 2 seconds")
- **Exception:** Use passive voice when filtering out names ("Meta descriptions were updated across 15 pages")

#### Parallel Structure
Keep lists grammatically parallel:
- Wrong: "The work included updating meta tags, to optimize images, and speed improvements"
- Right: "The work included updating meta tags, optimizing images, and improving speed"

### Tone by Context

#### Completed Tasks
**Tone:** Confident, matter-of-fact, subtly positive

Good: "Schema implementation is complete and validated. Rich results are now appearing in search."
Too flat: "Schema was implemented."
Too enthusiastic: "Great news! The schema implementation is finally complete!"

#### In Progress Tasks
**Tone:** Clear, informative, forward-looking

Good: "Content audit is 60% complete. Remaining pages will be reviewed this week."
Too vague: "Working on the content audit."

#### Delays or Issues
**Tone:** Honest, solution-focused, not defensive

Good: "Implementation was paused to address a compatibility issue. Now resolved and moving forward."
Too apologetic: "Unfortunately, we ran into some problems that caused delays. We're very sorry."
Too blunt: "This was delayed."

#### Items Needing Client Action
**Tone:** Clear, specific, action-oriented without pressure

Good: "Awaiting your approval on the homepage design mockup."
Too passive: "The mockup is available for review if desired."
Too demanding: "We need you to approve this as soon as possible."

---

## Content Filtering

The AI must apply these rules when generating summaries:

### Filter Out Entirely

- Team member names (never mention who did what)
- @mentions
- Internal deadlines ("EOD", "before standup", "by Friday sync")
- Process debates ("should we use X or Y?", "I think we should...")
- Internal questions ("can you check this?", "does this look right?")
- Tool/credential requests ("need staging access", "waiting on login")
- Status check-ins between team members

### Names and Mentions

**Always remove:**
- Actual names: "John completed...", "Jordan said...", "Per Mike's feedback..."
- @mentions: "@john", "@jordan.smith"
- Email addresses
- Slack/Teams handles

**Rewrite to passive voice:**
```
Original: "John fixed the meta title issue on the homepage"
Rewritten: "Meta title issue on the homepage has been resolved"

Original: "Jordan approved the copy, Mike deployed it"
Rewritten: "Copy approved and deployed to production"
```

### Internal Process Details

**Remove references to:**
- Stand-ups, syncs, meetings: "discussed in standup", "per our sync"
- Internal deadlines: "need by EOD", "before Friday's meeting"
- Project-management tools: "updated in Asana", "see Slack thread"
- Internal debates: "we decided to go with approach A instead of B"

**Reframe as outcomes:**
```
Original: "Had a long discussion about whether to use Schema A or B, decided on B"
Rewritten: "Technical approach finalized"

Original: "Pushed to staging for Jordan to review, she found some issues, fixed them"
Rewritten: "Reviewed and refined before deployment"
```

### Client-Sensitive Information

**Be careful with:**
- Budget discussions
- Timeline delays (reframe positively)
- Technical debt or workarounds
- Negative feedback about client's existing site

### Reframe as Outcomes

| Internal Language | Client-Facing Reframe |
|-------------------|----------------------|
| "John fixed the bug" | "Issue resolved" |
| "Waiting on internal review" | "Under review" |
| "Team aligned on direction" | "Approach finalized" |
| "Jordan is working on this" | "In progress" |
| "Pushed to staging" | "In testing" |
| "QA passed" | "Testing completed" |
| "Going back and forth on copy" | "Copy being refined" |

### Preserve

- Client approvals and feedback
- Deliverables and milestones
- Measurable results ("improved load time by 2s", "15 pages updated")
- Items requiring client action (flag these clearly)
- External/public outcomes ("indexed in Search Console", "live on site")

---

## Error Handling

### Timeout Configuration

All external API calls have explicit timeouts to prevent indefinite hangs:

| Operation | Timeout | Notes |
|-----------|---------|-------|
| Basecamp API | 30 seconds | Per-request, uses AbortController |
| Gemini API (single) | 2 minutes | For summarization requests |
| Gemini Streaming | 3 minutes | For report compilation |

Timeout errors are NOT retried - if an API doesn't respond within the timeout, the thread is skipped.

### Basecamp API Errors

| Error | Handling |
|-------|----------|
| 401 Unauthorized | Refresh the OAuth token once (shared across concurrent requests) and retry; if that fails, show "Authentication failed. Please re-authorize with Basecamp." |
| 404 Not Found | Skip thread (no retry), note in output: "Thread not found - may have been deleted" |
| 429 Rate Limited | Wait for `Retry-After` (default 10 seconds), then retry with p-retry (max 2 retries) |
| Timeout | Skip thread (no retry), count in failed threads |
| Network Error | Retry with p-retry (max 2 retries) |
| Comments fetch fail | Use empty array, process thread without comments |

### Gemini API Errors

| Error | Handling |
|-------|----------|
| Invalid API Key | Show "Invalid Gemini API key. Please check .env" |
| Rate Limited | Queue and retry with backoff (p-retry, max 4 retries) |
| Timeout | Skip thread (no retry) |
| Safety Block | Skip thread (no retry), flag as "Content blocked by safety filter" |
| MAX_TOKENS | Log warning, use truncated response |
| Response Parse Error | 3-stage cleanup: direct parse → trailing comma fix → full sanitization |
| All parse attempts fail | Use fallback: include thread with "Manual review needed" note |

### Graceful Degradation

If a thread fails to process:
- Don't fail the entire report
- Include the thread with available info and a note
- Example: `* Task Title - Unable to process - [View Task](url)`
  - `  * This thread could not be automatically summarized. Please review manually.`

### Missing or Deleted Threads

If Basecamp returns 404:
```json
{
  "url": "original_url",
  "title": "Thread Not Found",
  "category": "SEO/DEV",
  "status": "Unable to retrieve",
  "description": "This thread may have been deleted or moved. Please verify manually.",
  "error": true
}
```

Output in report:
```markdown
* Thread Not Found - Unable to retrieve - [View Task](url)
  * This thread may have been deleted or moved. Please verify manually.
```

### Gemini Parse Failures

If a Gemini response is not valid JSON:
1. Parse it in 3 stages: direct parse, then trailing-comma removal, then full sanitization (single quotes, unquoted keys, newlines).
2. If parsing still fails, retry the request up to 4 times with exponential backoff (1s, 2s, 4s, 8s, with jitter).
3. If every attempt fails, include the thread using the fallback summary: category inferred from title keywords, status inferred from the checkbox and due date, and the description "This thread could not be automatically summarized. Please review manually."

### Empty Activity Log

If no valid URLs extracted:
```
No Basecamp thread URLs found in the provided activity log.

Please paste a Basecamp activity log containing URLs in this format:
https://3.basecamp.com/XXXXXX/buckets/XXXXXX/todos/XXXXXX
```
