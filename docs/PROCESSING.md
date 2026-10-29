# Processing Logic

> **Related Documentation:** [PRD](PRD.md) | [AI Prompts](AI_PROMPTS.md) | [Style Guide](STYLE_GUIDE.md) | [Architecture](ARCHITECTURE.md)

This document details the logic for processing Basecamp activity logs and fetching thread data.

---

## Activity Log Parsing

### What is an Activity Log?

Users copy/paste text from Basecamp's activity feed. It's unstructured text containing:
- Action descriptions ("completed", "commented on", "added")
- Person names (ignore these)
- Task/message titles
- Basecamp URLs

### Sample Activity Log

```
Activity for Acme Roofing Co. - Last 7 days

John D. completed Fix meta title duplicates
https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451

Jordan M. commented on Homepage copy refresh
https://3.basecamp.com/1234567/buckets/12345678/todos/9000005452
"All pages are now live, see links below"

New to-do added: Implement schema markup for service pages
https://3.basecamp.com/1234567/buckets/12345678/todos/9000005453

Mike R. commented on Publisher outreach Q1
https://3.basecamp.com/1234567/buckets/12345678/messages/9000005454

Completed: Update GA4 conversion tracking
https://3.basecamp.com/1234567/buckets/12345678/todos/9000005455#__recording_9000005456
```

### URL Extraction Rules

**Valid URL patterns to extract:**

```
https://3.basecamp.com/{account_id}/buckets/{project_id}/todos/{todo_id}
https://3.basecamp.com/{account_id}/buckets/{project_id}/messages/{message_id}
```

**Regex pattern:**
```javascript
/https:\/\/3\.basecamp\.com\/(\d+)\/buckets\/(\d+)\/(todos|messages)\/(\d+)/g
```

**From each match, extract:**
- `account_id` (group 1) - e.g., "1234567"
- `project_id` (group 2) - e.g., "12345678"
- `type` (group 3) - "todos" or "messages"
- `recording_id` (group 4) - e.g., "9000005451"

### URLs to Exclude

1. **Fragment anchors** - URLs ending with `#__recording_*`
   ```
   # BAD - skip this
   https://3.basecamp.com/1234567/buckets/12345678/todos/9000005455#__recording_9000005456

   # GOOD - extract this
   https://3.basecamp.com/1234567/buckets/12345678/todos/9000005455
   ```

2. **Todolist URLs** (containers, not individual tasks):
   ```
   # BAD - skip
   https://3.basecamp.com/1234567/buckets/12345678/todolists/9000005400
   ```

3. **Project URLs**:
   ```
   # BAD - skip
   https://3.basecamp.com/1234567/projects/12345678
   ```

### Deduplication

The same URL may appear multiple times in an activity log. Deduplicate before processing.

---

## Fetching Thread Data from Basecamp API

### Endpoints

For each extracted URL, make two API calls:

**1. Get the recording (todo or message) details**

For todos:
```
GET https://3.basecampapi.com/{account_id}/buckets/{project_id}/todos/{todo_id}.json
```

Response includes:
- `title` - Task title
- `completed` - boolean, whether checkbox is checked
- `content` - HTML description (may contain links)
- `due_on` - Due date if set
- `assignees` - Array of assigned people (ignore names, but indicates active work)

For messages:
```
GET https://3.basecampapi.com/{account_id}/buckets/{project_id}/messages/{message_id}.json
```

Response includes:
- `subject` - Message title
- `content` - HTML body

**2. Get all comments on the recording**

```
GET https://3.basecampapi.com/{account_id}/buckets/{project_id}/recordings/{recording_id}/comments.json
```

Response is array of comments, each with:
- `content` - HTML comment body
- `created_at` - Timestamp
- `creator` - Person object (ignore name, but note for context)

### Headers

```
Authorization: Bearer {access_token}
User-Agent: CallNotesGenerator (https://github.com/satya-janghu/call-notes-generator)
Content-Type: application/json
```

### Rate Limiting

