const EXAMPLE_PROMPTS = [
  'draw a happy robot',
  'draw a house and a tree',
  'draw a star inside a circle'
];

const HAPPY_ROBOT_PROMPT = 'draw a happy robot';
const HAPPY_ROBOT_CODE = `penup()
home()
pendown()
# Draw the robot head
color("gray")
pensize(3)
penup()
goto(-100, 120)
pendown()
beginfill()
repeat(2) {
  forward(200)
  right(90)
  forward(160)
  right(90)
}
endfill()
# Draw the left eye
color("white")
penup()
goto(-55, 55)
setheading(0)
pendown()
beginfill()
circle(18)
endfill()
color("black")
penup()
goto(-39, 61)
pendown()
dot(10)
# Draw the right eye
color("white")
penup()
goto(25, 55)
setheading(0)
pendown()
beginfill()
circle(18)
endfill()
color("black")
penup()
goto(41, 61)
pendown()
dot(10)
# Draw a nice smiling mouth as a curved arc, not a circle
color("green")
pensize(5)
penup()
goto(-60, 10)
pendown()
setheading(315)
repeat(18) {
  forward(7)
  left(5)
}
# Draw the antenna
color("black")
pensize(3)
penup()
goto(0, 120)
setheading(90)
pendown()
forward(45)
color("red")
dot(18)
# Draw the robot body
color("gray")
pensize(3)
penup()
goto(-80, -40)
setheading(0)
pendown()
beginfill()
repeat(2) {
  forward(160)
  right(90)
  forward(170)
  right(90)
}
endfill()
# Draw the control panel on the body
color("black")
pensize(2)
penup()
goto(-35, -90)
setheading(0)
pendown()
repeat(2) {
  forward(70)
  right(90)
  forward(50)
  right(90)
}
color("red")
penup()
goto(-20, -105)
pendown()
dot(12)
color("blue")
penup()
goto(0, -105)
pendown()
dot(12)
color("green")
penup()
goto(20, -105)
pendown()
dot(12)
# Draw the left arm
color("black")
pensize(4)
penup()
goto(-80, -60)
setheading(180)
pendown()
forward(55)
right(45)
forward(40)
dot(16)
# Draw the right arm
color("black")
penup()
goto(80, -60)
setheading(0)
pendown()
forward(55)
left(45)
forward(40)
color("black")
dot(16)
# Draw the left leg
color("black")
pensize(5)
penup()
goto(-35, -210)
setheading(270)
pendown()
forward(70)
right(90)
forward(25)
# Draw the right leg
color("black")
penup()
goto(35, -210)
setheading(270)
pendown()
forward(70)
left(90)
forward(25)`;

const MIN_SPEED = 1;
const MAX_SPEED = 10;
const DEFAULT_SPEED = 4;
const MAX_TURN_DURATION_MS = 120;
const PROJECT_DRAFT_KEY = 'turtlelab.project';
const PROJECT_HISTORY_KEY = 'turtlelab.projects';
const MAX_SAVED_PROJECTS = 20;
const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  custom: ''
};
const PROVIDER_TOKEN_URLS = {
  openai: 'https://platform.openai.com/settings/organization/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  custom: ''
};

const introPage = document.querySelector('#intro-page');
const introStartButton = document.querySelector('#intro-start-button');
const studio = document.querySelector('#studio');
const promptModal = document.querySelector('#prompt-modal');
const tokenForm = document.querySelector('#token-form');
const tokenProvider = document.querySelector('#token-provider');
const tokenInput = document.querySelector('#token-input');
const tokenBaseUrl = document.querySelector('#token-base-url');
const getTokenLink = document.querySelector('#get-token-link');
const tokenStatus = document.querySelector('#token-status');
const skipSplashButton = document.querySelector('#skip-splash-button');
const aiConnectionBadge = document.querySelector('#ai-connection-badge');
const logoutButton = document.querySelector('#logout-button');
const openPromptButton = document.querySelector('#open-prompt-button');
const closePromptButton = document.querySelector('#close-prompt-button');
const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt-input');
const generateButton = document.querySelector('#generate-button');
const loadingText = document.querySelector('#loading-text');
const chipList = document.querySelector('#chip-list');

const canvas = document.querySelector('#turtle-canvas');
const replayButton = document.querySelector('#replay-button');
const clearButton = document.querySelector('#clear-button');
const animateToggle = document.querySelector('#animate-toggle');

const codeEditor = document.querySelector('#code-editor');
const codeHighlight = document.querySelector('#code-highlight');
const runButton = document.querySelector('#run-button');
const restoreButton = document.querySelector('#restore-button');
const copyButton = document.querySelector('#copy-button');
const saveProjectButton = document.querySelector('#save-project-button');
const codeError = document.querySelector('#code-error');

const transparencyNote = document.querySelector('#transparency-note');
const sessionNotice = document.querySelector('#session-notice');
const aiOverview = document.querySelector('#ai-overview');
const reviewHint = document.querySelector('#review-hint');
const warningsList = document.querySelector('#warnings-list');
const suggestionsList = document.querySelector('#suggestions-list');
const savedProjects = document.querySelector('#saved-projects');

