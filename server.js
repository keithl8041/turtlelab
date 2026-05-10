try {
  require('dotenv').config();
} catch {
  // dotenv is optional in environments where dependencies are not installed
}
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { URL } = require('node:url');
const {
  defaultSettings,
  explainProgram,
  formatProgram,
  parseDisplayCode,
  validateProgram
} = require('./lib/turtle-program');

let appInsights = null;
try {
  appInsights = require('applicationinsights');
} catch {
  // applicationinsights is optional during local/test runs without installed dependencies
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PROMPT_LENGTH_FOR_SIMPLIFICATION = 90;

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4.1-mini';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15_000);
const APPINSIGHTS_CONNECTION_STRING = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  || 'InstrumentationKey=46b77f9a-e730-4cc7-93d8-c1e0240495cd;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/;ApplicationId=59276183-8b45-48d2-9bae-e2f44168981f';
const IS_TEST_RUNTIME = process.env.NODE_ENV === 'test' || process.argv.includes('--test');
const SESSION_COOKIE_NAME = 'turtleflow.sid';
const DEFAULT_SESSION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const SESSION_TOKEN_TTL_MS = Number(process.env.SESSION_TOKEN_TTL_MS || DEFAULT_SESSION_TOKEN_TTL_MS);
const MIN_SESSION_ID_LENGTH = 16;
const MAX_SESSION_ID_LENGTH = 200;
const SESSION_ID_PATTERN = new RegExp(`^[a-zA-Z0-9-]{${MIN_SESSION_ID_LENGTH},${MAX_SESSION_ID_LENGTH}}$`);
const ADMIN_PORTAL_PASSWORD = String(process.env.ADMIN_PORTAL_PASSWORD || '');
const ADMIN_NOTIFICATION_WEBHOOK_URL = String(process.env.ADMIN_NOTIFICATION_WEBHOOK_URL || '').trim();
const COMMUNITY_GALLERY_TABLE_SAS_URL = String(process.env.COMMUNITY_GALLERY_TABLE_SAS_URL || '').trim();
const COMMUNITY_GALLERY_TABLE_PARTITION = String(process.env.COMMUNITY_GALLERY_TABLE_PARTITION || 'gallery').slice(0, 100);
const COMMUNITY_GALLERY_CACHE_FILE = process.env.COMMUNITY_GALLERY_CACHE_FILE
  || path.join(IS_TEST_RUNTIME ? os.tmpdir() : __dirname, 'community-gallery-cache.json');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AI_TAG_GENERATION_TEMPERATURE = 0.2;
const PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3-flash-preview'
  },
  custom: {
    baseUrl: AI_BASE_URL,
    model: AI_MODEL
  }
};

const TURTLE_DSL_SYSTEM_PROMPT = `You are a Logo turtle graphics code generator for children. Return only valid JSON.

Output format:
{
  "title": "Short drawing title",
  "description": "One short sentence describing the drawing",
  "explanation": "A kid-friendly explanation (max 60 words) of what the turtle drew",
  "commands": [ ...turtle commands... ]
}

## State tracking (critical)
Before you write a single command, sketch the full drawing in your head:
- Decide where each part of the image will sit on the canvas.
- Know the turtle's exact (x, y) position and heading (in degrees) at every step.
- After each shape or move, confirm where the turtle is before continuing.
- Parts of the drawing must connect and relate to each other — no scattered, unrelated shapes.

## Canvas
800×600 pixels. Origin (0,0) is the centre. X increases right, Y increases up (range: −400..400, −300..300).

## Commands
\`\`\`
{ "cmd": "forward",    "value": <1–500> }
{ "cmd": "backward",   "value": <1–500> }
{ "cmd": "left",       "value": <degrees> }
{ "cmd": "right",      "value": <degrees> }
{ "cmd": "penup" }
{ "cmd": "pendown" }
{ "cmd": "setheading", "value": <degrees: 0=right 90=up 180=left 270=down> }
{ "cmd": "goto",       "x": <−400..400>, "y": <−300..300> }
{ "cmd": "color",      "value": "<#rrggbb or name: black white red green blue yellow orange purple pink brown gray>" }
{ "cmd": "pensize",    "value": <number> }
{ "cmd": "beginfill" }
{ "cmd": "endfill" }
{ "cmd": "circle",     "value": <radius 1–300> }
{ "cmd": "dot",        "value": <diameter> }
{ "cmd": "repeat",     "count": <1–50>, "body": [ ...commands ] }
{ "cmd": "home" }
{ "cmd": "comment",    "value": "<what the next block does>" }
\`\`\`

## Drawing rules
- **Always start with:** penup → home → pendown.
- **Walk, don't jump.** Use forward/backward/left/right for all drawing. Use repeat to build polygons, stars, spirals. Use goto (wrapped in penup/pendown) only to reposition between separate parts.
- **Keep it together.** Position shapes so they form one coherent scene — a house has walls, a roof above them, windows inside the walls. Use goto to reach deliberate start points; use setheading to set a consistent facing direction when starting a new part.
- Keep total expanded command count under 500. Nest repeat at most 6 levels deep.
- Add a comment before each distinct part of the drawing.
- Return ONLY raw JSON. No markdown. No code fences. No extra text.
`;

