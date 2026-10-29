# Call Notes Generator - Product Requirements Document

> **Related Documentation:** [Processing Logic](PROCESSING.md) | [AI Prompts](AI_PROMPTS.md) | [Style Guide](STYLE_GUIDE.md) | [Architecture](ARCHITECTURE.md)

## Overview

A local web application that generates client-facing call notes from Basecamp project activity. Users paste a Basecamp activity log, the app fetches thread details via Basecamp API, summarizes each thread using Gemini AI, and compiles a formatted Markdown report.

**Target Users:** Digital producers and account managers at digital marketing agencies

**Distribution:** Each user runs the app locally with their own API credentials. There is no hosted service and no shared data store.

---

## Goals

1. **Eliminate manual report writing** - Currently takes 30-60 min per client, should take < 5 min
2. **Consistent formatting** - Every report follows agency standards
3. **No context pollution** - Each run is fresh, no carryover from previous sessions
4. **Easy distribution** - New team members can set up and run it with minimal friction

---

## Technical Requirements

### Single Command Launch

After initial setup, users launch with one command:

```bash
callnotes
```

This should:
1. Start local server on `localhost:3000` (or next available port)
2. Auto-open default browser to the app
3. Display ready state in terminal

**Implementation:** Use `bin` field in package.json to register global command.

### Cross-Platform Compatibility

The app must work seamlessly on **Windows**, **macOS**, and **Linux**.

| Feature | Implementation |
|---------|----------------|
| Browser auto-open | Use `open` npm package (cross-platform) |
| File paths | Use `path.join()` and `path.resolve()` everywhere |
| Environment variables | Use `dotenv` package |
| Terminal output | Avoid ANSI codes that don't work on Windows CMD |

**CLI Entry Point (`bin/cli.ts`):**
```javascript
#!/usr/bin/env node
import open from 'open';
import { resolve } from 'path';

// Works on Windows, Mac, and Linux
await open(`http://localhost:${port}`);
```

**Windows-Specific Notes:**
- npm global installs may require running terminal as Administrator
- PowerShell and CMD are both supported
- Paths with spaces are handled correctly via quoting

### Technology Stack

- **Language:** TypeScript 5.9
- **Runtime:** Node.js v22+ LTS
- **Module System:** ESM (`"type": "module"` in package.json) - Required by several dependencies
- **Framework:** Express.js 5.x (native async error handling, improved security)
- **Frontend:** Vanilla HTML/CSS/JS (minimal, no build step for frontend)
- **AI SDK:** `@google/genai` - Official Google Gen AI SDK for JavaScript (replaces deprecated `@google/generative-ai`)
- **Basecamp:** Direct REST API calls with OAuth 2.0
- **Build Tools:** `tsx` for development (runs .ts directly), `tsc` for production build

**Production Dependencies:**

| Package | Version | Purpose |
|---------|---------|---------|
| `@google/genai` | ^1.30.0 | Gemini AI API client (supports Gemini 2.5 models) |
| `express` | ^5.0.1 | Web server framework (requires Node.js 18+) |
| `dotenv` | ^17.2.3 | Environment variable loading |
| `open` | ^10.1.0 | Cross-platform browser opening (ESM only) |
| `p-limit` | ^6.2.0 | Concurrency control for parallel requests (ESM only) |
| `p-retry` | ^6.2.1 | Retry failed requests with backoff (ESM only) |

**Note:** No external timeout libraries are used. Timeout functionality is implemented using built-in `AbortController` and `Promise.race` patterns in `src/utils/timeout.ts`.

**Development Dependencies:**

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.3 | TypeScript compiler |
| `tsx` | ^4.19.4 | TypeScript execution for development |
| `vitest` | ^4.0.15 | Test runner |
| `supertest` | ^7.1.4 | HTTP route testing |
| `@vitest/coverage-v8` | ^4.0.15 | Coverage reports |
| `@types/node` | ^22.15.0 | Node.js type definitions |
| `@types/express` | ^5.0.0 | Express type definitions |

**ESM Configuration:**

The project uses ES Modules due to ESM-only dependencies (open, p-limit, p-retry):

```json
// package.json
{
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  }
}
```

```json
// tsconfig.json key settings
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

### Configuration

Credentials are managed via `.env` file in project root. The setup wizard helps users populate this file automatically.