const explainTabButton = document.querySelector('#explain-tab-button');
const savedTabButton = document.querySelector('#saved-tab-button');
const debugTabButton = document.querySelector('#debug-tab-button');
const explainTabContent = document.querySelector('#explain-tab-content');
const savedTabContent = document.querySelector('#saved-tab-content');
const debugTabContent = document.querySelector('#debug-tab-content');
const explainLoading = document.querySelector('#explain-loading');
const explainError = document.querySelector('#explain-error');
const explainErrorMessage = document.querySelector('#explain-error-message');
const explainRetryButton = document.querySelector('#explain-retry-button');
const explainResult = document.querySelector('#explain-result');
const explainTitleEl = document.querySelector('#explain-title');
const explainDescriptionEl = document.querySelector('#explain-description');
const suggestionsSection = document.querySelector('#suggestions-section');
const debugLog = document.querySelector('#debug-log');
const clearDebugButton = document.querySelector('#clear-debug-button');

const ctx = canvas.getContext('2d');
const spriteCanvas = document.querySelector('#turtle-sprite-canvas');
const spCtx = spriteCanvas.getContext('2d');
const CLIENT_SESSION_ID = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const state = {
  aiCode: '',
  currentCode: '',
  currentProgram: null,
  currentPlan: [],
  animationTimer: null,
  animationRaf: null,
  isGenerating: false,
  typingAnimation: null
};

function addDebugLogEntry(message, type = 'info', data = null) {
  if (debugLog.querySelector('.debug-empty')) {
    debugLog.innerHTML = '';
  }

  const entry = document.createElement('div');
  entry.className = `debug-log-entry ${type}`;

  const timestamp = document.createElement('span');
  timestamp.className = 'debug-timestamp';
  timestamp.textContent = new Date().toLocaleTimeString();
  entry.append(timestamp);

  const content = document.createElement('div');
  content.textContent = message;
  entry.append(content);

  if (data) {
    const dataDiv = document.createElement('pre');
    dataDiv.textContent = JSON.stringify(data, null, 2);
    dataDiv.style.margin = '0.25rem 0 0 0';
    dataDiv.style.fontSize = '0.8rem';
    dataDiv.style.overflow = 'auto';
    entry.append(dataDiv);
  }

  debugLog.append(entry);
  debugLog.scrollTop = debugLog.scrollHeight;
}

function clearDebugLog() {
  debugLog.innerHTML = '<p class="debug-empty">AI debug log will appear here as requests are made.</p>';
}

function showExplainLoading() {
  explainLoading.hidden = false;
  explainError.hidden = true;
  explainResult.hidden = true;
}

async function showExplainResult({ title, description, explanation, note, reviewHintText, warnings, suggestions }) {
  explainLoading.hidden = true;
  explainError.hidden = true;
  explainResult.hidden = false;
  transparencyNote.textContent = note || '';
  reviewHint.textContent = reviewHintText || 'Suggest → Review → Edit: let the AI guess, then fix the code.';
  setWarnings(warnings || []);
  setSuggestions(suggestions || []);

  // Animate text typing sequentially
  await animateTextTyping(explainTitleEl, title || '', 25);
  await animateTextTyping(explainDescriptionEl, description || '', 15);
  await animateTextTyping(aiOverview, explanation || '', 8);

    // Hide empty elements
    updateElementVisibility(transparencyNote);
    updateElementVisibility(explainTitleEl);
    updateElementVisibility(explainDescriptionEl);
    updateElementVisibility(aiOverview);
}

function showExplainError(message) {
  explainLoading.hidden = true;
  explainError.hidden = false;
  explainResult.hidden = true;
  explainErrorMessage.textContent = message;
}

function cancelTypingAnimation() {
  if (state.typingAnimation) {
    clearTimeout(state.typingAnimation);
    state.typingAnimation = null;
  }
}

function animateTextTyping(element, text, speed = 30) {
  return new Promise((resolve) => {
    element.textContent = '';
    let charIndex = 0;

    const type = () => {
      if (charIndex < text.length) {
        element.textContent += text[charIndex];
        charIndex += 1;
        state.typingAnimation = setTimeout(type, speed);
      } else {
        state.typingAnimation = null;
        resolve();
      }
    };

    type();
  });
}

  function updateElementVisibility(element) {
    const hasContent = element.textContent?.trim().length > 0;
    element.hidden = !hasContent;
  }

function switchToTab(tabName) {
  const allButtons = [explainTabButton, savedTabButton, debugTabButton];
  const allContents = [explainTabContent, savedTabContent, debugTabContent];

  for (const btn of allButtons) {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  }
  for (const content of allContents) {
    content.classList.remove('active');
  }

  const tabMap = {
    explain: { button: explainTabButton, content: explainTabContent },
    saved: { button: savedTabButton, content: savedTabContent },
    debug: { button: debugTabButton, content: debugTabContent }
  };

  const tab = tabMap[tabName];
  if (tab) {
    tab.button.classList.add('active');
    tab.button.setAttribute('aria-selected', 'true');
    tab.content.classList.add('active');
  }
}

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }
  return String(error.message || error).slice(0, 200);
}

function emitClientTelemetry(eventName, properties = {}, measurements = {}) {
  const payload = {
    eventName,
    properties: {
      ...properties,
      clientSessionId: CLIENT_SESSION_ID,
      page: 'turtlelab'
    },
    measurements
  };

  fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {
    // Telemetry should never break user flows.
  });
}

