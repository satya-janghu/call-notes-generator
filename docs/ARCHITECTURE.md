# Architecture

> **Related Documentation:** [PRD](PRD.md) | [Processing Logic](PROCESSING.md) | [AI Prompts](AI_PROMPTS.md) | [Style Guide](STYLE_GUIDE.md)

Call Notes Generator is a local web app. A user pastes a Basecamp activity log (and optionally the previous call's notes). The app fetches every referenced thread from the Basecamp API, summarizes each one with Gemini, and streams back a client-ready Markdown report.

## Pipeline

```
Activity log ──► 1. Parse URLs ──► 2. Fetch threads ──► 3. Summarize (Flash) ──► 4. Compile (Pro, streamed) ──► Markdown
                  (sync, dedupe)    (10 concurrent)      (2 concurrent, JSON)      (single call over SSE)
```

| Phase | Module | Notes |
|-------|--------|-------|
| Parse | `src/utils/parser.ts` | Extracts `3.basecamp.com/{account}/buckets/{project}/(todos\|messages)/{id}` URLs, drops todolist/project/fragment URLs, deduplicates |
| Fetch | `src/services/basecamp/client.ts` | Todo/message plus comments fetched in parallel with `Promise.allSettled`; commenter names replaced with "Person A", "Person B" before anything reaches the model |
| Summarize | `src/services/gemini/summarize.ts` | One structured-JSON call per thread, schema-enforced, validated, with a keyword-based fallback |
| Compile | `src/services/gemini/compile.ts` | One streamed call that groups by category and status and applies a final style pass |

Orchestration lives in `src/services/generation.ts`, which reports progress to the browser over Server-Sent Events.

## Tiered Models

| Tier | Default model | Env override | Temperature | Concurrency |
|------|---------------|--------------|-------------|-------------|
| Per-thread summarization | `gemini-2.5-flash` | `GEMINI_SUMMARIZE_MODEL` | 0.3 | 2 |
| Report compilation | `gemini-2.5-pro` | `GEMINI_COMPILE_MODEL` | 0.2 | 1 (streamed) |

## Reliability

**Timeouts** (`src/config.ts`, `src/utils/timeout.ts`):

| Operation | Timeout |
|-----------|---------|
| Basecamp API request | 30s (AbortController cancels the request) |
| Gemini request | 120s |
| Gemini stream (full duration) | 180s |

**Retries:**
- Basecamp: 2 retries, skipping 404s and timeouts.
- Gemini: 4 retries with exponential backoff (1s, 2s, 4s, 8s) and jitter, skipping timeouts, safety blocks and missing configuration.

**Graceful degradation:**
- If comments fail to load, the thread is processed without them.
- A deleted thread becomes a "Thread Not Found" placeholder.
- A failed summary becomes a fallback entry, so one bad thread never sinks the report.

**Token handling:**
- Access tokens refresh automatically 5 minutes before expiry.
- A 401 triggers one refresh, guarded by a mutex so concurrent requests share it.

**Response validation:**
- `finishReason` is checked: `SAFETY` blocks are not retried, and `MAX_TOKENS` is logged.
- Invalid categories fall back to SEO/DEV, and invalid statuses fall back to In Progress.
- JSON repair runs in 3 stages: direct parse → trailing-comma removal → full sanitization.

**Streaming:**
- Socket writability is checked before every SSE write.
- Client disconnects are detected.
- Mid-stream failures report how many chunks arrived.

## Input Budgets

- Pasted activity log and previous notes: 120,000 characters each (about 30K tokens), truncated at a sentence or paragraph boundary.
- Per thread: 20,000 characters. One third goes to the description and two thirds to comments.
- Comments go through a noise filter that drops "thanks", "+1", emoji-only and very short replies.
- The comment budget is then weighted by recency: 2x for the last 7 days, 1.5x for the last 14 days.
- Base64 images in previous notes are stripped in the browser and again on the server.

## Previous Notes & Joint Projects

- Previous notes are parsed for `* **Task** - Status - [View Task](url)` lines and matched to current threads by URL.
- A task that appears in 3 or more consecutive calls while still In Progress gets a stuck-task warning in its prompt.
- The Joint (client-visible) Basecamp project is identified from:
  1. the URL the user supplies; otherwise
  2. the first `[Joint Basecamp](url)` link in the previous notes.
- Tasks from the Joint project are limited to one sentence of at most 15 words.

## Security & Privacy

- The server binds to `127.0.0.1`. Setup endpoints write credentials to a local `.env` with 0600 permissions.
- The OAuth authorization request carries a one-time random `state`, which the callback verifies.
- Team member names never reach the model: comment authors are anonymized first, and the prompts forbid names, @mentions and Slack/Asana-style tool references.
- Errors sent to the browser pass through `sanitizeError()`; stack traces stay in the server log.
- Request bodies are capped at 5 MB.

## API Surface

`POST /api/generate` streams these SSE events:
- `phase`
- `progress`
- `content` (Markdown chunks)
- `error`
- `complete` (`threads`, `errors`, `duration`)

The `/auth/*` routes power the 3-step setup wizard. See the [PRD](PRD.md#api-endpoints).

## Code Map

```
bin/cli.ts                 CLI entry: loads .env, starts server (next free port from 3000), opens browser
src/server.ts              Express app, static files, root redirect to setup when credentials are missing
src/config.ts              Models, concurrency, limits, timeouts
src/routes/                auth.ts (setup wizard + OAuth), api.ts (preview + SSE generate)
src/services/generation.ts 4-phase orchestration
src/services/basecamp/     OAuth, token refresh, API client, response types
src/services/gemini/       summarize.ts (Flash), compile.ts (Pro, streaming)
src/prompts/               System and user prompts for both tiers
src/utils/                 parser, sse, markdown/JSON repair, timeout, validation
public/                    Vanilla HTML/CSS/JS UI with dark mode
tests/                     Vitest suite
```

## Development

```bash
npm install
npm run dev            # tsx watch with hot reload
npm run typecheck      # tsc --noEmit
npm run test:run       # run the Vitest suite once
npm run test:coverage  # coverage report (v8)
npm run build          # compile to dist/
npm start              # run the compiled CLI
```

**Conventions:**
- TypeScript strict mode, ES2022 target, NodeNext ESM modules. Several dependencies are ESM-only.
- Vitest runs with globals enabled.
- File paths use `path.resolve`.
- The browser is opened with the cross-platform `open` package.
- Terminal output avoids ANSI codes, for Windows CMD compatibility.