Basecamp allows 50 requests per 10 seconds. The client caps concurrency at 10 requests (p-limit), retries transient failures twice (p-retry), never retries 404s or timeouts, and on HTTP 429 waits for the `Retry-After` header (default 10 seconds) before retrying. A 401 triggers a single token refresh, shared across concurrent requests through a mutex, then one retry.

### Data Format for Gemini

Compile thread data into a structured format:

```
THREAD TYPE: todo
THREAD TITLE: Fix meta title duplicates
THREAD URL: https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451
COMPLETION STATUS: completed (checkbox checked)
DUE DATE: none

DESCRIPTION:
<p>Review all service pages and fix duplicate meta titles showing in Search Console.</p>

COMMENTS (oldest to newest):

[2024-12-01 09:30] Person A:
Started audit, found 15 pages with duplicate titles.

[2024-12-03 14:20] Person B:
Fixed 10 pages, 5 remaining. Will finish today.

[2024-12-03 18:45] Person A:
All done. Pushed to production. Search Console should update within a week.

[2024-12-05 10:00] Person B:
Confirmed - duplicates no longer showing in Search Console.
```

**Important:** Include person identifiers (Person A, Person B) for context so the AI understands the conversation flow, but instruct it to NEVER include names in output.

---

## Status Determination

Every task gets exactly one of five statuses: **Completed**, **Live**, **In Progress**, **Blocked** or **Upcoming**. The model applies these signals in priority order:

1. **Checkbox state:** `completed: true` → "Completed", or "Live" for user-facing work (deployed, published, indexed, launched, shipped).
2. **Blocked indicators** (incomplete tasks only): comments containing "waiting on client", "need client feedback", "pending approval", "waiting for", "blocked by", "need from client" or "on hold"; no activity in 14+ days; or a due date that has passed.
3. **Recent activity:** activity within the last 7 days on an incomplete task → "In Progress".
4. **Otherwise:** "Upcoming".

In the compiled report, Blocked tasks carry a short reason, e.g. "Blocked - Awaiting client feedback".

### Stale Task Exclusion

The summarizer sets `exclude: true` and the task is dropped from the report when:

- **Zombie task:** the task is completed and its most recent substantive comment is more than 21 days old.
- **No meaningful update:** the task was in the previous notes, its status is unchanged, and there are no new comments since the last call.
- **Purely administrative:** every comment in the last 21 days is a checkbox change, a reassignment or a "closing this out" note.

A task is never excluded if it has a substantive comment from the last 14 days, is new since the previous notes, or contains deliverables the client has not seen.

### Fallback When AI Summarization Fails

If a thread cannot be summarized after retries, the app still includes it. The category is inferred from title keywords, in the priority order PPC > Email Marketing > Social Media > Linkbuilding > Copywriting > SEO/DEV. The status is inferred from the checkbox, blocked words in the title, and the due date. The description reads "This thread could not be automatically summarized. Please review manually."

---

## Category Assignment

Assign ONE of six categories. When keywords for several categories match, the first applicable category in this priority order wins:

1. **PPC:** PPC, paid search, Google Ads, Meta Ads, Facebook Ads, ad copy, campaigns, bidding, ROAS, CPC, CPM, remarketing, display ads, shopping ads, Performance Max, paid media, ad spend, conversion tracking
2. **Email Marketing:** email campaign, newsletter, drip campaign, automation, Klaviyo, Mailchimp, email sequence, broadcast, subscriber, open rate, click rate, email template, email list
3. **Social Media:** Instagram, Facebook post, LinkedIn post, TikTok, social post, content calendar, reels, stories (Reddit and forum engagement count as SEO, not Social)
4. **Linkbuilding:** link, backlink, outreach, publisher, guest post, PR, press release, mention, citation, directory, DA, placement
5. **Copywriting:** copy, content, writing, blog, article, landing page, headline, messaging, draft, revision, FAQ, product descriptions
6. **SEO/DEV** (default): SEO, meta, title tag, schema, JSON-LD, Search Console, indexing, sitemap, robots.txt, canonical, redirects, GA4, GTM, tracking, Core Web Vitals, development, bugs, deploys, design, UX, mobile