```env
# Basecamp OAuth (user provides after app registration)
BASECAMP_CLIENT_ID=your_client_id
BASECAMP_CLIENT_SECRET=your_client_secret

# Auto-populated after OAuth flow
BASECAMP_ACCESS_TOKEN=
BASECAMP_REFRESH_TOKEN=
BASECAMP_TOKEN_EXPIRES_AT=

# Gemini API
GEMINI_API_KEY=your_api_key

# Model Configuration (optional - uses defaults if not set)
GEMINI_SUMMARIZE_MODEL=gemini-2.5-flash
GEMINI_COMPILE_MODEL=gemini-2.5-pro

# Agency name used in AI prompts (optional)
AGENCY_NAME=

# Server Configuration (optional)
PORT=3000
```

Provide `.env.example` with placeholder values and clear instructions.

**Security Notes:**

- The `.env` file contains sensitive credentials (API keys, OAuth secrets). Never commit it to version control.
- Ensure `.env` is listed in `.gitignore` (included by default).
- The Gemini API key grants access to paid API usage. Treat it like a password.
- For shared machines, consider file permissions: `chmod 600 .env` (Unix/Mac).

---

## User Interface

### Two-Step Wizard Flow

The main interface is a stepwise wizard that collects inputs before processing:

#### Step 1: Previous Call Notes (Optional)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1 OF 2: Previous Call Notes                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Have previous call notes for this client?                  │
│  Paste them here to track progress between calls.           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                                                      │    │
│  │  [Textarea - placeholder: "Paste previous notes..."] │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  i Images will be automatically removed to save tokens      │
│                                                              │
│                [Skip this step]  [Continue →]               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Base64 Image Stripping:**

Previous call notes may contain pasted screenshots encoded as base64. These must be stripped client-side before sending to the backend to avoid wasting AI tokens.

```javascript
// Frontend: Strip base64 images from markdown before processing
function stripBase64Images(markdown) {
  // Remove ![alt](data:image/...) patterns
  return markdown.replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '[image removed]');
}

// Usage: when user clicks "Next" in Step 1
const cleanedNotes = stripBase64Images(previousNotesTextarea.value);
```

#### Step 2: Basecamp Activity Log (Required)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 2 OF 2: Basecamp Activity Log                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Paste the Basecamp activity log for this client.           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                                                      │    │
│  │  [Textarea for activity log]                        │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ✓ Found 12 threads (8 todos, 4 messages)           │    │
│  │    2 duplicates removed                              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Joint Basecamp URL (optional)                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  https://3.basecamp.com/.../buckets/55555555/...    │    │
│  └─────────────────────────────────────────────────────┘    │
│  i Tasks from this project get stricter content filtering   │
│                                                              │
│                    [← Back] [Generate Call Notes]           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Real-Time URL Extraction Preview:**

As the user pastes content, JavaScript extracts URLs client-side and displays instant feedback:

```javascript
// Frontend: Extract and count URLs on paste/input
function updateUrlPreview(activityLog) {
  const urlRegex = /https:\/\/3\.basecamp\.com\/(\d+)\/buckets\/(\d+)\/(todos|messages)\/(\d+)/g;
  const matches = [...activityLog.matchAll(urlRegex)];

  // Deduplicate by full URL (without fragments)
  const unique = [...new Set(matches.map(m => m[0]))];
  const todos = unique.filter(u => u.includes('/todos/')).length;
  const messages = unique.filter(u => u.includes('/messages/')).length;

  return {
    total: unique.length,
    todos,
    messages,
    duplicatesRemoved: matches.length - unique.length
  };
}
```

#### Step 3: Processing & Output

