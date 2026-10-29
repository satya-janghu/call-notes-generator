/**
 * Call Notes Generator - Frontend JavaScript
 */

// State
let generatedContent = '';
let isGenerating = false;
let abortController = null;

// Constants
const SSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max for generation

// DOM Elements
const activityLogInput = document.getElementById('activity-log');
const urlPreview = document.getElementById('url-preview');

// URL Extraction Regex (same as backend)
const BASECAMP_URL_REGEX = /https:\/\/3\.basecamp\.com\/(\d+)\/buckets\/(\d+)\/(todos|messages)\/(\d+)/g;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Note: Theme is initialized in <head> to prevent FOUC
  checkCredentials();
  setupEventListeners();

  // Check for setup complete message
  const params = new URLSearchParams(window.location.search);
  if (params.get('setup') === 'complete') {
    // Clear the URL param
    window.history.replaceState({}, '', '/');
  }
});

// Theme functions
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const html = document.documentElement;
  const newTheme = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}

// Check if credentials are configured
async function checkCredentials() {
  try {
    const response = await fetch('/auth/status');
    const status = await response.json();

    if (!status.isComplete) {
      window.location.href = '/setup.html';
    }
  } catch (error) {
    console.error('Failed to check credentials:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Real-time URL preview
  if (activityLogInput) {
    activityLogInput.addEventListener('input', updateUrlPreview);
  }

  // Strip base64 images when user leaves the previous notes field
  const previousNotesInput = document.getElementById('previous-notes');
  if (previousNotesInput) {
    previousNotesInput.addEventListener('blur', () => {
      const original = previousNotesInput.value;
      if (!original) return;

      const stripped = stripBase64Images(original);
      if (stripped !== original) {
        previousNotesInput.value = stripped;

        // Count how many images were removed
        const imageMatches = original.match(/!\[[^\]]*\]\(data:image|^\[[^\]]+\]:\s*<?data:image/gm) || [];
        const count = imageMatches.length;
        showToast(`${count} image${count !== 1 ? 's' : ''} removed`);
      }
    });
  }
}

// Strip base64 images from markdown
// Handles multiple formats: inline, reference with/without angle brackets
// Note: Keep in sync with src/utils/parser.ts stripBase64Images()
function stripBase64Images(markdown) {
  if (!markdown) return markdown;
  let result = markdown;
  // Inline images: ![alt](data:image/...)
  result = result.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '[image removed]');
  // Reference definitions with angle brackets: [id]: <data:image/...>
  result = result.replace(/^\[[^\]]+\]:\s*<data:image\/[^>]+>/gm, '[image removed]');
  // Reference definitions without angle brackets: [id]: data:image/...
  result = result.replace(/^\[[^\]]+\]:\s*data:image\/\S+/gm, '[image removed]');
  // Catch-all for any remaining base64 data URIs
  result = result.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, '[base64 data removed]');
  return result;
}