const rateLimitStore = new Map();
const sessionTokenStore = new Map();
const communityGalleryStore = new Map();
let communityGalleryLoaded = false;

let telemetryClient = null;
if (!IS_TEST_RUNTIME && appInsights && APPINSIGHTS_CONNECTION_STRING) {
  try {
    appInsights
      .setup(APPINSIGHTS_CONNECTION_STRING)
      .setAutoCollectRequests(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectPerformance(false)
      .setAutoCollectConsole(false)
      .setUseDiskRetryCaching(true)
      .start();
    telemetryClient = appInsights.defaultClient;
    telemetryClient.commonProperties = {
      service: 'turtleflow',
      runtime: 'node'
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[Telemetry] Application Insights setup failed:', error.message);
    telemetryClient = null;
  }
}

function truncateValue(value, maxLength = 180) {
  return String(value || '').slice(0, maxLength);
}

function sanitizeProperties(properties = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) {
      continue;
    }
    clean[key] = truncateValue(value, 240);
  }
  return clean;
}

function getOperationId(req) {
  const headerValue = String(req.headers['x-correlation-id'] || '').trim();
  if (headerValue && headerValue.length <= 120) {
    return headerValue;
  }
  return createSessionId();
}

function trackEvent(name, properties = {}, measurements = {}) {
  if (!telemetryClient) {
    return;
  }
  telemetryClient.trackEvent({
    name,
    properties: sanitizeProperties(properties),
    measurements
  });
}

function trackException(error, properties = {}) {
  if (!telemetryClient || !error) {
    return;
  }
  telemetryClient.trackException({
    exception: error,
    properties: sanitizeProperties(properties)
  });
}

function baseUrlHost(url) {
  try {
    return new URL(String(url || '')).host;
  } catch {
    return 'invalid';
  }
}

