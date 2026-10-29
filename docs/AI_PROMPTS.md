# AI Integration & Prompts

> **Related Documentation:** [PRD](PRD.md) | [Processing](PROCESSING.md) | [Style Guide](STYLE_GUIDE.md) | [Architecture](ARCHITECTURE.md)

The live prompts are in `src/prompts/summarize.ts` and `src/prompts/compile.ts`. This document explains how they are designed.

---

## Tiered Model Architecture

| | Tier 1: Summarize | Tier 2: Compile |
|---|---|---|
| Default model | `gemini-2.5-flash` | `gemini-2.5-pro` |
| Override | `GEMINI_SUMMARIZE_MODEL` | `GEMINI_COMPILE_MODEL` |
| Calls per report | One per thread | One |
| Output | JSON, enforced by `responseSchema` | Markdown, streamed |
| Temperature | 0.3 | 0.2 |
| Concurrency | 2 | 1 |
| Retries | 4, exponential backoff from 1s with jitter | Not retried |
| Timeout | 120s per call | 120s to start, 180s for the full stream |

The many small extraction jobs go to the fast, inexpensive model. The single report that needs judgment and polish goes to the stronger model. Cost scales with thread count: one Flash call per thread plus one Pro call per report.

---

## Tier 1: Per-Thread Summarization

### System prompt sections

1. **Critical rules:**
   - No team member names (use passive voice)
   - No internal process details
   - Preserve Joint Basecamp URLs
   - Extract page-level items for copy tasks
2. **Content filtering:** drop @mentions, email addresses, internal deadlines ("EOD", "Friday sync"), process debates, internal questions, tool references ("see Slack") and status check-ins. Rewrite to outcomes ("John fixed the issue" → "Issue has been resolved").
3. **Voice & style:**
   - Address the client as "you/your"
   - No hedging, em dashes, buzzwords or filler
   - 12–18 words per sentence on average, split anything over 25
   - Never invent results, metrics or timelines
4. **Category priority:** six categories, with the first match winning: PPC → Email Marketing → Social Media → Linkbuilding → Copywriting → SEO/DEV (default). See [Processing](PROCESSING.md#category-assignment).
5. **Status determination:** five fixed values (Completed, Live, In Progress, Blocked, Upcoming), assigned in priority order: checkbox → blocked indicators → activity in the last 7 days → upcoming.
6. **Stale task detection:** today's date is injected as `{currentDate}`, and the model sets `exclude: true` in three cases:
   - Zombie tasks: completed, with the last substantive comment more than 21 days old
   - No change since the previous call
   - Purely administrative activity in the last 21 days

   Tasks with a substantive comment in the last 14 days are never excluded.
7. **Title cleaning:** strips `SEO:`, `Dev:`, `Copy:`, `LB:` prefixes.

The opening line, "You are a call notes generator for {agency}", is filled from the optional `AGENCY_NAME` setting.

### User prompt (built per thread)

- **Thread data:**
  - type, title, URL, completion state, due date, description and comments
  - The 20,000-character thread budget gives one third to the description and two thirds to comments.
  - Low-value comments are filtered out.
  - The comment budget is weighted toward recent comments: 2x within 7 days, 1.5x within 14 days.
  - Commenters appear only as "Person A", "Person B" and so on.
- **Previous call context** (when the task was in the last notes):
  - The previous title, status and description go into the prompt, with an instruction to focus on what changed.
  - After 3 or more consecutive calls still In Progress, a stuck-task warning suggests marking the task Blocked or adding timeline context.
- **Joint project rules** (client-visible Basecamp): exactly one sentence of at most 15 words, focused on the outcome, and the thread URL returned as `jointBasecampUrl`.
- **URL classification hints** (copy tasks): links found in the thread are pre-sorted into Doc, Test/Staging and Live URLs so the model can fill `copyItems` accurately.

### Structured output

| Field | Type | Notes |
|-------|------|-------|
| `url` | string | Original Basecamp URL |
| `title` | string | Cleaned title |
| `category` | enum | `SEO/DEV`, `Copywriting`, `Linkbuilding`, `PPC`, `Email Marketing`, `Social Media` |
| `status` | enum | `Completed`, `Live`, `In Progress`, `Blocked`, `Upcoming` |
| `description` | string | 1–3 client-facing sentences |
| `jointBasecampUrl` | string or null | Client-visible thread link |
| `copyItems` | array | `{ pageName, liveUrl, docUrl, testUrl }` |
| `exclude` | boolean | Drop from the report (stale) |

### Validation and fallback

- `finishReason: SAFETY` is surfaced as a content block and not retried. `MAX_TOKENS` is logged and parsing is still attempted.
- JSON is parsed in 3 stages: direct → trailing commas removed → full sanitization.
- Out-of-range values are corrected: category falls back to SEO/DEV, and status falls back to In Progress.
- If all attempts fail, a fallback summary is built without AI:
  - category comes from title keywords, in the same priority order
  - status comes from the checkbox, blocked words in the title, and the due date
  - the thread is flagged for manual review

---

## Tier 2: Report Compilation

The compile prompt receives every non-excluded summary as JSON, plus task counts per category. It assembles the report as follows.

- **Grouping:** by category, in the order SEO/DEV, Copywriting, Linkbuilding, PPC, Email Marketing, Social Media. Within each category, by status: Completed, Live, In Progress, Blocked, Upcoming.
- **Format:**
  - Task lines read `* **Task Name** - Status - [View Task](url)`.
  - Descriptions are indented 2 spaces.
  - Copy items are indented 4 spaces: `* Page | [Live Page](url) | [Doc](url) | [Test Page](url)`.
  - `---` appears between categories only.
  - Empty categories and empty status groups are omitted.
- **Quality checklist:** the model re-checks every description for names, @mentions, internal deadlines, tool references and third-person "the client".
- **Final normalization:**
  - Replace em dashes
  - Change "utilize/leverage" → "use"
  - Remove hedging and filler
  - Split sentences over 25 words
- **Grouping hints:** when 2 or more tasks share a title prefix (for example "Homepage - Header" and "Homepage - Footer"), the prompt suggests consolidating them into one entry.

The response is streamed to the browser chunk by chunk, and any wrapping ```` ```markdown ```` fence is stripped as it arrives.

---

## Example Output

```markdown
## SEO/DEV

### Completed

* **Fix Meta Title Duplicates** - Completed - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451)
  * Duplicate meta titles corrected across 15 service pages. Changes verified in Search Console.

### In Progress

* **Core Web Vitals Optimization** - In Progress - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005452)
  * Improvements for LCP and CLS are in final testing before deployment.

---

## Copywriting

### Live

* **Service Pages Copy** - Live - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005453)
  * All service page copy is finalized and published on your site.
    * Roof Repair | [Live Page](https://www.acme-roofing.example.com/roof-repair) | [Doc](https://docs.google.com/document/d/example)
    * Gutter Installation | [Live Page](https://www.acme-roofing.example.com/gutters) | [Doc](https://docs.google.com/document/d/example2)
```