async function apiFetch(path, options = {}, telemetryMeta = {}) {
  const startedAt = performance.now();
  const correlationId = createCorrelationId();
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.headers || {}),
    'X-Correlation-Id': correlationId
  };

  // Log the request
  const requestInfo = {
    correlationId,
    path,
    method,
    headers: headers
  };
  
  if (options.body) {
    try {
      requestInfo.body = JSON.parse(options.body);
    } catch {
      requestInfo.body = options.body;
    }
  }

  addDebugLogEntry(`${method} ${path}`, 'request', requestInfo);

  try {
    const response = await fetch(path, {
      ...options,
      headers
    });

    const durationMs = performance.now() - startedAt;

    // Log the response
    const responseClone = response.clone();
    let responseBody = null;
    try {
      responseBody = await responseClone.json();
    } catch {
      responseBody = await responseClone.text();
    }

    const responseInfo = {
      status: response.status,
      statusText: response.statusText,
      correlationId,
      durationMs: durationMs.toFixed(2)
    };

    if (responseBody) {
      responseInfo.body = responseBody;
    }

    addDebugLogEntry(`Response: ${response.status} ${response.statusText}`, 
      response.ok ? 'response' : 'error', 
      responseInfo);

    emitClientTelemetry('client_api_call', {
      correlationId,
      path,
      method,
      ok: String(response.ok),
      statusCode: String(response.status),
      flow: telemetryMeta.flow || 'general'
    }, {
      durationMs: Number(durationMs.toFixed(2))
    });

    return response;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    addDebugLogEntry(`Error: ${normalizeErrorMessage(error)}`, 'error', {
      correlationId,
      message: error.message,
      durationMs: durationMs.toFixed(2)
    });

    emitClientTelemetry('client_api_exception', {
      correlationId,
      path,
      method,
      flow: telemetryMeta.flow || 'general',
      message: normalizeErrorMessage(error)
    }, {
      durationMs: Number(durationMs.toFixed(2))
    });
    throw error;
  }
}

