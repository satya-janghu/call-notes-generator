/**
 * Gemini compilation service (Tier 2 - Pro model) with streaming
 */

import { GoogleGenAI } from '@google/genai';
import { COMPILE_SYSTEM_PROMPT, buildCompilePrompt } from '../../prompts/compile.js';
import { CONFIG } from '../../config.js';
import { stripMarkdownCodeBlock } from '../../utils/markdown.js';
import { withTimeout } from '../../utils/timeout.js';
import type { ThreadSummary } from '../../types.js';

/** Get the Gemini client */
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenAI({ apiKey });
}

/** Compile summaries into a final report (non-streaming) */
export async function compileReport(summaries: ThreadSummary[]): Promise<string> {
  if (summaries.length === 0) {
    return 'No threads to compile.';
  }

  const client = getClient();
  const userPrompt = buildCompilePrompt(summaries);

  const response = await withTimeout(
    client.models.generateContent({
      model: CONFIG.gemini.compileModel,
      contents: userPrompt,
      config: {
        systemInstruction: COMPILE_SYSTEM_PROMPT,
        temperature: CONFIG.gemini.compileTemp,
      },
    }),
    CONFIG.timeouts.geminiApi,
    `Gemini compilation timed out after ${CONFIG.timeouts.geminiApi / 1000}s`
  );

  const text = response.text;
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  return stripMarkdownCodeBlock(text);
}

/**
 * Compile summaries with streaming response.
 * Includes proper error handling for mid-stream failures and timeout protection.
 */
export async function compileReportStreaming(
  summaries: ThreadSummary[],
  onChunk: (chunk: string) => void,
  onError?: (error: Error) => void
): Promise<string> {
  if (summaries.length === 0) {
    const message = 'No threads to compile.';
    onChunk(message);
    return message;
  }

  const client = getClient();
  const userPrompt = buildCompilePrompt(summaries);

  // Start the streaming request with timeout
  const response = await withTimeout(
    client.models.generateContentStream({
      model: CONFIG.gemini.compileModel,
      contents: userPrompt,
      config: {
        systemInstruction: COMPILE_SYSTEM_PROMPT,
        temperature: CONFIG.gemini.compileTemp,
      },
    }),
    CONFIG.timeouts.geminiApi,
    `Gemini streaming request timed out after ${CONFIG.timeouts.geminiApi / 1000}s`
  );

  let fullText = '';
  let headerStripped = false;
  let chunksReceived = 0;

  // Process the stream with error handling and timeout
  const processStream = async (): Promise<void> => {
    try {
      for await (const chunk of response) {
        chunksReceived++;
        const text = chunk.text;
        if (text) {
          fullText += text;

          // Skip the opening ```markdown line if present
          if (!headerStripped) {
            // Check if we have enough content to determine if there's a code block header
            if (fullText.includes('\n') || !fullText.startsWith('```')) {
              headerStripped = true;
              // Strip the header from accumulated content
              let content = fullText;
              if (content.startsWith('```markdown\n')) {
                content = content.slice(12);
              } else if (content.startsWith('```\n')) {
                content = content.slice(4);
              }
              if (content) {
                onChunk(content);
              }
            }
            // If starts with ``` but no newline yet, wait for more content
          } else {
            // Already streaming, just send the chunk
            onChunk(text);
          }
        }
      }
    } catch (streamError) {
      // Handle mid-stream failures
      const error = streamError instanceof Error
        ? streamError
        : new Error('Unknown streaming error');

      console.error(`[compile] Stream failed after ${chunksReceived} chunks: ${error.message}`);

      // Notify caller of the error if callback provided
      if (onError) {
        onError(error);
      }

      // If we got partial content, log it but still throw
      if (fullText.length > 0) {
        console.warn(`[compile] Partial content received (${fullText.length} chars) before stream failure`);
      }

      throw new Error(`Streaming failed after ${chunksReceived} chunks: ${error.message}`);
    }
  };

  // Wrap entire stream processing with timeout
  await withTimeout(
    processStream(),
    CONFIG.timeouts.geminiStream,
    `Gemini stream timed out after ${CONFIG.timeouts.geminiStream / 1000}s (received ${chunksReceived} chunks)`
  );

  // Validate we got actual content
  if (fullText.length === 0) {
    throw new Error('Empty response from Gemini streaming - no content received');
  }

  // Clean up the full text for return value using shared utility
  return stripMarkdownCodeBlock(fullText);
}