// Extract URLs from activity log
function extractUrls(text) {
  const urlMap = new Map();
  const exclusions = [/#__recording_/, /\/todolists\//, /\/projects\//];

  BASECAMP_URL_REGEX.lastIndex = 0;
  let match;
  let allCount = 0;

  while ((match = BASECAMP_URL_REGEX.exec(text)) !== null) {
    const fullUrl = match[0];
    const shouldExclude = exclusions.some(pattern => pattern.test(fullUrl));

    if (!shouldExclude) {
      allCount++;
      if (!urlMap.has(fullUrl)) {
        urlMap.set(fullUrl, {
          type: match[3],
          url: fullUrl,
        });
      }
    }
  }

  const urls = Array.from(urlMap.values());
  return {
    total: urls.length,
    todos: urls.filter(u => u.type === 'todos').length,
    messages: urls.filter(u => u.type === 'messages').length,
    duplicatesRemoved: allCount - urls.length,
  };
}

// Update URL preview
function updateUrlPreview() {
  const text = activityLogInput.value;

  if (!text.trim()) {
    urlPreview.className = 'url-preview empty';
    urlPreview.textContent = 'Paste activity log to see extracted URLs';
    return;
  }

  const result = extractUrls(text);

  if (result.total === 0) {
    urlPreview.className = 'url-preview empty';
    urlPreview.textContent = 'No Basecamp URLs found';
  } else {
    urlPreview.className = 'url-preview found';
    let text = `Found ${result.total} thread${result.total !== 1 ? 's' : ''} (${result.todos} todo${result.todos !== 1 ? 's' : ''}, ${result.messages} message${result.messages !== 1 ? 's' : ''})`;
    if (result.duplicatesRemoved > 0) {
      text += ` - ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved !== 1 ? 's' : ''} removed`;
    }
    urlPreview.textContent = text;
  }
}

// Navigation
function showInputSections() {
  document.getElementById('section-previous').classList.remove('hidden');
  document.getElementById('section-activity').classList.remove('hidden');
  document.getElementById('section-output').classList.add('hidden');
}

function showOutputSection() {
  document.getElementById('section-previous').classList.add('hidden');
  document.getElementById('section-activity').classList.add('hidden');
  document.getElementById('section-output').classList.remove('hidden');
}

function startOver() {
  // Reset state
  generatedContent = '';
  isGenerating = false;

  // Clear inputs
  document.getElementById('previous-notes').value = '';
  document.getElementById('activity-log').value = '';
  document.getElementById('joint-url').value = '';

  // Reset output
  document.getElementById('output-content').textContent = '';
  document.getElementById('success-banner').classList.add('hidden');
  document.getElementById('error-banner').classList.add('hidden');
  document.getElementById('progress-container').classList.remove('hidden');
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-text').textContent = 'Starting...';
  document.getElementById('copy-btn').disabled = true;
  document.getElementById('download-btn').disabled = true;
  document.getElementById('generate-btn').disabled = false;
  document.getElementById('output-subtitle').textContent = 'Generating...';

  // Show input sections
  showInputSections();
  updateUrlPreview();
}

// Show toast notification
function showToast(message) {
  const toast = document.getElementById('image-stripped-toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }
}

// Show inline validation error (replaces alert)
function showValidationError(message) {
  const errorBanner = document.getElementById('validation-error');
  if (errorBanner) {
    errorBanner.textContent = message;
    errorBanner.classList.remove('hidden');
    setTimeout(() => errorBanner.classList.add('hidden'), 5000);
  }
}

// Cancel generation
function cancelGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isGenerating = false;
  document.getElementById('generate-btn').disabled = false;
  document.getElementById('cancel-btn')?.classList.add('hidden');
  showError('Generation cancelled.');
}

// Generation
async function startGeneration() {
  const activityLog = document.getElementById('activity-log').value.trim();

  if (!activityLog) {
    showValidationError('Please paste a Basecamp activity log.');
    return;
  }

  // Check for URLs
  const result = extractUrls(activityLog);
  if (result.total === 0) {
    showValidationError('No Basecamp thread URLs found in the activity log.');
    return;
  }

  // Disable button and show output section
  document.getElementById('generate-btn').disabled = true;
  isGenerating = true;
  abortController = new AbortController();
  showOutputSection();

  // Show cancel button
  document.getElementById('cancel-btn')?.classList.remove('hidden');

  // Prepare data
  const previousNotes = stripBase64Images(document.getElementById('previous-notes').value || '');
  const jointBasecampUrl = document.getElementById('joint-url').value.trim();

  // Reset output
  generatedContent = '';
  document.getElementById('output-content').textContent = '';
  document.getElementById('success-banner').classList.add('hidden');
  document.getElementById('error-banner').classList.add('hidden');
  document.getElementById('progress-container').classList.remove('hidden');
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-text').textContent = 'Starting...';

  // Set up timeout
  const timeoutId = setTimeout(() => {
    if (isGenerating) {
      abortController?.abort();
      showError('Generation timed out. Please try again with fewer threads.');
    }
  }, SSE_TIMEOUT_MS);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previousNotes, activityLog, jointBasecampUrl }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate notes');
    }

    // Handle SSE response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          // Event type line - continue to data line
          continue;
        }

        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleSSEEvent(data);
          } catch (e) {
            // Handle raw content chunks
            if (line.slice(6).trim()) {
              handleContentChunk(line.slice(6));
            }
          }
        }
      }
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      // Handled by cancelGeneration or timeout
      return;
    }
    console.error('Generation error:', error);
    showError(error.message);
  } finally {
    clearTimeout(timeoutId);
    isGenerating = false;
    abortController = null;
    document.getElementById('generate-btn').disabled = false;
    document.getElementById('cancel-btn')?.classList.add('hidden');
  }
}

