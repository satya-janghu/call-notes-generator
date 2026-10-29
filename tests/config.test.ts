import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CONFIG, REQUIRED_ENV_VARS, validateEnv } from '../src/config.js';

describe('CONFIG', () => {
  describe('basecamp', () => {
    it('has correct API base URL', () => {
      expect(CONFIG.basecamp.apiBase).toBe('https://3.basecampapi.com');
    });

    it('has correct auth URL', () => {
      expect(CONFIG.basecamp.authUrl).toBe('https://launchpad.37signals.com/authorization/new');
    });

    it('has correct token URL', () => {
      expect(CONFIG.basecamp.tokenUrl).toBe('https://launchpad.37signals.com/authorization/token');
    });

    it('has max concurrent requests set to 10', () => {
      expect(CONFIG.basecamp.maxConcurrent).toBe(10);
    });

    it('has retries set to 2', () => {
      expect(CONFIG.basecamp.retries).toBe(2);
    });

    it('has token refresh buffer of 5 minutes', () => {
      expect(CONFIG.basecamp.tokenRefreshBuffer).toBe(5 * 60 * 1000);
    });
  });

  describe('gemini', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('defaults summarizeModel to gemini-2.5-flash', () => {
      delete process.env.GEMINI_SUMMARIZE_MODEL;
      expect(CONFIG.gemini.summarizeModel).toBe('gemini-2.5-flash');
    });

    it('defaults compileModel to gemini-2.5-pro', () => {
      delete process.env.GEMINI_COMPILE_MODEL;
      expect(CONFIG.gemini.compileModel).toBe('gemini-2.5-pro');
    });

    it('uses environment variable for summarizeModel when set', () => {
      process.env.GEMINI_SUMMARIZE_MODEL = 'custom-model';
      expect(CONFIG.gemini.summarizeModel).toBe('custom-model');
    });

    it('uses environment variable for compileModel when set', () => {
      process.env.GEMINI_COMPILE_MODEL = 'custom-compile-model';
      expect(CONFIG.gemini.compileModel).toBe('custom-compile-model');
    });

    it('has summarizeConcurrency set to 2', () => {
      expect(CONFIG.gemini.summarizeConcurrency).toBe(2);
    });

    it('has correct temperature settings', () => {
      expect(CONFIG.gemini.summarizeTemp).toBe(0.3);
      expect(CONFIG.gemini.compileTemp).toBe(0.2);
    });

    it('has correct input size limits', () => {
      expect(CONFIG.gemini.inputLimits.userContent).toBe(120000);
      expect(CONFIG.gemini.inputLimits.threadContent).toBe(20000);
    });
  });

  describe('server', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('defaults port to 3000', () => {
      delete process.env.PORT;
      expect(CONFIG.server.port).toBe(3000);
    });

    it('uses environment variable for port when set', () => {
      process.env.PORT = '8080';
      expect(CONFIG.server.port).toBe(8080);
    });

    it('has maxPortRetries set to 5', () => {
      expect(CONFIG.server.maxPortRetries).toBe(5);
    });

    it('has bodySizeLimit set to 5mb', () => {
      expect(CONFIG.server.bodySizeLimit).toBe('5mb');
    });
  });

  describe('sse', () => {
    it('has correct phase progress percentages', () => {
      expect(CONFIG.sse.phaseProgress.parsing).toBe(5);
      expect(CONFIG.sse.phaseProgress.fetching).toBe(25);
      expect(CONFIG.sse.phaseProgress.summarizing).toBe(70);
      expect(CONFIG.sse.phaseProgress.compiling).toBe(95);
    });
  });
});

describe('REQUIRED_ENV_VARS', () => {
  it('has correct Basecamp env vars', () => {
    expect(REQUIRED_ENV_VARS.basecamp).toContain('BASECAMP_CLIENT_ID');
    expect(REQUIRED_ENV_VARS.basecamp).toContain('BASECAMP_CLIENT_SECRET');
  });

  it('has correct Gemini env vars', () => {
    expect(REQUIRED_ENV_VARS.gemini).toContain('GEMINI_API_KEY');
  });

  it('has correct token env vars', () => {
    expect(REQUIRED_ENV_VARS.tokens).toContain('BASECAMP_ACCESS_TOKEN');
    expect(REQUIRED_ENV_VARS.tokens).toContain('BASECAMP_REFRESH_TOKEN');
    expect(REQUIRED_ENV_VARS.tokens).toContain('BASECAMP_TOKEN_EXPIRES_AT');
  });
});

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns valid true when missing array is empty', () => {
    process.env.BASECAMP_CLIENT_ID = 'test-id';
    process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';

    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('returns warnings for missing Basecamp credentials', () => {
    delete process.env.BASECAMP_CLIENT_ID;
    delete process.env.BASECAMP_CLIENT_SECRET;
    process.env.GEMINI_API_KEY = 'test-key';

    const result = validateEnv();
    expect(result.warnings).toContain('BASECAMP_CLIENT_ID not set - Basecamp integration will not work');
    expect(result.warnings).toContain('BASECAMP_CLIENT_SECRET not set - Basecamp integration will not work');
  });

  it('returns warnings for missing Gemini key', () => {
    process.env.BASECAMP_CLIENT_ID = 'test-id';
    process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
    delete process.env.GEMINI_API_KEY;

    const result = validateEnv();
    expect(result.warnings).toContain('GEMINI_API_KEY not set - AI summarization will not work');
  });

  it('returns all warnings when nothing is set', () => {
    delete process.env.BASECAMP_CLIENT_ID;
    delete process.env.BASECAMP_CLIENT_SECRET;
    delete process.env.GEMINI_API_KEY;

    const result = validateEnv();
    expect(result.warnings).toHaveLength(3);
  });

  it('returns empty warnings when all env vars are set', () => {
    process.env.BASECAMP_CLIENT_ID = 'test-id';
    process.env.BASECAMP_CLIENT_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';

    const result = validateEnv();
    expect(result.warnings).toHaveLength(0);
  });
});