function jsonResponse(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) {
        reject(new Error('Request body is too large.'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function isRateLimited(ipAddress) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 20;
  const entries = rateLimitStore.get(ipAddress) || [];
  const nextEntries = entries.filter((timestamp) => now - timestamp < windowMs);

  if (nextEntries.length >= maxRequests) {
    rateLimitStore.set(ipAddress, nextEntries);
    return true;
  }

  nextEntries.push(now);
  rateLimitStore.set(ipAddress, nextEntries);
  return false;
}

function clampPrompt(rawPrompt) {
  return String(rawPrompt || '').replace(/[<>]/g, '').slice(0, 240).trim();
}

function parseCookies(cookieHeader) {
  const cookies = {};
  const raw = String(cookieHeader || '');
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function createSessionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function isHttpsRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.socket.encrypted || forwardedProto === 'https';
}

function buildSessionCookie(sessionId, req) {
  const secureFlag = isHttpsRequest(req) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`;
}

function purgeExpiredSessionTokens(now = Date.now()) {
  for (const [sessionId, entry] of sessionTokenStore.entries()) {
    if (!entry || now - Number(entry.updatedAt || 0) > SESSION_TOKEN_TTL_MS) {
      sessionTokenStore.delete(sessionId);
    }
  }
}

function getSessionContext(req) {
  purgeExpiredSessionTokens();
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[SESSION_COOKIE_NAME];

  if (existing && SESSION_ID_PATTERN.test(existing)) {
    return {
      sessionId: existing,
      responseHeaders: {}
    };
  }

  const sessionId = createSessionId();
  return {
    sessionId,
    responseHeaders: {
      'Set-Cookie': buildSessionCookie(sessionId, req)
    }
  };
}

function providerDefaults(provider) {
  return PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
}

function normalizeProvider(rawProvider) {
  const provider = String(rawProvider || 'openai').toLowerCase();
  return Object.hasOwn(PROVIDER_DEFAULTS, provider) ? provider : 'openai';
}

function trimTo(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

function normalizeTag(tag) {
  return trimTo(tag, 32)
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fallbackTagsForEntry(entry) {
  const haystack = `${entry.title} ${entry.description} ${entry.prompt}`.toLowerCase();
  const matchedTags = [];
  const keywordTags = [
    ['robot', 'robot'],
    ['house', 'house'],
    ['tree', 'tree'],
    ['flower', 'flower'],
    ['star', 'star'],
    ['sun', 'sun'],
    ['moon', 'moon'],
    ['cat', 'animal'],
    ['dog', 'animal'],
    ['bird', 'animal'],
    ['fish', 'animal'],
    ['car', 'vehicle'],
    ['rocket', 'space'],
    ['planet', 'space'],
    ['heart', 'love'],
    ['circle', 'shape'],
    ['square', 'shape'],
    ['triangle', 'shape']
  ];

  for (const [keyword, tag] of keywordTags) {
    if (haystack.includes(keyword)) {
      matchedTags.push(tag);
    }
  }

  if (matchedTags.length === 0) {
    matchedTags.push('drawing');
  }

  return Array.from(new Set(matchedTags.map(normalizeTag).filter(Boolean))).slice(0, 6);
}

function parseMaybeJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildPublicGalleryEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    prompt: entry.prompt,
    code: entry.code,
    title: entry.title,
    description: entry.description,
    explanation: entry.explanation,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt
  };
}

function buildAdminGalleryEntry(entry) {
  return {
    ...buildPublicGalleryEntry(entry),
    email: entry.email,
    status: entry.status,
    reviewedAt: entry.reviewedAt || null
  };
}

function galleryEntriesSorted() {
  return Array.from(communityGalleryStore.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function tableSasUrl(pathSuffix = '', extraQuery = {}) {
  if (!COMMUNITY_GALLERY_TABLE_SAS_URL) {
    return '';
  }
  const source = new URL(COMMUNITY_GALLERY_TABLE_SAS_URL);
  const target = new URL(`${source.origin}${source.pathname}${pathSuffix}`);
  for (const [key, value] of source.searchParams.entries()) {
    target.searchParams.append(key, value);
  }
  for (const [key, value] of Object.entries(extraQuery)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function escapeODataStringLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function tableEntityPath(partitionKey, rowKey) {
  return `(PartitionKey='${encodeURIComponent(String(partitionKey || ''))}',RowKey='${encodeURIComponent(String(rowKey || ''))}')`;
}

function tableHeaders(contentType = 'application/json') {
  return {
    Accept: 'application/json;odata=nometadata',
    'Content-Type': contentType,
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': '2019-02-02'
  };
}

function cacheSnapshot() {
  return galleryEntriesSorted().map((entry) => ({ ...entry }));
}

function writeGalleryCacheFile() {
  try {
    fs.writeFileSync(COMMUNITY_GALLERY_CACHE_FILE, JSON.stringify(cacheSnapshot(), null, 2), 'utf8');
  } catch {
    // Cache file writes are best effort.
  }
}

function applyGalleryRows(rows) {
  communityGalleryStore.clear();
  for (const row of rows || []) {
    if (!row || !row.id) {
      continue;
    }
    communityGalleryStore.set(row.id, row);
  }
  communityGalleryLoaded = true;
}

function deserializeTableEntity(entity) {
  return {
    id: trimTo(entity.RowKey, 120),
    status: trimTo(entity.status || 'pending', 30) || 'pending',
    name: trimTo(entity.name, 120),
    email: trimTo(entity.email, 200).toLowerCase(),
    prompt: trimTo(entity.prompt, 400),
    code: trimTo(entity.code, 20_000),
    title: trimTo(entity.title, 160),
    description: trimTo(entity.description, 500),
    explanation: trimTo(entity.explanation, 700),
    tags: parseMaybeJson(entity.tagsJson, []),
    createdAt: trimTo(entity.createdAt, 50),
    reviewedAt: trimTo(entity.reviewedAt, 50) || null
  };
}

function serializeTableEntity(entry) {
  return {
    PartitionKey: COMMUNITY_GALLERY_TABLE_PARTITION,
    RowKey: entry.id,
    status: entry.status,
    name: entry.name,
    email: entry.email,
    prompt: entry.prompt,
    code: entry.code,
    title: entry.title,
    description: entry.description,
    explanation: entry.explanation,
    tagsJson: JSON.stringify(entry.tags || []),
    createdAt: entry.createdAt,
    reviewedAt: entry.reviewedAt || ''
  };
}

async function loadGalleryCache() {
  if (communityGalleryLoaded) {
    return;
  }

  if (COMMUNITY_GALLERY_TABLE_SAS_URL) {
    try {
      const url = tableSasUrl('', {
        $filter: `PartitionKey eq '${escapeODataStringLiteral(COMMUNITY_GALLERY_TABLE_PARTITION)}'`
      });
      const response = await fetch(url, { headers: tableHeaders() });
      if (response.ok) {
        const payload = await response.json();
        const rows = Array.isArray(payload?.value) ? payload.value.map(deserializeTableEntity) : [];
        applyGalleryRows(rows);
        writeGalleryCacheFile();
        return;
      }
    } catch {
      // Continue to disk cache fallback.
    }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(COMMUNITY_GALLERY_CACHE_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      applyGalleryRows(parsed.map((entry) => ({
        ...entry,
        tags: Array.isArray(entry.tags) ? entry.tags : []
      })));
      return;
    }
  } catch {
    // No local cache yet.
  }

  applyGalleryRows([]);
}

async function persistGalleryEntry(entry) {
  communityGalleryStore.set(entry.id, entry);
  writeGalleryCacheFile();

  if (!COMMUNITY_GALLERY_TABLE_SAS_URL) {
    return;
  }

  const entity = serializeTableEntity(entry);
  const response = await fetch(tableSasUrl(), {
    method: 'POST',
    headers: tableHeaders(),
    body: JSON.stringify(entity)
  });
  if (!response.ok) {
    throw new Error('Could not persist gallery submission.');
  }
}

async function mergeGalleryEntry(entry) {
  communityGalleryStore.set(entry.id, entry);
  writeGalleryCacheFile();

  if (!COMMUNITY_GALLERY_TABLE_SAS_URL) {
    return;
  }

  const response = await fetch(tableSasUrl(tableEntityPath(COMMUNITY_GALLERY_TABLE_PARTITION, entry.id)), {
    method: 'PUT',
    headers: {
      ...tableHeaders(),
      'If-Match': '*'
    },
    body: JSON.stringify(serializeTableEntity(entry))
  });
  if (!response.ok) {
    throw new Error('Could not update gallery submission.');
  }
}

function adminPasswordValid(req) {
  if (!ADMIN_PORTAL_PASSWORD) {
    return false;
  }
  const headerValue = String(req.headers['x-admin-password'] || '');
  const expected = Buffer.from(ADMIN_PORTAL_PASSWORD);
  const actual = Buffer.from(headerValue);
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

async function notifyAdminSubmission(entry) {
  if (!ADMIN_NOTIFICATION_WEBHOOK_URL) {
    return false;
  }

  const response = await fetch(ADMIN_NOTIFICATION_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'community_gallery_submission',
      submittedAt: entry.createdAt,
      id: entry.id,
      name: entry.name,
      email: entry.email,
      prompt: entry.prompt,
      title: entry.title,
      description: entry.description
    })
  });

  if (!response.ok) {
    throw new Error('Failed to send admin notification.');
  }
  return true;
}

async function generateTagsForEntry(entry, sessionContext) {
  const fallback = fallbackTagsForEntry(entry);
  const aiConfig = resolveAiConfig(sessionContext.sessionId);
  if (!aiConfig) {
    return fallback;
  }

  try {
    const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: AI_TAG_GENERATION_TEMPERATURE,
        messages: [
          {
            role: 'system',
            content: 'Return ONLY JSON: an array of 1-6 short lowercase tags (no punctuation) for a turtle drawing.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              title: entry.title,
              description: entry.description,
              prompt: entry.prompt,
              codePreview: entry.code.slice(0, 700)
            })
          }
        ]
      })
    });

    if (!response.ok) {
      return fallback;
    }
    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content || '').trim().replace(/^```[\w]*\n?/m, '').replace(/```$/m, '');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    const tags = Array.from(new Set(parsed.map(normalizeTag).filter(Boolean))).slice(0, 6);
    return tags.length > 0 ? tags : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBaseUrl(url, fallback) {
  const base = trimTo(url || fallback, 240).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    return fallback.replace(/\/+$/, '');
  }
  return base;
}

function resolveAiConfig(sessionId) {
  const sessionToken = sessionTokenStore.get(sessionId);
  if (sessionToken) {
    const defaults = providerDefaults(sessionToken.provider);
    return {
      apiKey: sessionToken.token,
      baseUrl: normalizeBaseUrl(sessionToken.baseUrl, defaults.baseUrl),
      model: trimTo(sessionToken.model || defaults.model, 120) || defaults.model,
      source: 'session',
      provider: sessionToken.provider
    };
  }

  if (AI_API_KEY) {
    return {
      apiKey: AI_API_KEY,
      baseUrl: normalizeBaseUrl(AI_BASE_URL, PROVIDER_DEFAULTS.openai.baseUrl),
      model: trimTo(AI_MODEL, 120) || PROVIDER_DEFAULTS.openai.model,
      source: 'server',
      provider: 'server-default'
    };
  }

  return null;
}

const FALLBACK_COMMANDS = [];

async function commandsForPrompt(prompt, sessionId, operationId = 'none') {
  const aiConfig = resolveAiConfig(sessionId);

  if (!aiConfig) {
    trackEvent('ai_config_missing', {
      operationId,
      reason: 'no_token_available'
    });
    // eslint-disable-next-line no-console
    console.warn('[AI] No session token or AI_API_KEY available — returning an empty command set.');
    return { commands: FALLBACK_COMMANDS, aiUsed: false };
  }

  trackEvent('ai_request_started', {
    operationId,
    source: aiConfig.source,
    provider: aiConfig.provider,
    model: aiConfig.model,
    baseUrlHost: baseUrlHost(aiConfig.baseUrl)
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: 0.9,
        messages: [
          { role: 'system', content: TURTLE_DSL_SYSTEM_PROMPT },
          { role: 'user', content: `Draw: ${prompt}` }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      trackEvent('ai_request_failed', {
        operationId,
        source: aiConfig.source,
        provider: aiConfig.provider,
        model: aiConfig.model,
        baseUrlHost: baseUrlHost(aiConfig.baseUrl),
        statusCode: String(response.status),
        responsePreview: truncateValue(text, 200)
      });
      // eslint-disable-next-line no-console
      console.error(`[AI] API error ${response.status}: ${text}`);
      return { commands: FALLBACK_COMMANDS, aiUsed: false };
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const aiPayload = parseAiTurtleResponse(raw);
    trackEvent('ai_request_succeeded', {
      operationId,
      source: aiConfig.source,
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrlHost: baseUrlHost(aiConfig.baseUrl)
    });
    return {
      commands: aiPayload.commands,
      aiTitle: aiPayload.title,
      aiDescription: aiPayload.description,
      aiExplanation: aiPayload.explanation,
      aiUsed: true,
      aiSource: aiConfig.source,
      aiProvider: aiConfig.provider
    };
  } catch (error) {
    trackException(error, {
      operationId,
      source: aiConfig.source,
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrlHost: baseUrlHost(aiConfig.baseUrl),
      stage: 'commandsForPrompt'
    });
    trackEvent('ai_request_exception', {
      operationId,
      source: aiConfig.source,
      provider: aiConfig.provider,
      errorName: error.name,
      message: truncateValue(error.message, 200)
    });
    // eslint-disable-next-line no-console
    console.error('[AI] commandsForPrompt failed:', error.message);
    return { commands: FALLBACK_COMMANDS, aiUsed: false };
  } finally {
    clearTimeout(timer);
  }
}

function parseAiTurtleResponse(rawMessage) {
  const cleaned = String(rawMessage || '').replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();
  const parsed = JSON.parse(cleaned);

  if (Array.isArray(parsed)) {
    return { commands: parsed };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.commands)) {
    throw new Error('AI did not return a valid turtle JSON object.');
  }

  return {
    commands: parsed.commands,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : undefined
  };
}

function shouldSimplify(prompt) {
  return (
    prompt.length > MAX_PROMPT_LENGTH_FOR_SIMPLIFICATION
    || /whole solar system|realistic|battle|thousands|photorealistic|entire world/i.test(prompt)
  );
}

function getSuggestions(program) {
  const suggestions = [];
  const code = formatProgram(program);

  if (code.includes('repeat(')) {
    suggestions.push('Try changing a repeat count to make more or fewer shapes.');
  }
  if (code.includes('right(') || code.includes('left(')) {
    suggestions.push('Try changing an angle to see how corners and stars change.');
  }
  if (code.includes('forward(') || code.includes('circle(')) {
    suggestions.push('Try making one number bigger to make the drawing larger.');
  }

  return suggestions.slice(0, 2);
}

async function buildProgramFromPrompt(prompt, ageMode = 'kids', sessionId = '', operationId = 'none') {
  const simplified = shouldSimplify(prompt);
  const {
    commands,
    aiUsed,
    aiSource,
    aiProvider,
    aiTitle,
    aiDescription,
    aiExplanation
  } = await commandsForPrompt(prompt, sessionId, operationId);

  const program = {
    title: aiTitle || 'AI Turtle Drawing',
    description: aiDescription || (simplified ? 'A simpler version of your idea for easy turtle drawing.' : 'A turtle drawing from your prompt.'),
    explanation: aiExplanation || (simplified
      ? 'I made a simpler version so the turtle could draw it clearly. The turtle follows each command to build the picture.'
      : 'The turtle follows each command in order to draw your picture step by step.'),
    settings: {
      ...defaultSettings,
      speed: ageMode === 'kids' ? 4 : 8
    },
    commands
  };

  const warnings = [];
  if (simplified) {
    warnings.push('I made a simpler version so the turtle could draw it.');
  }
  if (!aiUsed) {
    warnings.push('No AI token found (or provider unavailable) — cleared the canvas instead.');
  }

  const validation = validateProgram(program);
  if (!validation.valid) {
    const fallbackProgram = {
      title: 'No drawing available',
      description: 'The canvas was cleared because the AI response could not be used safely.',
      explanation: 'The turtle program could not be validated, so no drawing was rendered.',
      settings: { ...defaultSettings },
      commands: []
    };

    const fallbackValidation = validateProgram(fallbackProgram);
    return {
      program: fallbackValidation.program,
      warnings: [...warnings, 'The AI got a bit muddled, so I cleared the canvas instead.'],
      executionPlan: fallbackValidation.executionPlan,
      aiUsed,
      aiSource,
      aiProvider
    };
  }

  return {
    program: validation.program,
    warnings,
    executionPlan: validation.executionPlan,
    aiUsed,
    aiSource,
    aiProvider
  };
}

function inferMimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStaticFile(res, pathname) {
  const target = pathname === '/'
    ? '/index.html'
    : (pathname === '/admin' ? '/admin.html' : pathname);
  const safeTarget = path.normalize(target).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeTarget);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    jsonResponse(res, 400, { error: 'Bad path.' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') {
        jsonResponse(res, 404, { error: 'Not found.' });
        return;
      }

      jsonResponse(res, 500, { error: 'Unable to read file.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': inferMimeType(filePath),
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function handleTokenStatus(res, sessionContext) {
  const tokenEntry = sessionTokenStore.get(sessionContext.sessionId);
  trackEvent('session_token_status_checked', {
    operationId: sessionContext.operationId,
    hasToken: String(Boolean(tokenEntry)),
    provider: tokenEntry?.provider || 'none',
    serverFallbackAvailable: String(Boolean(AI_API_KEY))
  });
  jsonResponse(res, 200, {
    hasToken: Boolean(tokenEntry),
    provider: tokenEntry?.provider || null,
    baseUrl: tokenEntry?.baseUrl || null,
    model: tokenEntry?.model || null,
    serverFallbackAvailable: Boolean(AI_API_KEY)
  }, sessionContext.responseHeaders);
}

function handleSetToken(req, res, sessionContext) {
  readJson(req)
    .then((body) => {
      const provider = normalizeProvider(body.provider);
      const defaults = providerDefaults(provider);
      const token = trimTo(body.token, 500);
      const requestedModel = trimTo(body.model, 120);

      // if (!token) {
      //   jsonResponse(res, 400, {
      //     error: 'Please provide an API token.'
      //   }, sessionContext.responseHeaders);
      //   return;
      // }

      sessionTokenStore.set(sessionContext.sessionId, {
        provider,
        token,
        baseUrl: normalizeBaseUrl(body.baseUrl, defaults.baseUrl),
        model: requestedModel || defaults.model,
        updatedAt: Date.now()
      });

      trackEvent('session_token_saved', {
        operationId: sessionContext.operationId,
        provider,
        baseUrlHost: baseUrlHost(normalizeBaseUrl(body.baseUrl, defaults.baseUrl)),
        tokenLength: String(token.length)
      });

      jsonResponse(res, 200, {
        ok: true,
        hasToken: true,
        provider,
        model: requestedModel || defaults.model
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      trackException(error, {
        operationId: sessionContext.operationId,
        route: '/api/session/token'
      });
      jsonResponse(res, 400, { error: error.message || 'Could not read request.' }, sessionContext.responseHeaders);
    });
}

function handleClearToken(res, sessionContext) {
  const hadToken = sessionTokenStore.has(sessionContext.sessionId);
  sessionTokenStore.delete(sessionContext.sessionId);
  trackEvent('session_token_cleared', {
    operationId: sessionContext.operationId,
    hadToken: String(hadToken)
  });
  jsonResponse(res, 200, {
    ok: true,
    hasToken: false
  }, sessionContext.responseHeaders);
}

function handleGenerate(req, res, sessionContext) {
  const requestStart = Date.now();
  readJson(req)
    .then(async (body) => {
      const prompt = clampPrompt(body.prompt);
      if (!prompt) {
        trackEvent('generate_rejected', {
          operationId: sessionContext.operationId,
          reason: 'empty_prompt'
        });
        jsonResponse(res, 400, {
          error: 'Please type what you want the turtle to draw.'
        }, sessionContext.responseHeaders);
        return;
      }

      const {
        program,
        warnings,
        executionPlan,
        aiUsed,
        aiSource,
        aiProvider
      } = await buildProgramFromPrompt(prompt, body.ageMode, sessionContext.sessionId, sessionContext.operationId);
      const displayCode = formatProgram(program);

      trackEvent('generate_completed', {
        operationId: sessionContext.operationId,
        aiUsed: String(Boolean(aiUsed)),
        aiSource: aiSource || 'none',
        aiProvider: aiProvider || 'none',
        simplified: String(Boolean(shouldSimplify(prompt)))
      }, {
        durationMs: Date.now() - requestStart,
        promptLength: prompt.length
      });

      jsonResponse(res, 200, {
        program,
        displayCode,
        warnings,
        suggestions: getSuggestions(program),
        executionPlan,
        aiUsed,
        aiSource,
        aiProvider,
        aiOverview: program.explanation,
        workflowHint: 'Suggest → Review → Edit: the AI guessed first, now try fixing the code to improve the drawing.',
        transparencyNote: aiUsed
          ? 'The AI turned your words into turtle code. You can check and change its code below.'
          : 'This is a sample drawing. Add your own API token in the splash screen (optional).'
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      trackException(error, {
        operationId: sessionContext.operationId,
        route: '/api/generate'
      });
      jsonResponse(res, 400, { error: error.message || 'Could not read request.' }, sessionContext.responseHeaders);
    });
}

function handleValidate(req, res, sessionContext) {
  readJson(req)
    .then((body) => {
      const parseResult = parseDisplayCode(body.code || '');

      if (!parseResult.valid) {
        jsonResponse(res, 200, {
          valid: false,
          errors: parseResult.errors.map((error) => ({
            line: error.line,
            message: error.message
          }))
        }, sessionContext.responseHeaders);
        return;
      }

      const program = {
        ...parseResult.program,
        explanation: explainProgram(parseResult.program)
      };

      jsonResponse(res, 200, {
        valid: true,
        program,
        executionPlan: parseResult.executionPlan,
        displayCode: formatProgram(program)
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      trackException(error, {
        operationId: sessionContext.operationId,
        route: '/api/validate'
      });
      jsonResponse(res, 400, { valid: false, errors: [{ message: error.message || 'Invalid request.' }] }, sessionContext.responseHeaders);
    });
}

function handleExplain(req, res, sessionContext) {
  readJson(req)
    .then((body) => {
      if (typeof body.code === 'string') {
        const parsed = parseDisplayCode(body.code);
        if (!parsed.valid) {
          jsonResponse(res, 200, {
            valid: false,
            errors: parsed.errors
          }, sessionContext.responseHeaders);
          return;
        }

        jsonResponse(res, 200, {
          valid: true,
          explanation: explainProgram(parsed.program)
        }, sessionContext.responseHeaders);
        return;
      }

      if (body.program && typeof body.program === 'object') {
        const validation = validateProgram(body.program);
        if (!validation.valid) {
          jsonResponse(res, 200, {
            valid: false,
            errors: validation.errors
          }, sessionContext.responseHeaders);
          return;
        }

        jsonResponse(res, 200, {
          valid: true,
          explanation: explainProgram(validation.program)
        }, sessionContext.responseHeaders);
        return;
      }

      jsonResponse(res, 400, {
        valid: false,
        errors: [{ message: 'Please provide code or a program to explain.' }]
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      trackException(error, {
        operationId: sessionContext.operationId,
        route: '/api/explain'
      });
      jsonResponse(res, 400, {
        valid: false,
        errors: [{ message: error.message || 'Could not read request.' }]
      }, sessionContext.responseHeaders);
    });
}

function handleClientTelemetry(req, res, sessionContext) {
  readJson(req)
    .then((body) => {
      const eventName = trimTo(body.eventName, 120) || 'client_event';
      const rawProperties = body.properties && typeof body.properties === 'object' ? body.properties : {};
      const rawMeasurements = body.measurements && typeof body.measurements === 'object' ? body.measurements : {};
      const measurements = {};
      for (const [key, value] of Object.entries(rawMeasurements)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          measurements[trimTo(key, 60) || 'value'] = parsed;
        }
      }

      trackEvent(eventName, {
        ...rawProperties,
        operationId: sessionContext.operationId,
        sessionIdHash: crypto.createHash('sha256').update(sessionContext.sessionId).digest('hex').slice(0, 16)
      }, measurements);

      jsonResponse(res, 200, { ok: true }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      trackException(error, {
        operationId: sessionContext.operationId,
        route: '/api/telemetry'
      });
      jsonResponse(res, 400, { error: error.message || 'Could not read request.' }, sessionContext.responseHeaders);
    });
}

function handleGalleryList(res, sessionContext) {
  loadGalleryCache()
    .then(() => {
      const acceptedEntries = galleryEntriesSorted()
        .filter((entry) => entry.status === 'accepted')
        .map(buildPublicGalleryEntry);
      jsonResponse(res, 200, {
        items: acceptedEntries
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      jsonResponse(res, 500, { error: error.message || 'Could not load gallery.' }, sessionContext.responseHeaders);
    });
}

function handleGallerySubmission(req, res, sessionContext) {
  readJson(req)
    .then(async (body) => {
      await loadGalleryCache();
      const name = trimTo(body.name, 120);
      const email = trimTo(body.email, 200).toLowerCase();
      const prompt = trimTo(body.prompt, 400);
      const code = trimTo(body.code, 20_000);
      const title = trimTo(body.metadata?.title, 160);
      const description = trimTo(body.metadata?.description, 500);
      const explanation = trimTo(body.metadata?.explanation, 700);

      if (!name || !isValidEmail(email) || !prompt || !code) {
        jsonResponse(res, 400, {
          error: 'Please provide name, valid email, prompt, and code.'
        }, sessionContext.responseHeaders);
        return;
      }

      const createdAt = new Date().toISOString();
      const entry = {
        id: createSessionId(),
        status: 'pending',
        name,
        email,
        prompt,
        code,
        title: title || 'Community submission',
        description,
        explanation,
        tags: [],
        createdAt,
        reviewedAt: null
      };

      await persistGalleryEntry(entry);
      let adminNotified = false;
      let notificationError = '';
      try {
        adminNotified = await notifyAdminSubmission(entry);
      } catch {
        notificationError = 'Submission saved, but notification delivery failed.';
      }

      jsonResponse(res, 201, {
        ok: true,
        id: entry.id,
        status: entry.status,
        adminNotified,
        notificationError: notificationError || undefined
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      jsonResponse(res, 400, { error: error.message || 'Could not save submission.' }, sessionContext.responseHeaders);
    });
}

function handleAdminList(req, res, sessionContext) {
  if (!adminPasswordValid(req)) {
    jsonResponse(res, 401, { error: 'Unauthorized.' }, sessionContext.responseHeaders);
    return;
  }
  loadGalleryCache()
    .then(() => {
      jsonResponse(res, 200, {
        items: galleryEntriesSorted().map(buildAdminGalleryEntry)
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      jsonResponse(res, 500, { error: error.message || 'Could not load submissions.' }, sessionContext.responseHeaders);
    });
}

function handleAdminDecision(req, res, sessionContext, entryId) {
  if (!adminPasswordValid(req)) {
    jsonResponse(res, 401, { error: 'Unauthorized.' }, sessionContext.responseHeaders);
    return;
  }

  readJson(req)
    .then(async (body) => {
      await loadGalleryCache();
      const decision = trimTo(body.decision || body.status, 20).toLowerCase();
      if (decision !== 'accept' && decision !== 'reject' && decision !== 'accepted' && decision !== 'rejected') {
        jsonResponse(res, 400, { error: 'Decision must be accept or reject.' }, sessionContext.responseHeaders);
        return;
      }

      const target = communityGalleryStore.get(entryId);
      if (!target) {
        jsonResponse(res, 404, { error: 'Submission not found.' }, sessionContext.responseHeaders);
        return;
      }

      target.status = decision.startsWith('accept') ? 'accepted' : 'rejected';
      if (target.status === 'accepted') {
        target.tags = await generateTagsForEntry(target, sessionContext);
      } else {
        target.tags = [];
      }
      target.reviewedAt = new Date().toISOString();
      await mergeGalleryEntry(target);

      jsonResponse(res, 200, {
        ok: true,
        item: buildAdminGalleryEntry(target)
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      jsonResponse(res, 400, { error: error.message || 'Could not update submission.' }, sessionContext.responseHeaders);
    });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const operationId = getOperationId(req);
  const sessionContext = {
    ...getSessionContext(req),
    operationId
  };
  res.setHeader('X-Correlation-Id', operationId);

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const ipAddress = req.socket.remoteAddress || 'unknown';
      if (isRateLimited(ipAddress)) {
        jsonResponse(res, 429, {
          error: 'Too many drawing requests right now. Please try again in a moment.'
        }, sessionContext.responseHeaders);
        return;
      }

    handleGenerate(req, res, sessionContext);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session/token-status') {
    handleTokenStatus(res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/session/token') {
    handleSetToken(req, res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/session/token/logout') {
    handleClearToken(res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/validate') {
    handleValidate(req, res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/explain') {
    handleExplain(req, res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/telemetry') {
    handleClientTelemetry(req, res, sessionContext);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/gallery') {
    handleGalleryList(res, sessionContext);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/gallery/submissions') {
    handleGallerySubmission(req, res, sessionContext);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/submissions') {
    handleAdminList(req, res, sessionContext);
    return;
  }

  if (req.method === 'POST' && /^\/api\/admin\/submissions\/[^/]+\/decision$/.test(url.pathname)) {
    const [, , , , entryId] = url.pathname.split('/');
    handleAdminDecision(req, res, sessionContext, decodeURIComponent(entryId || ''));
    return;
  }

  if (req.method === 'GET') {
    serveStaticFile(res, url.pathname);
    return;
  }

  jsonResponse(res, 404, { error: 'Not found.' });
});

if (require.main === module) {
  loadGalleryCache().catch(() => {
    // Cache warmup is best effort.
  });
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Turtle Flow AI server running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  buildProgramFromPrompt,
  parseAiTurtleResponse,
  server
};