function handleSSEEvent(data) {
  // Handle different event types based on data structure
  if (data.phase) {
    updatePhase(data.phase, data.description);
  } else if (data.current !== undefined && data.total !== undefined) {
    updateProgress(data.current, data.total, data.thread, data.phase);
  } else if (data.threads !== undefined && data.duration !== undefined) {
    showComplete(data.threads, data.errors, data.duration);
  } else if (data.message) {
    showError(data.message);
  } else if (typeof data === 'string') {
    handleContentChunk(data);
  }
}

function updatePhase(phase, description) {
  const progressText = document.getElementById('progress-text');
  progressText.textContent = description;

  // Update progress bar based on phase (percentages reflect actual work distribution)
  const phases = { parsing: 5, fetching: 20, summarizing: 60, compiling: 90 };
  const percent = phases[phase] || 0;
  document.getElementById('progress-fill').style.width = `${percent}%`;
}

function updateProgress(current, total, thread, phase) {
  const progressText = document.getElementById('progress-text');

  // Progress ranges that match actual work distribution
  let basePercent = 5;
  let rangePercent = 15;

  if (phase === 'fetching') {
    basePercent = 20;
    rangePercent = 15; // 20-35%
  } else if (phase === 'summarizing') {
    basePercent = 35;
    rangePercent = 55; // 35-90% (AI summarization is the longest phase)
  }

  const percent = basePercent + (current / total) * rangePercent;
  document.getElementById('progress-fill').style.width = `${percent}%`;

  const action = phase === 'fetching' ? 'Fetching' : 'Summarizing';
  progressText.textContent = `${action} thread ${current} of ${total}...`;
}

function handleContentChunk(chunk) {
  generatedContent += chunk;
  document.getElementById('output-content').textContent = generatedContent;

  // Auto-scroll to bottom
  const container = document.querySelector('.output-container');
  container.scrollTop = container.scrollHeight;
}

function showComplete(threads, errors, duration) {
  document.getElementById('progress-container').classList.add('hidden');
  document.getElementById('success-banner').classList.remove('hidden');

  // Format per PRD: "X threads • Y errors • Zs"
  let stats = `${threads} thread${threads !== 1 ? 's' : ''} • `;
  if (errors > 0) {
    stats += `${errors} error${errors !== 1 ? 's' : ''} • `;
  }
  stats += `${duration}s`;

  document.getElementById('success-stats').textContent = stats;
  document.getElementById('output-subtitle').textContent = stats;

  // Enable action buttons
  document.getElementById('copy-btn').disabled = false;
  document.getElementById('download-btn').disabled = false;

  document.getElementById('progress-fill').style.width = '100%';
}

function showError(message) {
  document.getElementById('progress-container').classList.add('hidden');
  document.getElementById('error-banner').classList.remove('hidden');
  document.getElementById('error-text').textContent = message;
  document.getElementById('output-subtitle').textContent = 'Error';
}

// Actions
async function copyToClipboard() {
  const btn = document.getElementById('copy-btn');
  const originalText = btn.textContent;

  try {
    await navigator.clipboard.writeText(generatedContent);
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = originalText, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    // Fallback: show error message on button briefly
    btn.textContent = '✗ Copy failed';
    btn.classList.add('error');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('error');
    }, 2000);
  }
}

function downloadMarkdown() {
  const blob = new Blob([generatedContent], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `call-notes-${date}.md`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
