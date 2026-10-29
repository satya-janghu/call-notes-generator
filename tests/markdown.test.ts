import { describe, it, expect } from 'vitest';
import {
  stripMarkdownCodeBlock,
  extractJsonFromResponse,
  parseJsonResponse,
} from '../src/utils/markdown.js';

describe('stripMarkdownCodeBlock', () => {
  it('strips ```markdown wrapper', () => {
    const input = '```markdown\n## Header\n\nContent here\n```';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('## Header\n\nContent here');
  });

  it('strips ```markdown wrapper without trailing newline', () => {
    const input = '```markdown\nContent```';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('Content');
  });

  it('strips ``` wrapper', () => {
    const input = '```\nSome code\n```';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('Some code');
  });

  it('strips ```json wrapper', () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('{"key": "value"}');
  });

  it('handles input without code block', () => {
    const input = 'Just plain text';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('Just plain text');
  });

  it('handles empty input', () => {
    expect(stripMarkdownCodeBlock('')).toBe('');
    expect(stripMarkdownCodeBlock('   ')).toBe('');
  });

  it('trims whitespace', () => {
    const input = '  \n```markdown\nContent\n```\n  ';
    const result = stripMarkdownCodeBlock(input);
    expect(result).toBe('Content');
  });

  it('handles incomplete code blocks', () => {
    // Only opening
    expect(stripMarkdownCodeBlock('```\nContent')).toBe('Content');
    // Only closing
    expect(stripMarkdownCodeBlock('Content\n```')).toBe('Content');
  });
});

describe('extractJsonFromResponse', () => {
  it('extracts JSON from markdown-wrapped response', () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = extractJsonFromResponse(input);
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON object when extra text is present', () => {
    const input = 'Here is the JSON:\n{"key": "value"}\nThat was the response.';
    const result = extractJsonFromResponse(input);
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON array', () => {
    const input = '```json\n[1, 2, 3]\n```';
    const result = extractJsonFromResponse(input);
    expect(result).toBe('[1, 2, 3]');
  });

  it('handles nested JSON', () => {
    const input = '{"outer": {"inner": "value"}}';
    const result = extractJsonFromResponse(input);
    expect(result).toBe('{"outer": {"inner": "value"}}');
  });

  it('handles plain JSON input', () => {
    const input = '{"key": "value"}';
    const result = extractJsonFromResponse(input);
    expect(result).toBe('{"key": "value"}');
  });
});

describe('parseJsonResponse', () => {
  it('parses valid JSON from markdown wrapper', () => {
    const input = '```json\n{"key": "value", "number": 42}\n```';
    const result = parseJsonResponse<{ key: string; number: number }>(input);
    expect(result).toEqual({ key: 'value', number: 42 });
  });

  it('parses JSON array', () => {
    const input = '[1, 2, 3]';
    const result = parseJsonResponse<number[]>(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses nested objects', () => {
    const input = '{"level1": {"level2": {"value": "deep"}}}';
    const result = parseJsonResponse<{ level1: { level2: { value: string } } }>(input);
    expect(result.level1.level2.value).toBe('deep');
  });

  it('handles JSON with trailing commas', () => {
    // This test verifies the trailing comma cleanup
    const input = '{"key": "value",}';
    const result = parseJsonResponse<{ key: string }>(input);
    expect(result.key).toBe('value');
  });

  it('throws on invalid JSON', () => {
    const input = 'not valid json at all';
    expect(() => parseJsonResponse(input)).toThrow('Failed to parse JSON response');
  });

  it('throws on empty input', () => {
    expect(() => parseJsonResponse('')).toThrow();
  });

  it('parses complex AI response structure', () => {
    const input = `\`\`\`json
{
  "url": "https://3.basecamp.com/123/buckets/456/todos/789",
  "title": "Task Name",
  "category": "SEO/DEV",
  "status": "Completed",
  "description": "Task description here.",
  "jointBasecampUrl": null,
  "copyItems": []
}
\`\`\``;
    const result = parseJsonResponse<{
      url: string;
      title: string;
      category: string;
      status: string;
      description: string;
      jointBasecampUrl: string | null;
      copyItems: unknown[];
    }>(input);

    expect(result.url).toBe('https://3.basecamp.com/123/buckets/456/todos/789');
    expect(result.title).toBe('Task Name');
    expect(result.category).toBe('SEO/DEV');
    expect(result.status).toBe('Completed');
    expect(result.copyItems).toEqual([]);
    expect(result.jointBasecampUrl).toBeNull();
  });
});