Example: "Landing page for Google Ads campaign" → PPC, not Copywriting.

### Title Prefixes to Remove

Department prefixes are stripped from task titles: `SEO:`, `Dev:`, `Copy:`, `LB:`, `PPC:`, `Email:`, `Social:` (and the same prefixes followed by ` -`).

Example: `SEO: Fix meta title duplicates` → `Fix meta title duplicates`

---

## Special Content Extraction

### Joint Basecamp URLs

"Joint Basecamp" refers to a shared Basecamp project visible to the client. These URLs must be preserved and linked in the output.

**How to identify (Priority Order):**

1. **User-provided URL (Primary):** The user provides the Joint Basecamp project URL in Step 2 of the wizard (alongside the activity log). Extract the `bucket_id` (project ID) from this URL and flag any task from that project.

2. **Previous notes extraction (Fallback):** If no URL is provided, scan previous call notes for `[Joint Basecamp](url)` patterns and extract the project ID.

3. **In-thread detection (Supplementary):** Additionally scan thread comments for explicit mentions:
   ```
   "Updated in Joint Basecamp: https://3.basecamp.com/..."
   "See client-facing thread: [link]"
   ```

**URL pattern to extract project ID:**
```
https://3.basecamp.com/{account_id}/buckets/{project_id}/...
                                           ^^^^^^^^^^^^
                                           Extract this
```

**Output format:**

Add at end of description with anchor text "Joint Basecamp":
```markdown
* Task Name - Status - [View Task](internal-url)
  * Description of the work completed. [Joint Basecamp](joint-url)
```

### Copy Task Items Extraction

For Copywriting tasks, extract individual page items with their associated URLs.

**What to look for in comments:**

1. Lists of pages with links:
   ```
   FAQs | Doc | Test Page
   - FAQs: https://docs.google.com/... | https://example.com/faqs-test
   - About: [Doc](https://docs.google.com/...) | [Staging](https://...)
   ```

2. Status updates with links:
   ```
   All pages are now live:
   • Homepage - https://example.com/
   • About Us - https://example.com/about
   • Services - https://example.com/services
   ```

3. Various formats (be flexible):
   ```
   FAQs | [Live Page](url) | [Doc](url) | [Test Page](url)
   FAQs - Live: url | Doc: url
   FAQs (https://example.com/faqs) - Doc (https://docs.google.com/...)
   ```

**URL type identification:**

| URL Pattern | Type |
|-------------|------|
| `docs.google.com`, `drive.google.com`, `notion.so`, `dropbox.com`, or a `.doc`/`.docx`/`.pdf` file | Doc |
| Contains `-test`, `-staging`, `staging-`, `test-`, `.staging.`, `.test.`, `.dev.`, `.local`, `localhost`, or a preview host (`*.vercel.app`, `*.netlify.app`, `*.pages.dev`) | Test/Staging |
| Main domain without test indicators | Live |

**Link progression:**

Pages typically progress through stages:
1. **Draft:** Doc link only
2. **Review:** Doc + Test/Staging links
3. **Published:** Doc + Live links (Test may still be present)

Use the LATEST status for each page. If both Test and Live exist, Live takes precedence (meaning it's published).

**Output format:**

```markdown
* Service Pages Copy Update - Live - [View Task](url)
  * All service page copy has been updated and published.
    * Roof Repair | [Live Page](url) | [Doc](url)
    * Gutter Installation | [Live Page](url) | [Doc](url) | [Test Page](url)
    * Storm Damage Restoration | [Live Page](url) | [Doc](url)
    * Commercial Roofing | [Live Page](url) | [Doc](url)
```

**Ordering of link types:**

Prefer this order, but be flexible: `[Live Page]` | `[Doc]` | `[Test Page]`

Only include links that exist - don't add empty placeholders.
