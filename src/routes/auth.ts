/**
 * Authentication routes for Basecamp OAuth and credential management
 */

import { randomBytes } from 'crypto';
import { Router } from 'express';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  saveTokens,
  getCredentialStatus,
  saveBasecampCredentials,
  saveGeminiKey,
  hasBasecampCredentials,
} from '../services/basecamp/auth.js';

const router = Router();

/** One-time OAuth state value, checked on callback to block forged redirects */
let pendingOAuthState: string | null = null;

/** Get current credential status */
router.get('/status', (req, res) => {
  const status = getCredentialStatus();
  res.json(status);
});

/** Save Basecamp credentials (client ID and secret) */
router.post('/basecamp-credentials', (req, res) => {
  const { clientId, clientSecret } = req.body;

  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Client ID and Client Secret are required' });
  }

  try {
    saveBasecampCredentials(clientId.trim(), clientSecret.trim());
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save Basecamp credentials:', error);
    res.status(500).json({ error: 'Failed to save credentials' });
  }
});

/** Start OAuth flow - redirect to Basecamp authorization */
router.get('/setup', (req, res) => {
  if (!hasBasecampCredentials()) {
    return res.redirect('/setup.html?error=missing_credentials');
  }

  try {
    const port = req.socket.localPort || 3000;
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const state = randomBytes(16).toString('hex');
    pendingOAuthState = state;
    const authUrl = getAuthorizationUrl(redirectUri, state);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Failed to start OAuth flow:', error);
    res.redirect('/setup.html?error=oauth_start_failed');
  }
});

/** OAuth callback - exchange code for tokens */
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/setup.html?error=oauth_denied');
  }

  if (!code || typeof code !== 'string') {
    return res.redirect('/setup.html?error=no_code');
  }

  if (!pendingOAuthState || typeof state !== 'string' || state !== pendingOAuthState) {
    return res.redirect('/setup.html?error=invalid_state');
  }
  pendingOAuthState = null;

  try {
    const port = req.socket.localPort || 3000;
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    saveTokens(tokens);

    // Check if we still need Gemini key
    const status = getCredentialStatus();
    if (status.isComplete) {
      res.redirect('/?setup=complete');
    } else {
      res.redirect('/setup.html?step=gemini');
    }
  } catch (error) {
    console.error('Failed to exchange code for tokens:', error);
    res.redirect('/setup.html?error=token_exchange_failed');
  }
});

/** Save Gemini API key */
router.post('/gemini-key', (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  try {
    saveGeminiKey(apiKey.trim());
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save Gemini API key:', error);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

/** Disconnect Basecamp (clear tokens but keep credentials) */
router.post('/disconnect', (req, res) => {
  try {
    // Clear tokens from process.env (don't delete from .env file)
    delete process.env.BASECAMP_ACCESS_TOKEN;
    delete process.env.BASECAMP_REFRESH_TOKEN;
    delete process.env.BASECAMP_TOKEN_EXPIRES_AT;
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to disconnect:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;
