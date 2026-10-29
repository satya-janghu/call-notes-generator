# Installation

## Prerequisites

- **Node.js v22+** (LTS recommended)
- **npm** (included with Node.js)
- **Basecamp 4 account** with admin access to create integrations
- **Google AI Studio account** for Gemini API access

## Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/satya-janghu/call-notes-generator.git
   cd call-notes-generator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript source:
   ```bash
   npm run build
   ```

4. (Optional) Install globally to enable the `callnotes` command:
   ```bash
   npm install -g .
   ```

   **Note for Windows users:** If `callnotes` is not recognized after global install, you may need to add npm's global bin directory to your PATH. Run `npm config get prefix` to find the path, then add it to your system PATH. Alternatively, use `npm start` or `npx callnotes`.

## Configuration

The app requires three API credentials. A setup wizard will guide you through this process on first run.

### 1. Basecamp OAuth Credentials

1. Go to [Basecamp Integrations](https://launchpad.37signals.com/integrations)
2. Click "Register a new application"
3. Fill in the following:
   - **App Name:** callnotes
   - **Company:** Your company name
   - **Website URL:** http://localhost:3000
   - **Redirect URI:** http://localhost:3000/auth/callback
   - **Product:** Select "Basecamp 4"
4. After creating, click on the app name to view your Client ID and Client Secret

### 2. Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Copy the generated key

## Usage

### Starting the Application

Run the application:
```bash
callnotes
```

This will:
- Start the local server on port 3000 (or next available port)
- Open your browser automatically to the app

### First Run Setup

On first run, you'll be guided through a 3-step setup:

1. **Step 1:** Enter your Basecamp Client ID and Client Secret
2. **Step 2:** Authorize the app with your Basecamp account
3. **Step 3:** Enter your Gemini API Key

### Generating Call Notes

1. **Previous Notes (Optional):** Paste notes from your last call to track task progress
2. **Activity Log:** Paste a Basecamp activity log containing thread URLs
3. **Joint Basecamp URL (Optional):** If the client has access to a shared Basecamp project, provide its URL for stricter content filtering
4. Click **Generate Call Notes**
5. Copy or download the generated markdown

### Example Activity Log Format

```
Activity for Client Name - Last 7 days

John D. completed Fix meta title duplicates
https://3.basecamp.com/1234567/buckets/12345678/todos/123456789

Jordan M. commented on Homepage redesign discussion
https://3.basecamp.com/1234567/buckets/12345678/messages/987654321
```

## Development

### Available Commands

```bash
# Run with hot reload (development)
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test

# Build TypeScript to dist/
npm run build
```

### Environment Variables

The `.env` file is created automatically during setup. Manual configuration:

```env
# Required - Basecamp OAuth
BASECAMP_CLIENT_ID=your_client_id
BASECAMP_CLIENT_SECRET=your_client_secret

# Auto-populated after OAuth flow
BASECAMP_ACCESS_TOKEN=...
BASECAMP_REFRESH_TOKEN=...
BASECAMP_TOKEN_EXPIRES_AT=...

# Required - Gemini AI
GEMINI_API_KEY=your_gemini_key

# Optional - Model configuration
GEMINI_SUMMARIZE_MODEL=gemini-2.5-flash
GEMINI_COMPILE_MODEL=gemini-2.5-pro

# Optional - Agency name used in AI prompts
AGENCY_NAME=

# Optional - Server port
PORT=3000
```

## Troubleshooting

### Port Already in Use

The app automatically tries the next available port if 3000 is in use.

### OAuth Errors

- Ensure your Redirect URI exactly matches `http://localhost:3000/auth/callback`
- Check that you selected "Basecamp 4" as the product

### Token Expired

Tokens refresh automatically. If you encounter persistent auth errors, delete the token entries from `.env` and re-authorize through the setup wizard.

### Rate Limiting

The app caps Basecamp requests at 10 concurrent (Basecamp allows 50 requests per 10 seconds) and backs off automatically on HTTP 429. Large activity logs take longer to process.

## Security Notes

- All credentials are stored locally in `.env`, written with owner-only (0600) permissions
- The server binds to `127.0.0.1` only and is not designed for network deployment
- The Basecamp OAuth flow uses a one-time `state` value to reject forged callbacks
- Error messages shown in the browser are sanitized; full details stay in the server log
- Never commit `.env` to version control
