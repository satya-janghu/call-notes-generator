/**
 * API routes for call notes generation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getUrlPreview } from '../utils/parser.js';
import { createSSEWriter } from '../utils/sse.js';
import { generateCallNotes } from '../services/generation.js';
import { getCredentialStatus } from '../services/basecamp/auth.js';
import { sanitizeError } from '../utils/validation.js';
import type { GenerateRequest } from '../types.js';

const router = Router();

/** Preview URL extraction from activity log */
router.post('/preview', (req, res) => {
  const { activityLog } = req.body;

  if (!activityLog || typeof activityLog !== 'string') {
    return res.status(400).json({ error: 'Activity log is required' });
  }

  const preview = getUrlPreview(activityLog);
  res.json(preview);
});

/** Generate call notes - SSE endpoint */
router.post('/generate', async (req: Request, res: Response) => {
  const status = getCredentialStatus();
  if (!status.isComplete) {
    return res.status(401).json({ error: 'Credentials not configured. Please complete setup.' });
  }

  const { previousNotes, activityLog, jointBasecampUrl } = req.body as GenerateRequest;

  if (!activityLog || typeof activityLog !== 'string' || !activityLog.trim()) {
    return res.status(400).json({ error: 'Activity log is required' });
  }

  // Set up SSE writer
  const sse = createSSEWriter(res);

  try {
    await generateCallNotes(
      {
        previousNotes: previousNotes || '',
        activityLog,
        jointBasecampUrl: jointBasecampUrl || '',
      },
      sse
    );
  } catch (error) {
    console.error('Generation error:', error);
    sse.sendError(sanitizeError(error));
  } finally {
    sse.close();
  }
});

export default router;