function setGeneratingUi(isGenerating) {
  state.isGenerating = isGenerating;
  generateButton.disabled = isGenerating;
  generateButton.setAttribute('aria-disabled', String(isGenerating));
  generateButton.classList.toggle('is-busy', isGenerating);

  loadingText.classList.toggle('is-active', isGenerating);
  loadingText.textContent = isGenerating ? 'Generating turtle code...' : '';
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function syncHighlight() {
  const lines = codeEditor.value.split('\n');
  const html = lines.map((line) => {
    if (/^\s*#/.test(line)) {
      return `<span class="code-comment">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }).join('\n');
  codeHighlight.innerHTML = html;
}

codeEditor.addEventListener('input', syncHighlight);
codeEditor.addEventListener('scroll', () => {
  codeHighlight.scrollTop = codeEditor.scrollTop;
});

function getSavedHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setSavedHistory(projects) {
  localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(projects.slice(0, MAX_SAVED_PROJECTS)));
}

function saveDraftProject() {
  const project = {
    prompt: promptInput.value,
    code: codeEditor.value,
    aiCode: state.aiCode,
    explainTitle: explainTitleEl.textContent,
    explainDescription: explainDescriptionEl.textContent,
    aiOverview: aiOverview.textContent,
    transparencyNote: transparencyNote.textContent,
    reviewHint: reviewHint.textContent,
    warnings: Array.from(warningsList.children).map((item) => item.textContent),
    suggestions: Array.from(suggestionsList.children).map((item) => item.textContent)
  };

  localStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify(project));
}

function setWarnings(warnings) {
  warningsList.innerHTML = '';
  for (const warning of warnings || []) {
    const item = document.createElement('li');
    item.textContent = warning;
    warningsList.append(item);
  }

  updateElementVisibility(warningsList);
}

function setSuggestions(suggestions) {
  suggestionsList.innerHTML = '';
  suggestionsSection.hidden = !suggestions || suggestions.length === 0;
  for (const suggestion of suggestions || []) {
    const item = document.createElement('li');
    item.textContent = suggestion;
    suggestionsList.append(item);
  }
}

function applySavedProject(project) {
  cancelTypingAnimation();
  promptInput.value = project.prompt || '';
  codeEditor.value = project.code || '';
  state.aiCode = project.aiCode || project.code || '';
  explainTitleEl.textContent = project.explainTitle || '';
  explainDescriptionEl.textContent = project.explainDescription || '';
  aiOverview.textContent = project.aiOverview || '';
  transparencyNote.textContent = project.transparencyNote || '';
  reviewHint.textContent = project.reviewHint || 'Suggest → Review → Edit: let the AI guess, then fix the code.';
  setWarnings(project.warnings || []);
  setSuggestions(project.suggestions || []);
  explainLoading.hidden = true;
  explainError.hidden = true;
  explainResult.hidden = false;
  syncHighlight();

  // Hide empty elements
  updateElementVisibility(transparencyNote);
  updateElementVisibility(explainTitleEl);
  updateElementVisibility(explainDescriptionEl);
  updateElementVisibility(aiOverview);
}

function loadDraftProject() {
  const raw = localStorage.getItem(PROJECT_DRAFT_KEY);
  if (!raw) {
    return;
  }

  try {
    applySavedProject(JSON.parse(raw));
  } catch {
    localStorage.removeItem(PROJECT_DRAFT_KEY);
  }
}

function renderSavedProjects() {
  savedProjects.innerHTML = '';
  const projects = getSavedHistory();

  if (projects.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'panel-subtitle';
    empty.textContent = 'No saved drawings yet.';
    savedProjects.append(empty);
    return;
  }

  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-project-button';
    const title = project.name || project.prompt || 'Saved drawing';
    button.textContent = title.length > 40 ? `${title.slice(0, 37)}...` : title;
    button.addEventListener('click', async () => {
      applySavedProject(project);
      await runEditedCode();
    });
    savedProjects.append(button);
  }
}

function saveToHistory() {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const name = promptInput.value.trim() || `Drawing ${timestamp}`;
  const entryId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id: entryId,
    name,
    prompt: promptInput.value,
    code: codeEditor.value,
    aiCode: state.aiCode,
    explainTitle: explainTitleEl.textContent,
    explainDescription: explainDescriptionEl.textContent,
    aiOverview: aiOverview.textContent,
    transparencyNote: transparencyNote.textContent,
    reviewHint: reviewHint.textContent,
    warnings: Array.from(warningsList.children).map((item) => item.textContent),
    suggestions: Array.from(suggestionsList.children).map((item) => item.textContent)
  };

  const current = getSavedHistory().filter((project) => project.code !== entry.code && project.prompt !== entry.prompt);
  setSavedHistory([entry, ...current]);
  renderSavedProjects();
}

function openPromptModal() {
  if (typeof promptModal.showModal === 'function') {
    if (!promptModal.open) {
      promptModal.showModal();
    }
  } else {
    promptModal.setAttribute('open', 'open');
  }
  promptInput.focus();
}

function closePromptModal() {
  if (typeof promptModal.close === 'function') {
    if (promptModal.open) {
      promptModal.close();
    }
  } else {
    promptModal.removeAttribute('open');
  }
}

function enterIntroPage() {
  studio.hidden = true;
  introPage.hidden = false;
  window.scrollTo(0, 0);
}

function enterStudio({ openPrompt = false } = {}) {
  introPage.hidden = true;
  studio.hidden = false;
  window.scrollTo(0, 0);

  if (openPrompt) {
    window.requestAnimationFrame(() => {
      openPromptModal();
    });
  }
}

function setAiConnectionBadge(status) {
  if (status.hasToken) {
    aiConnectionBadge.textContent = `AI: ${status.provider}`;
    return;
  }
  aiConnectionBadge.textContent = status.serverFallbackAvailable ? 'AI: Server key' : 'AI: Optional';
}

function selectedProviderTokenUrl(provider) {
  return PROVIDER_TOKEN_URLS[provider] || '';
}

function setProviderHelpLink(provider) {
  const tokenUrl = selectedProviderTokenUrl(provider);
  if (tokenUrl) {
    getTokenLink.href = tokenUrl;
    getTokenLink.hidden = false;
  } else {
    getTokenLink.hidden = true;
  }
}

function setSessionNotice(message = '', link = '') {
  sessionNotice.innerHTML = '';
  if (!message) {
    updateElementVisibility(sessionNotice);
    return;
  }

  sessionNotice.append(document.createTextNode(message));
  if (link) {
    sessionNotice.append(document.createTextNode(' '));
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = 'Manage provider keys';
    sessionNotice.append(anchor);
  }

  updateElementVisibility(sessionNotice);
}

function setTokenStatusUi(status) {
  logoutButton.hidden = !Boolean(status.hasToken);
  logoutButton.disabled = !Boolean(status.hasToken);
  setAiConnectionBadge(status);
  setProviderHelpLink(status.provider || tokenProvider.value || 'openai');

  if (status.hasToken) {
    tokenStatus.textContent = `Using ${status.provider} API key in this session with the app default model.`;
  } else if (status.serverFallbackAvailable) {
    tokenStatus.textContent = 'No personal API key set. The app can still use a server default key.';
  } else {
    tokenStatus.textContent = 'No API key set. You can still use saved examples or edit code manually.';
  }
}

function syncProviderDefaults() {
  const provider = tokenProvider.value || 'openai';
  if (!tokenBaseUrl.value) {
    tokenBaseUrl.value = PROVIDER_BASE_URLS[provider] || '';
  }
  setProviderHelpLink(provider);
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function refreshTokenStatus() {
  const response = await apiFetch('/api/session/token-status', {}, { flow: 'token-status' });
  const payload = await readJsonSafe(response);
  if (!response.ok) {
    emitClientTelemetry('token_status_failed', {
      statusCode: String(response.status),
      message: payload.error || 'Could not load token status.'
    });
    throw new Error(payload.error || 'Could not load token status.');
  }
  emitClientTelemetry('token_status_loaded', {
    hasToken: String(Boolean(payload.hasToken)),
    provider: payload.provider || 'none',
    serverFallbackAvailable: String(Boolean(payload.serverFallbackAvailable))
  });
  setTokenStatusUi(payload);
}

async function saveSessionToken(event) {
  event.preventDefault();

  emitClientTelemetry('token_save_attempt', {
    provider: tokenProvider.value || 'openai'
  });

  const response = await apiFetch('/api/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: tokenProvider.value,
      token: tokenInput.value,
      baseUrl: tokenBaseUrl.value
    })
  }, { flow: 'token-save' });
  const payload = await readJsonSafe(response);

  if (!response.ok) {
    emitClientTelemetry('token_save_failed', {
      provider: tokenProvider.value || 'openai',
      statusCode: String(response.status),
      message: payload.error || 'Could not save token.'
    });
    throw new Error(payload.error || 'Could not save token.');
  }

  emitClientTelemetry('token_save_succeeded', {
    provider: tokenProvider.value || 'openai'
  });

  tokenInput.value = '';
  setSessionNotice('');
  await refreshTokenStatus();
  enterStudio({ openPrompt: true });
}

async function removeSessionToken() {
  const statusResponse = await apiFetch('/api/session/token-status', {}, { flow: 'token-logout' });
  const statusPayload = await readJsonSafe(statusResponse);
  const provider = statusPayload.provider || tokenProvider.value || 'openai';
  const response = await apiFetch('/api/session/token/logout', { method: 'POST' }, { flow: 'token-logout' });
  const payload = await readJsonSafe(response);
  if (!response.ok) {
    emitClientTelemetry('token_logout_failed', {
      provider,
      statusCode: String(response.status),
      message: payload.error || 'Could not remove token.'
    });
    throw new Error(payload.error || 'Could not remove token.');
  }
  emitClientTelemetry('token_logout_succeeded', { provider });
  const tokenUrl = selectedProviderTokenUrl(provider);
  setSessionNotice(
    'Logged out. Your session API key was removed from the server. For safety, also remove/revoke this key at your provider.',
    tokenUrl
  );
  await refreshTokenStatus();
}

function clearCanvas() {
  stopAnimation();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
}

function toCanvasX(x) {
  return canvas.width / 2 + x;
}

function toCanvasY(y) {
  return canvas.height / 2 - y;
}

function highlightLine(lineNumber) {
  if (!lineNumber || lineNumber < 1) {
    return;
  }

  const computed = getComputedStyle(codeEditor);
  const parsedLineHeight = parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 20;
  const lineIndex = lineNumber - 1;
  const lineTop = lineIndex * lineHeight;
  const lineBottom = lineTop + lineHeight;

  const visibleTop = codeEditor.scrollTop;
  const visibleBottom = visibleTop + codeEditor.clientHeight;
  const edgeBuffer = lineHeight * 2;
  const pageSize = Math.max(lineHeight * 4, codeEditor.clientHeight - edgeBuffer);

  if (lineBottom > visibleBottom - edgeBuffer) {
    const maxScrollTop = Math.max(0, codeEditor.scrollHeight - codeEditor.clientHeight);
    const targetTop = Math.min(maxScrollTop, visibleTop + pageSize);
    codeEditor.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else if (lineTop < visibleTop + lineHeight) {
    const targetTop = Math.max(0, visibleTop - pageSize);
    codeEditor.scrollTo({ top: targetTop, behavior: 'smooth' });
  }

  const lines = codeEditor.value.split('\n');
  let start = 0;
  for (let i = 0; i < lineNumber - 1 && i < lines.length; i += 1) {
    start += lines[i].length + 1;
  }
  const end = start + (lines[lineNumber - 1] || '').length;
  codeEditor.focus();
  codeEditor.setSelectionRange(start, end);
}

function drawTurtleSprite(tCtx, cx, cy, heading) {
  tCtx.save();
  tCtx.translate(cx, cy);
  // Canvas Y axis is inverted relative to math, so negate heading for rotation
  tCtx.rotate(-heading * Math.PI / 180);

  // Legs (drawn behind the shell)
  tCtx.fillStyle = '#3cb371';
  tCtx.strokeStyle = '#1a6b3c';
  tCtx.lineWidth = 1;

  tCtx.beginPath();
  tCtx.ellipse(8, -13, 4.5, 6.5, -0.35, 0, Math.PI * 2);
  tCtx.fill();
  tCtx.stroke();

  tCtx.beginPath();
  tCtx.ellipse(8, 13, 4.5, 6.5, 0.35, 0, Math.PI * 2);
  tCtx.fill();
  tCtx.stroke();

  tCtx.beginPath();
  tCtx.ellipse(-8, -13, 4.5, 6.5, 0.35, 0, Math.PI * 2);
  tCtx.fill();
  tCtx.stroke();

  tCtx.beginPath();
  tCtx.ellipse(-8, 13, 4.5, 6.5, -0.35, 0, Math.PI * 2);
  tCtx.fill();
  tCtx.stroke();

  // Tail
  tCtx.beginPath();
  tCtx.ellipse(-17, 0, 4, 3, 0, 0, Math.PI * 2);
  tCtx.fillStyle = '#3cb371';
  tCtx.fill();
  tCtx.stroke();

  // Shell body
  tCtx.beginPath();
  tCtx.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2);
  tCtx.fillStyle = '#2e8b57';
  tCtx.fill();
  tCtx.strokeStyle = '#1a5c35';
  tCtx.lineWidth = 1.5;
  tCtx.stroke();

  // Shell pattern — central oval
  tCtx.beginPath();
  tCtx.ellipse(0, 0, 6, 5, 0, 0, Math.PI * 2);
  tCtx.strokeStyle = '#1a5c35';
  tCtx.lineWidth = 1;
  tCtx.stroke();

  // Shell pattern — radial lines
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    tCtx.beginPath();
    tCtx.moveTo(Math.cos(angle) * 6, Math.sin(angle) * 5);
    tCtx.lineTo(Math.cos(angle) * 12.5, Math.sin(angle) * 9.5);
    tCtx.stroke();
  }

  // Head
  tCtx.beginPath();
  tCtx.ellipse(18, 0, 7, 5.5, 0, 0, Math.PI * 2);
  tCtx.fillStyle = '#3cb371';
  tCtx.fill();
  tCtx.strokeStyle = '#1a5c35';
  tCtx.lineWidth = 1.5;
  tCtx.stroke();

  // Eye white
  tCtx.beginPath();
  tCtx.arc(20, -2.5, 2.2, 0, Math.PI * 2);
  tCtx.fillStyle = '#ffffff';
  tCtx.fill();

  // Eye pupil
  tCtx.beginPath();
  tCtx.arc(20.6, -2.5, 1.2, 0, Math.PI * 2);
  tCtx.fillStyle = '#111111';
  tCtx.fill();

  tCtx.restore();
}

function animateTurtleTo(fromCx, fromCy, toCx, toCy, heading, duration, onDone) {
  const startTime = performance.now();

  const frame = (now) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / Math.max(1, duration));
    // Ease in-out cubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const cx = fromCx + (toCx - fromCx) * eased;
    const cy = fromCy + (toCy - fromCy) * eased;

    spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    drawTurtleSprite(spCtx, cx, cy, heading);

    if (t < 1) {
      state.animationRaf = requestAnimationFrame(frame);
    } else {
      state.animationRaf = null;
      onDone();
    }
  };

  state.animationRaf = requestAnimationFrame(frame);
}

function animateTurtleTurn(cx, cy, fromHeading, toHeading, duration, onDone) {
  const startTime = performance.now();

  let delta = toHeading - fromHeading;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  const frame = (now) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / Math.max(1, duration));
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const currentHeading = fromHeading + delta * eased;

    spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    drawTurtleSprite(spCtx, cx, cy, currentHeading);

    if (t < 1) {
      state.animationRaf = requestAnimationFrame(frame);
    } else {
      state.animationRaf = null;
      onDone();
    }
  };

  state.animationRaf = requestAnimationFrame(frame);
}

function smokePuffAndTeleport(fromCx, fromCy, toCx, toCy, heading, onDone) {
  const SMOKE_DURATION = 350;
  const startTime = performance.now();

  const particles = Array.from({ length: 8 }, () => ({
    x: fromCx + (Math.random() - 0.5) * 10,
    y: fromCy + (Math.random() - 0.5) * 10,
    vx: (Math.random() - 0.5) * 80,
    vy: -(Math.random() * 40 + 20),
    r: Math.random() * 9 + 6
  }));

  let prevTime = startTime;

  const frame = (now) => {
    const elapsed = now - startTime;
    const dt = (now - prevTime) / 1000;
    prevTime = now;
    const t = Math.min(1, elapsed / SMOKE_DURATION);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    const alpha = (1 - t) * 0.85;
    for (const p of particles) {
      spCtx.beginPath();
      spCtx.arc(p.x, p.y, Math.max(0.1, p.r * (1 - t * 0.6)), 0, Math.PI * 2);
      spCtx.fillStyle = `rgba(190, 190, 210, ${alpha})`;
      spCtx.fill();
    }

    if (t < 1) {
      state.animationRaf = requestAnimationFrame(frame);
    } else {
      spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
      drawTurtleSprite(spCtx, toCx, toCy, heading);
      state.animationRaf = null;
      onDone();
    }
  };

  state.animationRaf = requestAnimationFrame(frame);
}

function smokePuffAndVanish(cx, cy, onDone) {
  const SMOKE_DURATION = 350;
  const startTime = performance.now();

  const particles = Array.from({ length: 8 }, () => ({
    x: cx + (Math.random() - 0.5) * 10,
    y: cy + (Math.random() - 0.5) * 10,
    vx: (Math.random() - 0.5) * 80,
    vy: -(Math.random() * 40 + 20),
    r: Math.random() * 9 + 6
  }));

  let prevTime = startTime;

  const frame = (now) => {
    const elapsed = now - startTime;
    const dt = (now - prevTime) / 1000;
    prevTime = now;
    const t = Math.min(1, elapsed / SMOKE_DURATION);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    const alpha = (1 - t) * 0.85;
    for (const p of particles) {
      spCtx.beginPath();
      spCtx.arc(p.x, p.y, Math.max(0.1, p.r * (1 - t * 0.6)), 0, Math.PI * 2);
      spCtx.fillStyle = `rgba(190, 190, 210, ${alpha})`;
      spCtx.fill();
    }

    if (t < 1) {
      state.animationRaf = requestAnimationFrame(frame);
    } else {
      spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
      state.animationRaf = null;
      onDone();
    }
  };

  state.animationRaf = requestAnimationFrame(frame);
}

function runSingleCommand(command, turtle) {
  switch (command.cmd) {
    case 'penup':
      turtle.penDown = false;
      break;
    case 'pendown':
      turtle.penDown = true;
      break;
    case 'setheading':
      turtle.heading = command.value;
      break;
    case 'left':
      turtle.heading += command.value;
      break;
    case 'right':
      turtle.heading -= command.value;
      break;
    case 'goto': {
      const nextX = command.x;
      const nextY = command.y;
      if (turtle.penDown) {
        ctx.beginPath();
        ctx.strokeStyle = turtle.strokeColor;
        ctx.lineWidth = turtle.penSize;
        ctx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
        ctx.lineTo(toCanvasX(nextX), toCanvasY(nextY));
        ctx.stroke();
      }
      turtle.x = nextX;
      turtle.y = nextY;
      break;
    }
    case 'forward':
    case 'backward': {
      const multiplier = command.cmd === 'forward' ? 1 : -1;
      const radians = (Math.PI / 180) * turtle.heading;
      const nextX = turtle.x + Math.cos(radians) * command.value * multiplier;
      const nextY = turtle.y + Math.sin(radians) * command.value * multiplier;
      if (turtle.penDown) {
        ctx.beginPath();
        ctx.strokeStyle = turtle.strokeColor;
        ctx.lineWidth = turtle.penSize;
        ctx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
        ctx.lineTo(toCanvasX(nextX), toCanvasY(nextY));
        ctx.stroke();
      }
      turtle.x = nextX;
      turtle.y = nextY;
      break;
    }
    case 'color':
      turtle.strokeColor = command.value;
      turtle.fillColor = command.value;
      break;
    case 'pensize':
      turtle.penSize = Math.max(1, command.value);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.strokeStyle = turtle.strokeColor;
      ctx.lineWidth = turtle.penSize;
      ctx.arc(toCanvasX(turtle.x), toCanvasY(turtle.y), Math.abs(command.value), 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.fillStyle = turtle.fillColor;
      ctx.arc(toCanvasX(turtle.x), toCanvasY(turtle.y), Math.abs(command.value) / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'beginfill':
      turtle.fillMode = true;
      ctx.beginPath();
      ctx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
      break;
    case 'endfill':
      if (turtle.fillMode) {
        ctx.closePath();
        ctx.fillStyle = turtle.fillColor;
        ctx.fill();
      }
      turtle.fillMode = false;
      break;
    case 'home':
      turtle.x = 0;
      turtle.y = 0;
      turtle.heading = 0;
      break;
    case 'clear':
      clearCanvas();
      break;
    default:
      break;
  }
}

function stopAnimation() {
  if (state.animationTimer) {
    clearTimeout(state.animationTimer);
    state.animationTimer = null;
  }
  if (state.animationRaf) {
    cancelAnimationFrame(state.animationRaf);
    state.animationRaf = null;
  }
}

function renderProgram(program, executionPlan = [], animate = true) {
  stopAnimation();
  clearCanvas();
  canvas.style.background = program.settings?.background || '#ffffff';

  const turtle = {
    x: 0,
    y: 0,
    heading: 0,
    penDown: true,
    strokeColor: '#111111',
    fillColor: '#111111',
    penSize: 2,
    fillMode: false
  };

  if (!Array.isArray(executionPlan) || executionPlan.length === 0) {
    return;
  }

  if (!animate) {
    for (const command of executionPlan) {
      runSingleCommand(command, turtle);
    }
    spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    drawTurtleSprite(spCtx, toCanvasX(turtle.x), toCanvasY(turtle.y), turtle.heading);
    return;
  }

  let index = 0;
  const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(program.settings?.speed) || DEFAULT_SPEED));
  const delay = Math.max(20, 220 - speed * 20);

  const step = () => {
    const command = executionPlan[index];
    if (!command) {
      // Drawing is complete, make the turtle disappear in a puff of smoke
      if (index > 0) {
        smokePuffAndVanish(toCanvasX(turtle.x), toCanvasY(turtle.y), () => {
          // Animation complete, nothing more to do
        });
      }
      return;
    }

    const prevX = turtle.x;
    const prevY = turtle.y;
    const prevHeading = turtle.heading;

    runSingleCommand(command, turtle);
    highlightLine(command.line);
    index += 1;

    const fromCx = toCanvasX(prevX);
    const fromCy = toCanvasY(prevY);
    const toCx = toCanvasX(turtle.x);
    const toCy = toCanvasY(turtle.y);

    if (command.cmd === 'goto') {
      smokePuffAndTeleport(fromCx, fromCy, toCx, toCy, turtle.heading, () => {
        state.animationTimer = setTimeout(step, delay);
      });
    } else if (command.cmd === 'forward' || command.cmd === 'backward' || command.cmd === 'home') {
      animateTurtleTo(fromCx, fromCy, toCx, toCy, turtle.heading, delay, () => {
        state.animationTimer = setTimeout(step, 0);
      });
    } else if (command.cmd === 'left' || command.cmd === 'right' || command.cmd === 'setheading') {
      const turnDuration = Math.min(delay, MAX_TURN_DURATION_MS);
      animateTurtleTurn(toCx, toCy, prevHeading, turtle.heading, turnDuration, () => {
        state.animationTimer = setTimeout(step, Math.max(0, delay - turnDuration));
      });
    } else {
      spCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
      drawTurtleSprite(spCtx, toCx, toCy, turtle.heading);
      state.animationTimer = setTimeout(step, delay);
    }
  };

  // Draw the turtle at the starting position before the first step
  drawTurtleSprite(spCtx, toCanvasX(turtle.x), toCanvasY(turtle.y), turtle.heading);
  step();
}

function flattenCommands(commands) {
  const result = [];

  const walk = (items) => {
    for (const item of items) {
      if (item.cmd === 'repeat') {
        for (let i = 0; i < item.count; i += 1) {
          walk(item.body || []);
        }
      } else if (item.cmd !== 'comment') {
        result.push(item);
      }
    }
  };

  walk(commands || []);
  return result;
}

function isHappyRobotPrompt(prompt) {
  return String(prompt || '').trim().toLowerCase() === HAPPY_ROBOT_PROMPT;
}

async function doGenerate() {
  if (state.isGenerating) {
    return;
  }

  codeError.textContent = '';
  cancelTypingAnimation();
  closePromptModal();
  switchToTab('explain');
  showExplainLoading();
  setGeneratingUi(true);
  clearDebugLog();

  try {
    if (isHappyRobotPrompt(promptInput.value)) {
      state.aiCode = HAPPY_ROBOT_CODE;
      codeEditor.value = HAPPY_ROBOT_CODE;
      syncHighlight();

      showExplainResult({
        title: 'Happy Robot',
        description: 'Built-in example: a friendly robot drawn with turtle code.',
        explanation: 'Built-in example: happy robot.',
        note: 'This result uses a local hardcoded example and bypasses AI generation.',
        reviewHintText: 'Suggest → Review → Edit: let the AI guess, then fix the code.',
        warnings: [],
        suggestions: []
      });

      await runEditedCode();
      return;
    }

    const response = await apiFetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptInput.value,
        ageMode: 'kids',
        difficulty: 'easy'
      })
    }, { flow: 'generate' });

    const payload = await response.json();

    if (!response.ok) {
      emitClientTelemetry('generate_failed', {
        statusCode: String(response.status),
        message: payload.error || 'The AI got a bit muddled. Try a simpler prompt.'
      });
      throw new Error(payload.error || 'The AI got a bit muddled. Try a simpler prompt.');
    }

    emitClientTelemetry('generate_succeeded', {
      aiUsed: String(Boolean(payload.aiUsed)),
      aiProvider: payload.aiProvider || 'none',
      aiSource: payload.aiSource || 'none'
    });

    state.currentProgram = payload.program;
    state.currentPlan = payload.executionPlan || flattenCommands(payload.program.commands);
    state.aiCode = payload.displayCode;
    codeEditor.value = payload.displayCode;
    syncHighlight();

    showExplainResult({
      title: payload.program.title || '',
      description: payload.program.description || '',
      explanation: payload.aiOverview || payload.program.explanation || '',
      note: payload.transparencyNote || '',
      reviewHintText: payload.workflowHint || 'Suggest → Review → Edit: let the AI guess, then fix the code.',
      warnings: payload.warnings || [],
      suggestions: payload.suggestions || []
    });

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveDraftProject();
  } catch (error) {
    emitClientTelemetry('generate_exception', {
      message: normalizeErrorMessage(error)
    });
    showExplainError(error.message);
  } finally {
    setGeneratingUi(false);
  }
}

async function generateFromPrompt(event) {
  event.preventDefault();
  await doGenerate();
}

async function runEditedCode() {
  codeError.textContent = '';

  try {
    const response = await apiFetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeEditor.value })
    }, { flow: 'validate' });

    const payload = await response.json();

    if (!payload.valid) {
      const firstError = payload.errors?.[0];
      const prefix = firstError?.line ? `Line ${firstError.line}: ` : '';
      throw new Error(`${prefix}${firstError?.message || 'That code has a small mistake.'}`);
    }

    state.currentProgram = payload.program;
    state.currentPlan = payload.executionPlan || flattenCommands(payload.program.commands);
    state.currentCode = codeEditor.value;
    aiOverview.textContent = payload.program.explanation;

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveDraftProject();

      updateElementVisibility(aiOverview);
  } catch (error) {
    emitClientTelemetry('validate_exception', {
      message: normalizeErrorMessage(error)
    });
    codeError.textContent = error.message;
  }
}

function restoreAiCode() {
  if (!state.aiCode) {
    return;
  }

  codeEditor.value = state.aiCode;
  syncHighlight();
  runEditedCode();
}

function copyCode() {
  navigator.clipboard.writeText(codeEditor.value);
}

function setupPromptChips() {
  for (const prompt of EXAMPLE_PROMPTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = prompt;
    button.addEventListener('click', () => {
      promptInput.value = prompt;
      promptInput.focus();
    });
    chipList.append(button);
  }
}

tokenProvider.addEventListener('change', () => {
  tokenBaseUrl.value = '';
  syncProviderDefaults();
});
tokenForm.addEventListener('submit', async (event) => {
  try {
    await saveSessionToken(event);
  } catch (error) {
    tokenStatus.textContent = error.message;
  }
});
aiConnectionBadge.addEventListener('click', () => {
  enterIntroPage();
});
logoutButton.addEventListener('click', async () => {
  try {
    await removeSessionToken();
    enterIntroPage();
    tokenStatus.textContent = 'Logged out. Your session API key was removed from the server.';
  } catch (error) {
    setSessionNotice(error.message);
  }
});
introStartButton.addEventListener('click', () => {
  enterStudio({ openPrompt: true });
});
skipSplashButton.addEventListener('click', () => {
  enterStudio({ openPrompt: true });
});
openPromptButton.addEventListener('click', openPromptModal);
closePromptButton.addEventListener('click', closePromptModal);
promptForm.addEventListener('submit', generateFromPrompt);
runButton.addEventListener('click', runEditedCode);
restoreButton.addEventListener('click', restoreAiCode);
copyButton.addEventListener('click', copyCode);
saveProjectButton.addEventListener('click', () => {
  saveToHistory();
  saveDraftProject();
});
replayButton.addEventListener('click', () => {
  if (state.currentProgram) {
    renderProgram(state.currentProgram, state.currentPlan, animateToggle.checked);
  }
});
clearButton.addEventListener('click', clearCanvas);

explainTabButton.addEventListener('click', () => switchToTab('explain'));
savedTabButton.addEventListener('click', () => switchToTab('saved'));
debugTabButton.addEventListener('click', () => switchToTab('debug'));
clearDebugButton.addEventListener('click', clearDebugLog);
explainRetryButton.addEventListener('click', doGenerate);

syncProviderDefaults();
refreshTokenStatus().catch(() => {
  setTokenStatusUi({ hasToken: false, serverFallbackAvailable: false, provider: null });
});
emitClientTelemetry('client_app_loaded');
setupPromptChips();
loadDraftProject();
renderSavedProjects();
syncHighlight();
clearCanvas();
