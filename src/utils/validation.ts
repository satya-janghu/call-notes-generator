/**
 * Validation and error sanitization utilities
 */

/** Validate that a string contains only numeric digits (Basecamp IDs) */
export function isValidId(id: string): boolean {
  return /^\d+$/.test(id);
}

/** Validate API key format (alphanumeric with dashes/underscores, min 20 chars) */
export function isValidApiKey(key: string): boolean {
  return /^[a-zA-Z0-9_\-]{20,}$/.test(key);
}

/** Validate Basecamp URL format */
export function isValidBasecampUrl(url: string): boolean {
  return /^https:\/\/3\.basecamp\.com\/\d+\/buckets\/\d+\/(todos|messages)\/\d+/.test(url);
}

/**
 * Sanitize error messages to prevent leaking sensitive information.
 * Returns a user-friendly message without internal details.
 * Order matters - more specific patterns should be checked first.
 */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Authentication errors (check early - security critical)
  if (lowerMessage.includes('token') || lowerMessage.includes('401') ||
      (lowerMessage.includes('auth') && !lowerMessage.includes('authorization info'))) {
    return 'Authentication failed. Please re-authorize with Basecamp.';
  }

  // Rate limiting
  if (lowerMessage.includes('429') || lowerMessage.includes('rate limit')) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  // Configuration errors (check before generic API errors)
  if (lowerMessage.includes('not configured') || lowerMessage.includes('missing')) {
    return 'Configuration incomplete. Please complete setup.';
  }

  // Gemini-specific errors (check before generic API errors)
  if (lowerMessage.includes('gemini')) {
    return 'AI processing error. Please try again.';
  }

  // AI errors (check before generic API errors)
  if (lowerMessage.includes(' ai ') || lowerMessage.includes('ai model') || lowerMessage.includes('ai processing')) {
    return 'AI processing error. Please try again.';
  }

  // Basecamp-specific errors (check before generic API errors)
  if (lowerMessage.includes('basecamp')) {
    return 'Could not fetch data from Basecamp. The resource may have been moved or deleted.';
  }

  // 404 errors (resource not found)
  if (lowerMessage.includes('404') || lowerMessage.includes('not found')) {
    return 'Could not fetch data from Basecamp. The resource may have been moved or deleted.';
  }

  // Network errors
  if (lowerMessage.includes('fetch') || lowerMessage.includes('network') || lowerMessage.includes('econnrefused')) {
    return 'Network error. Please check your internet connection.';
  }

  // Generic API/server errors (check last among specific error types)
  if (lowerMessage.includes('500') || lowerMessage.includes('502') || lowerMessage.includes('503') || lowerMessage.includes('api error')) {
    return 'External service error. Please try again later.';
  }

  // Generic fallback - never expose the raw error message
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Get detailed error for logging (includes original message)
 * Use this for server-side logging only, never send to client
 */
export function getErrorDetails(error: unknown, context?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  let details = context ? `[${context}] ` : '';
  details += message;
  if (stack) {
    details += `\n${stack}`;
  }
  return details;
}