**During Processing:**
```
┌─────────────────────────────────────────────────────────────┐
│  Generating Call Notes...                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ████████████░░░░░░░░░░░░░░░░ 40%                           │
│  Processing thread 8 of 20...                                │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ## SEO/DEV                                         │    │
│  │                                                      │    │
│  │  ### Completed                                       │    │
│  │                                                      │    │
│  │  * Meta Title Fix - Live - [View Task](url)         │    │
│  │    * Duplicate meta titles resolved...              │    │
│  │  [streaming output appears here]                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**After Completion (Success State):**
```
┌─────────────────────────────────────────────────────────────┐
│  ✓ Call Notes Generated Successfully                        │
│    12 threads processed • 0 errors • 18 seconds             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  [Full markdown output displayed here]              │    │
│  │  ## SEO/DEV                                         │    │
│  │  ### Completed                                       │    │
│  │  * Meta Title Fix - Live - [View Task](url)         │    │
│  │    * Duplicate meta titles resolved...              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│      [Copy to Clipboard ★]  [Download .md]  [Start Over]    │
│                                                              │
│  ★ = Primary action (visually emphasized)                   │
└─────────────────────────────────────────────────────────────┘
```

### UI States

- **Step 1:** Previous notes input (optional, "Skip this step" or "Continue")
- **Step 2:** Activity log input (required) + Joint Basecamp URL (optional) + URL preview
- **Processing:** Progress bar, streaming output
- **Complete:** Success banner with stats, full output displayed, action buttons (Copy emphasized)
- **Error:** Error message with details, retry option

### Design

Keep it simple and functional. No need for elaborate styling. Clean, readable, works.

---

## Installation & Setup

### Prerequisites

- Node.js v22 or higher (LTS recommended)
- Basecamp account with API access
- Google AI Studio account (for Gemini API key)
- Works on **Windows**, **macOS**, and **Linux**

### First-Time Setup

```bash
# 1. Clone the project
git clone https://github.com/satya-janghu/call-notes-generator.git
cd call-notes-generator

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Install globally (enables `callnotes` command)
npm install -g .

# 5. Launch the app
callnotes
```

On first launch, the app will open a **Setup Wizard** in your browser to guide you through Basecamp and Gemini configuration. No manual `.env` editing required!

---

## First-Time Setup Guide

This guide walks you through connecting Call Notes Generator to Basecamp and Gemini. Even if you're not technical, follow these steps and you'll be up and running in about 5 minutes.

### Step 1: Register Your Basecamp App

You need to create a "Basecamp App" to allow Call Notes Generator to access your Basecamp data.

1. **Open the registration page:**
   [https://launchpad.37signals.com/integrations](https://launchpad.37signals.com/integrations)

2. **Click "Register a new app"** (or similar button)

3. **Fill in the form with these exact values:**

   | Field | What to Enter |
   |-------|---------------|
   | **App Name** | `callnotes` (adding your name, e.g. `callnotes-alex`, helps when several teammates register apps) |
   | **Company Name** | Your agency's name |
   | **Website URL** | `http://localhost:3000` |
   | **Products** | Select **Basecamp 4** |
   | **Redirect URI** | `http://localhost:3000/auth/callback` |

4. **Click "Register this app"**

### Step 2: Get Your Client ID and Client Secret

After registration:

1. You'll see your app listed on the integrations page
2. **Click on your app name** (the blue clickable text, NOT the pencil/edit icon)
3. You'll now see:
   - **Client ID** - A long string of characters
   - **Client Secret** - Another long string (keep this private!)

**Important:** Copy both values somewhere safe. You'll need them in the next step.

### Step 3: Enter Credentials in the App

When you run `callnotes` for the first time:

1. The app opens in your browser showing the **Setup Wizard**
2. Paste your **Client ID** in the first field
3. Paste your **Client Secret** in the second field
4. Click **"Connect to Basecamp"**

### Step 4: Authorize with Basecamp

1. You'll be redirected to Basecamp's authorization page
2. Review the permissions requested
3. Click **"Yes, I'll allow access"**
4. You'll be redirected back to Call Notes Generator

**That's it for Basecamp!** The app will automatically save your tokens and refresh them when needed.

### Step 5: Add Your Gemini API Key

