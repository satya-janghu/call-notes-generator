/**
 * Centralized configuration for Call Notes Generator
 */

export const CONFIG = {
  /** Basecamp API configuration */
  basecamp: {
    apiBase: 'https://3.basecampapi.com',
    authUrl: 'https://launchpad.37signals.com/authorization/new',
    tokenUrl: 'https://launchpad.37signals.com/authorization/token',
    authInfoUrl: 'https://launchpad.37signals.com/authorization.json',
    userAgent: 'CallNotesGenerator (https://github.com/satya-janghu/call-notes-generator)',
    /** Max concurrent API requests */
    maxConcurrent: 10,
    /** Number of retries for failed requests */
    retries: 2,
    /** Buffer before token expiration to trigger refresh (5 minutes) */
    tokenRefreshBuffer: 5 * 60 * 1000,
  },

  /** Gemini AI configuration */
  gemini: {
    /** Model for per-thread summarization (fast, cheap) */
    get summarizeModel() {
      return process.env.GEMINI_SUMMARIZE_MODEL || 'gemini-2.5-flash';
    },
    /** Model for final report compilation (higher quality) */
    get compileModel() {
      return process.env.GEMINI_COMPILE_MODEL || 'gemini-2.5-pro';
    },
    /** Max concurrent summarization requests (Gemini limit: 2 req/sec) */
    summarizeConcurrency: 2,
    /** Temperature for summarization (slightly creative) */
    summarizeTemp: 0.3,
    /** Temperature for compilation (consistent formatting) */
    compileTemp: 0.2,
    /** Input size limits (characters, ~4 chars per token) */
    inputLimits: {
      /** Max chars for user-provided content (~30K tokens) */
      userContent: 120000,
      /** Max chars for individual thread content (~5K tokens) */
      threadContent: 20000,
    },
    /** Number of retries for AI requests */
    retries: 4,
  },

  /** Agency branding used in AI prompts */
  agency: {
    /** Agency name the summaries are written on behalf of (optional) */
    get name() {
      return process.env.AGENCY_NAME || '';
    },
  },

  /** Server configuration */
  server: {
    /** Default port */
    get port() {
      return parseInt(process.env.PORT || '3000', 10);
    },
    /** Max port retry attempts */
    maxPortRetries: 5,
    /** Request body size limit */
    bodySizeLimit: '5mb',
  },

  /** SSE streaming configuration */
  sse: {
    /** Phase progress percentages for UI */
    phaseProgress: {
      parsing: 5,
      fetching: 25,
      summarizing: 70,
      compiling: 95,
    } as const,
  },

  /** Timeout configuration (in milliseconds) */
  timeouts: {
    /** Timeout for Basecamp API requests (30 seconds) */
    basecampApi: 30000,
    /** Timeout for Gemini API single requests (2 minutes - AI can be slow) */
    geminiApi: 120000,
    /** Timeout for Gemini streaming responses (3 minutes for full stream) */
    geminiStream: 180000,
  },
} as const;

/** Required environment variables for full functionality */
export const REQUIRED_ENV_VARS = {
  /** Required for Basecamp OAuth */
  basecamp: ['BASECAMP_CLIENT_ID', 'BASECAMP_CLIENT_SECRET'] as const,
  /** Required for AI summarization */
  gemini: ['GEMINI_API_KEY'] as const,
  /** Auto-populated after OAuth flow */
  tokens: ['BASECAMP_ACCESS_TOKEN', 'BASECAMP_REFRESH_TOKEN', 'BASECAMP_TOKEN_EXPIRES_AT'] as const,
};

/** Validate that required environment variables are set */
export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check Basecamp credentials
  for (const key of REQUIRED_ENV_VARS.basecamp) {
    if (!process.env[key]) {
      warnings.push(`${key} not set - Basecamp integration will not work`);
    }
  }

  // Check Gemini key
  for (const key of REQUIRED_ENV_VARS.gemini) {
    if (!process.env[key]) {
      warnings.push(`${key} not set - AI summarization will not work`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
