try {
  require('dotenv').config();
} catch {
  // dotenv is optional in environments where dependencies are not installed
}
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const {
  defaultSettings,
  explainProgram,
  formatProgram,
  parseDisplayCode,
  validateProgram
} = require('./lib/turtle-program');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PROMPT_LENGTH_FOR_SIMPLIFICATION = 90;

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15_000);
const SESSION_COOKIE_NAME = 'turtlelab.sid';
const SESSION_TOKEN_TTL_MS = Number(process.env.SESSION_TOKEN_TTL_MS || 6 * 60 * 60 * 1000);
const PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-latest'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash'
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

  if (existing && /^[a-zA-Z0-9-]{16,200}$/.test(existing)) {
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

const FALLBACK_COMMANDS = [
  { cmd: 'penup' },
  { cmd: 'home' },
  { cmd: 'pendown' },
  { cmd: 'penup' },
  { cmd: 'goto', x: -120, y: -80 },
  { cmd: 'pendown' },
  { cmd: 'color', value: '#2563eb' },
  {
    cmd: 'repeat',
    count: 4,
    body: [
      { cmd: 'forward', value: 160 },
      { cmd: 'right', value: 90 }
    ]
  }
];

async function commandsForPrompt(prompt, sessionId) {
  const aiConfig = resolveAiConfig(sessionId);

  if (!aiConfig) {
    // eslint-disable-next-line no-console
    console.warn('[AI] No session token or AI_API_KEY available — falling back to default commands.');
    return { commands: FALLBACK_COMMANDS, aiUsed: false };
  }

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
      // eslint-disable-next-line no-console
      console.error(`[AI] API error ${response.status}: ${text}`);
      return { commands: FALLBACK_COMMANDS, aiUsed: false };
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const aiPayload = parseAiTurtleResponse(raw);
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

async function buildProgramFromPrompt(prompt, ageMode = 'kids', sessionId = '') {
  const simplified = shouldSimplify(prompt);
  const {
    commands,
    aiUsed,
    aiSource,
    aiProvider,
    aiTitle,
    aiDescription,
    aiExplanation
  } = await commandsForPrompt(prompt, sessionId);

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
    warnings.push('No AI token found (or provider unavailable) — showing a sample drawing instead.');
  }

  const validation = validateProgram(program);
  if (!validation.valid) {
    const fallbackProgram = {
      title: 'Simple Square',
      description: 'A simple starter drawing.',
      explanation: 'The turtle draws four equal sides and turns right 90 degrees each time.',
      settings: { ...defaultSettings },
      commands: [
        { cmd: 'penup' },
        { cmd: 'goto', x: -100, y: -100 },
        { cmd: 'pendown' },
        { cmd: 'color', value: '#2563eb' },
        {
          cmd: 'repeat',
          count: 4,
          body: [
            { cmd: 'forward', value: 200 },
            { cmd: 'right', value: 90 }
          ]
        }
      ]
    };

    const fallbackValidation = validateProgram(fallbackProgram);
    return {
      program: fallbackValidation.program,
      warnings: [...warnings, 'The AI got a bit muddled, so I used a safe starter drawing.'],
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
  const target = pathname === '/' ? '/index.html' : pathname;
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
  jsonResponse(res, 200, {
    hasToken: Boolean(tokenEntry),
    provider: tokenEntry?.provider || null,
    model: tokenEntry?.model || null,
    baseUrl: tokenEntry?.baseUrl || null,
    serverFallbackAvailable: Boolean(AI_API_KEY)
  }, sessionContext.responseHeaders);
}

function handleSetToken(req, res, sessionContext) {
  readJson(req)
    .then((body) => {
      const provider = normalizeProvider(body.provider);
      const defaults = providerDefaults(provider);
      const token = trimTo(body.token, 500);

      if (!token) {
        jsonResponse(res, 400, {
          error: 'Please provide an API token.'
        }, sessionContext.responseHeaders);
        return;
      }

      sessionTokenStore.set(sessionContext.sessionId, {
        provider,
        token,
        baseUrl: normalizeBaseUrl(body.baseUrl, defaults.baseUrl),
        model: trimTo(body.model || defaults.model, 120) || defaults.model,
        updatedAt: Date.now()
      });

      jsonResponse(res, 200, {
        ok: true,
        hasToken: true,
        provider
      }, sessionContext.responseHeaders);
    })
    .catch((error) => {
      jsonResponse(res, 400, { error: error.message || 'Could not read request.' }, sessionContext.responseHeaders);
    });
}

function handleClearToken(res, sessionContext) {
  sessionTokenStore.delete(sessionContext.sessionId);
  jsonResponse(res, 200, {
    ok: true,
    hasToken: false
  }, sessionContext.responseHeaders);
}

function handleGenerate(req, res, sessionContext) {
  readJson(req)
    .then(async (body) => {
      const prompt = clampPrompt(body.prompt);
      if (!prompt) {
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
      } = await buildProgramFromPrompt(prompt, body.ageMode, sessionContext.sessionId);
      const displayCode = formatProgram(program);

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
      jsonResponse(res, 400, {
        valid: false,
        errors: [{ message: error.message || 'Could not read request.' }]
      }, sessionContext.responseHeaders);
    });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const sessionContext = getSessionContext(req);

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

  if (req.method === 'GET') {
    serveStaticFile(res, url.pathname);
    return;
  }

  jsonResponse(res, 404, { error: 'Not found.' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`TurtleLab server running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  buildProgramFromPrompt,
  parseAiTurtleResponse,
  server
};