1. Open: [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **"Create API Key"**
3. Copy the generated key
4. Back in Call Notes Generator, paste it in the Gemini API Key field
5. Click **"Save"**

### You're Done!

The Setup Wizard will close and you'll see the main Call Notes interface. You're ready to generate call notes!

---

## In-App Setup Wizard

The app includes a user-friendly setup wizard that appears on first launch or when credentials are missing.

### Progress Stepper

```
┌─────────────────────────────────────────────────────────────────┐
│                      CALL NOTES SETUP                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ● ─────────── ○ ─────────── ○                                 │
│   Basecamp      Connect       Gemini                            │
│   App           Account       AI                                │
│                                                                  │
│  ═══════════════════════════════════════════════════════════    │
│                                                                  │
│  [Current step content appears here]                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Wizard States

| State | What's Shown | Entry Point |
|-------|--------------|-------------|
| **Fresh install** | Full wizard starting at Step 1 | First launch |
| **Basecamp connected, no Gemini** | Wizard starting at Step 3 | Missing Gemini key |
| **All connected** | Main app interface | Normal operation |

---

## File Structure

```
call-notes-generator/
├── bin/cli.ts                    # `callnotes` entry point: loads .env, starts server, opens browser
├── src/
│   ├── server.ts                 # Express app, static files, root redirect, /health
│   ├── config.ts                 # Models, concurrency, limits, timeouts
│   ├── types.ts                  # Shared interfaces
│   ├── routes/
│   │   ├── auth.ts               # Setup wizard + OAuth endpoints
│   │   └── api.ts                # /api/preview and /api/generate (SSE)
│   ├── services/
│   │   ├── generation.ts         # 4-phase pipeline orchestration
│   │   ├── basecamp/             # OAuth, token refresh, API client
│   │   └── gemini/               # summarize.ts (Flash), compile.ts (Pro, streamed)
│   ├── prompts/                  # System + user prompts for both tiers
│   └── utils/                    # parser, sse, markdown/JSON repair, timeout, validation
├── public/                       # index.html, setup.html, app.js, styles.css
├── tests/                        # Vitest suite
└── docs/
```

---

## API Endpoints

### Setup & Authentication

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/status` | Returns `{ hasBasecampCredentials, hasBasecampTokens, hasGeminiKey, isComplete }` |
| POST | `/auth/basecamp-credentials` | Saves `{ clientId, clientSecret }` to `.env` |
| GET | `/auth/setup` | Generates a one-time OAuth `state` and redirects to Basecamp authorization |
| GET | `/auth/callback` | Verifies `state`, exchanges `code` for tokens, saves them, redirects to the next setup step |
| POST | `/auth/gemini-key` | Saves `{ apiKey }` to `.env` |
| POST | `/auth/disconnect` | Clears tokens from the running process |

### Generation

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/preview` | Returns `{ total, todos, messages, duplicatesRemoved }` for a pasted activity log |
| POST | `/api/generate` | Runs the pipeline and streams Server-Sent Events |
| GET | `/health` | Returns `{ "status": "ok" }` |

**`POST /api/generate` request:**
```json
{
  "activityLog": "raw pasted activity log",
  "previousNotes": "optional previous call notes markdown",
  "jointBasecampUrl": "optional Joint Basecamp project URL"
}
```

**SSE events:**

| Event | Data |
|-------|------|
| `phase` | `{ "phase": "parsing" \| "fetching" \| "summarizing" \| "compiling", "description": "..." }` |
| `progress` | `{ "current": 3, "total": 12, "phase": "fetching", "thread": "..." }` |
| `content` | Streamed Markdown chunk (string) |
| `error` | `{ "message": "user-safe error message" }` |
| `complete` | `{ "threads": 12, "errors": 0, "duration": 18.5 }` |

---

## Success Criteria

1. **Functional:** Generates accurate, well-formatted call notes from activity log
2. **Fast:** Complete report in < 60 seconds for typical activity log (10-20 threads)
3. **Reliable:** Handles errors gracefully, doesn't crash on edge cases
4. **Usable:** A new user can set up and run it within 10 minutes using the README
5. **Accurate:** Output matches agency formatting standards as defined in this document

## Stability & Error Handling

The application implements comprehensive stability measures to prevent hangs and provide meaningful error feedback:

### Timeout Configuration

All external API calls have explicit timeouts (configured in `src/config.ts`):

| Operation | Timeout | Rationale |
|-----------|---------|-----------|
| Basecamp API | 30 seconds | Individual API calls should be fast |
| Gemini API | 2 minutes | AI inference can be slow |
| Gemini Streaming | 3 minutes | Full report compilation takes longer |

### Error Handling Strategy

| Failure Type | Behavior | User Impact |
|--------------|----------|-------------|
| Basecamp timeout | Request fails, retries not attempted | Thread skipped with error count |
| Basecamp 404 | Request fails, no retry | Thread skipped (thread may have been deleted) |
| Basecamp comments fail | Empty array fallback | Thread processed without comments |
| Gemini timeout | Request fails, no retry | Thread summary skipped |
| Gemini safety block | Request fails, no retry | Thread flagged as containing sensitive content |
| Gemini MAX_TOKENS | Warning logged, response used | Possible truncation (rare) |
| SSE write error | Connection marked closed | Client receives partial output |
| JSON parse failure | 3-stage cleanup attempted | Falls back to raw text if all fail |

### Graceful Degradation

- **Comments fetch failure:** If comments cannot be fetched for a thread, the main content is still processed with an empty comments array. A warning is logged.
- **Partial thread failures:** Individual thread failures don't stop the entire report. Failed threads are counted and reported in final stats.
- **Client disconnection:** SSE writer detects when the client disconnects and stops attempting writes.

---

## Acceptance Criteria

Version 1 is accepted when the app:

- Extracts URLs correctly from sample activity logs
- Handles URLs with fragments (strips #__recording_*)
- Deduplicates repeated URLs
- Fetches todo details from Basecamp API
- Fetches message details from Basecamp API
- Fetches comments for both types
- Correctly determines status from checkbox + comments
- Assigns correct category based on keywords
- Removes team member names from output
- Extracts Joint Basecamp URLs when present
- Extracts copy items with Doc/Test/Live links
- Produces correctly formatted Markdown
- Omits empty categories and status groups
- Handles 404 errors gracefully
- Handles Gemini failures gracefully
- Processes multiple threads in parallel
- Completes typical report (15-20 threads) in < 60 seconds
- Previous notes parsing extracts tasks correctly
- Previous notes matching identifies returning tasks
- Joint project tasks receive stricter filtering
- Task continuity is reflected in descriptions

---

## Future Enhancements (Out of Scope for V1)

- Direct Basecamp project selection (instead of pasting activity log)
- Multiple output format options (Google Docs, Notion)
- Template customization per client
- Historical report storage
- Batch processing for multiple clients
- Multi-provider model support (e.g. OpenAI for structured per-thread extraction alongside Gemini)

---

## Appendix: Sample Input/Output

### Sample Activity Log Input

```
Activity for Project XYZ - Last 7 days

• John D. completed "Fix meta title duplicates"
  https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451

• Jordan M. commented on "Homepage copy refresh"
  https://3.basecamp.com/1234567/buckets/12345678/todos/9000005452

• New to-do added: "Implement schema markup"
  https://3.basecamp.com/1234567/buckets/12345678/todos/9000005453

• Mike R. commented on "Publisher outreach Q1"
  https://3.basecamp.com/1234567/buckets/12345678/todos/9000005454
```

### Sample Output

```markdown
## SEO/DEV

### Completed

* Meta Title Duplicates - Completed - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005451)
  * Duplicate meta titles across service pages have been corrected. Search Console indexing confirmed.

