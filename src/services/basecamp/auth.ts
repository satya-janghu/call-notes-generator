/**
 * Basecamp OAuth authentication and token management
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { TokenResponse, AuthorizationInfo } from './types.js';

const BASECAMP_AUTH_URL = 'https://launchpad.37signals.com/authorization/new';
const BASECAMP_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const BASECAMP_AUTH_INFO_URL = 'https://launchpad.37signals.com/authorization.json';

/** Get the path to the .env file */
function getEnvPath(): string {
  return resolve(process.cwd(), '.env');
}

/** Read current .env file content */
function readEnvFile(): string {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) {
    return '';
  }
  return readFileSync(envPath, 'utf-8');
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Update a specific key in the .env file */
function updateEnvKey(key: string, value: string): void {
  const envPath = getEnvPath();
  let content = readEnvFile();

  // Escape regex special characters to prevent injection
  const escapedKey = escapeRegex(key);
  const regex = new RegExp(`^${escapedKey}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }

  // Write with restrictive permissions (owner read/write only)
  writeFileSync(envPath, content.trim() + '\n', { mode: 0o600 });
}

/** Get OAuth authorization URL */
export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  if (!clientId) {
    throw new Error('BASECAMP_CLIENT_ID not configured');
  }

  const params = new URLSearchParams({
    type: 'web_server',
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  if (state) {
    params.set('state', state);
  }

  return `${BASECAMP_AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  const clientSecret = process.env.BASECAMP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET must be configured');
  }

  const params = new URLSearchParams({
    type: 'web_server',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(BASECAMP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${response.status} ${text}`);
  }

  const data = await response.json() as TokenResponse;
  return data;
}

/** Save tokens to .env file */
export function saveTokens(tokens: TokenResponse): void {
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  updateEnvKey('BASECAMP_ACCESS_TOKEN', tokens.access_token);
  updateEnvKey('BASECAMP_REFRESH_TOKEN', tokens.refresh_token);
  updateEnvKey('BASECAMP_TOKEN_EXPIRES_AT', expiresAt.toString());

  // Update process.env for current session
  process.env.BASECAMP_ACCESS_TOKEN = tokens.access_token;
  process.env.BASECAMP_REFRESH_TOKEN = tokens.refresh_token;
  process.env.BASECAMP_TOKEN_EXPIRES_AT = expiresAt.toString();
}

/** Refresh the access token using refresh token */
export async function refreshAccessToken(): Promise<void> {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
  const refreshToken = process.env.BASECAMP_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error('BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET must be configured');
  }

  if (!refreshToken) {
    throw new Error('No refresh token available. Please re-authenticate.');
  }

  const params = new URLSearchParams({
    type: 'refresh',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(BASECAMP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} ${text}`);
  }

  const data = await response.json() as TokenResponse;
  saveTokens(data);
}

/** Check if access token is expired or about to expire (within 5 minutes) */
export function isTokenExpired(): boolean {
  const expiresAt = process.env.BASECAMP_TOKEN_EXPIRES_AT;
  if (!expiresAt) return true;

  const expiresAtMs = parseInt(expiresAt, 10);
  // Treat invalid/NaN values as expired for safety
  if (isNaN(expiresAtMs) || expiresAtMs <= 0) return true;

  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() >= expiresAtMs - fiveMinutes;
}

/** Ensure we have a valid access token, refreshing if needed */
export async function ensureValidToken(): Promise<string> {
  if (isTokenExpired()) {
    await refreshAccessToken();
  }

  const token = process.env.BASECAMP_ACCESS_TOKEN;
  if (!token) {
    throw new Error('No access token available');
  }

  return token;
}

/** Get authorization info (user identity and accounts) */
export async function getAuthorizationInfo(): Promise<AuthorizationInfo> {
  const token = await ensureValidToken();

  const response = await fetch(BASECAMP_AUTH_INFO_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'CallNotesGenerator (https://github.com/satya-janghu/call-notes-generator)',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get authorization info: ${response.status}`);
  }

  return response.json() as Promise<AuthorizationInfo>;
}

/** Check if Basecamp credentials are configured */
export function hasBasecampCredentials(): boolean {
  return !!(process.env.BASECAMP_CLIENT_ID && process.env.BASECAMP_CLIENT_SECRET);
}

/** Check if Basecamp tokens are available */
export function hasBasecampTokens(): boolean {
  return !!(process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_REFRESH_TOKEN);
}

/** Check if Gemini API key is configured */
export function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/** Save Gemini API key to .env */
export function saveGeminiKey(apiKey: string): void {
  updateEnvKey('GEMINI_API_KEY', apiKey);
  process.env.GEMINI_API_KEY = apiKey;
}

/** Save Basecamp credentials to .env */
export function saveBasecampCredentials(clientId: string, clientSecret: string): void {
  updateEnvKey('BASECAMP_CLIENT_ID', clientId);
  updateEnvKey('BASECAMP_CLIENT_SECRET', clientSecret);
  process.env.BASECAMP_CLIENT_ID = clientId;
  process.env.BASECAMP_CLIENT_SECRET = clientSecret;
}

/** Get full credential status */
export function getCredentialStatus() {
  const hasCredentials = hasBasecampCredentials();
  const hasTokens = hasBasecampTokens();
  const hasGemini = hasGeminiKey();

  return {
    hasBasecampCredentials: hasCredentials,
    hasBasecampTokens: hasTokens,
    hasGeminiKey: hasGemini,
    isComplete: hasCredentials && hasTokens && hasGemini,
  };
}
