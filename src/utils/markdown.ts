/**
 * Markdown processing utilities
 */

/**
 * Strip markdown code block wrappers from AI responses.
 * Handles various formats:
 * - ```markdown\n...\n```
 * - ```\n...\n```
 * - ```...```
 */
export function stripMarkdownCodeBlock(text: string): string {
  let result = text.trim();

  // Strip opening code block markers
  if (result.startsWith('```markdown\n')) {
    result = result.slice(12);
  } else if (result.startsWith('```markdown')) {
    result = result.slice(11);
  } else if (result.startsWith('```json\n')) {
    result = result.slice(8);
  } else if (result.startsWith('```json')) {
    result = result.slice(7);
  } else if (result.startsWith('```\n')) {
    result = result.slice(4);
  } else if (result.startsWith('```')) {
    result = result.slice(3);
  }

  // Strip closing code block markers
  if (result.endsWith('\n```')) {
    result = result.slice(0, -4);
  } else if (result.endsWith('```')) {
    result = result.slice(0, -3);
  }

  return result.trim();
}

/**
 * Extract JSON from a potentially markdown-wrapped response.
 * Returns the cleaned JSON string ready for parsing.
 */
export function extractJsonFromResponse(text: string): string {
  let cleaned = stripMarkdownCodeBlock(text);

  // Try to find JSON object/array boundaries if there's extra content
  const jsonStart = cleaned.search(/[{[]/);
  const jsonEndBrace = cleaned.lastIndexOf('}');
  const jsonEndBracket = cleaned.lastIndexOf(']');
  const jsonEnd = Math.max(jsonEndBrace, jsonEndBracket);

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  return cleaned;
}

/**
 * Sanitize common JSON malformations from AI responses.
 * Handles:
 * - Single quotes instead of double quotes (JavaScript style)
 * - Trailing commas
 * - Unquoted property names (basic cases)
 */
function sanitizeJsonString(text: string): string {
  let result = text;

  // Replace single quotes with double quotes (for string values)
  // This is a simplified approach - handles common cases but not all edge cases
  // Pattern: Look for single-quoted strings that aren't inside double-quoted strings
  result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content) => {
    // Escape any unescaped double quotes inside the content
    const escaped = content.replace(/(?<!\\)"/g, '\\"');
    return `"${escaped}"`;
  });

  // Fix unquoted property names (basic cases only)
  // Pattern: { key: "value" } → { "key": "value" }
  result = result.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

  // Remove trailing commas before closing brackets
  result = result.replace(/,(\s*[}\]])/g, '$1');

  // Fix common escape issues - newlines in strings
  result = result.replace(/\n/g, '\\n');

  return result;
}

/**
 * Parse JSON from an AI response, handling common formatting issues.
 * Attempts multiple cleanup strategies before failing.
 * Throws if parsing fails after all cleanup attempts.
 */
export function parseJsonResponse<T>(text: string): T {
  const cleaned = extractJsonFromResponse(text);

  // Attempt 1: Direct parse (best case - valid JSON)
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue to cleanup attempts
  }

  // Attempt 2: Remove trailing commas only
  try {
    const withoutTrailingCommas = cleaned.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(withoutTrailingCommas) as T;
  } catch {
    // Continue to more aggressive cleanup
  }

  // Attempt 3: Full sanitization (single quotes, unquoted keys, etc.)
  try {
    const sanitized = sanitizeJsonString(cleaned);
    return JSON.parse(sanitized) as T;
  } catch (finalError) {
    // Log the original text for debugging (truncated)
    const preview = cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned;
    console.error(`[parseJsonResponse] Failed to parse JSON. Preview: ${preview}`);
    throw new Error(
      `Failed to parse JSON response: ${finalError instanceof Error ? finalError.message : 'Unknown error'}`
    );
  }
}