### In Progress

* Schema Markup Implementation - In Progress - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005453)
  * LocalBusiness and Service schema being added to primary service pages.

---

## Copywriting

### In Progress

* Homepage Copy Refresh - In Progress - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005452)
  * Homepage copy updates in final review before publishing.
    * Hero Section | [Doc](https://docs.google.com/...) | [Test Page](https://example.com/test)
    * About Intro | [Doc](https://docs.google.com/...)

---

## Linkbuilding

### In Progress

* Publisher Outreach Q1 - In Progress - [View Task](https://3.basecamp.com/1234567/buckets/12345678/todos/9000005454)
  * Initial outreach to 8 publishers completed. Awaiting responses.
```

---

*Document Version: 4.0*

---

## Changelog

### Version 4.0
- Split the PRD into focused documents: `PROCESSING.md` (parsing, Basecamp API, status and category logic), `AI_PROMPTS.md` (prompts and tiered model architecture) and `STYLE_GUIDE.md` (voice, content filtering, output format)
- Added cross-reference navigation headers to all documentation files

### Version 3.5
- Finalized the tech stack (Node.js v22+, Express 5, @google/genai)
- Added ESM configuration requirements

### Version 3.0–3.4
- Merged the processing and previous-notes specifications into the PRD
- Added Voice & Style Guidelines
- Redesigned the in-app setup wizard
- Added the tiered model architecture (Flash for per-thread work, Pro for final compilation)
