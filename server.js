require('dotenv').config();
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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

const TURTLE_DSL_SYSTEM_PROMPT = `You are a Logo turtle graphics code generator. Given a user prompt, return a JSON array of turtle drawing commands.

Think like a classic Logo turtle: the turtle has a position and a heading, and you move it by walking it forward/backward and turning it left/right. Prefer these relative movement commands over absolute positioning.

The turtle canvas is 800x600 pixels. The origin (0,0) is at the centre. X increases right, Y increases up.

Allowed commands (use these exact shapes):
  { "cmd": "forward", "value": <number 1-500> }
  { "cmd": "backward", "value": <number 1-500> }
  { "cmd": "left", "value": <degrees> }
  { "cmd": "right", "value": <degrees> }
  { "cmd": "penup" }
  { "cmd": "pendown" }
  { "cmd": "setheading", "value": <degrees, 0=right 90=up 180=left 270=down> }
  { "cmd": "color", "value": "<hex like #ff0000 or named: black white red green blue yellow orange purple pink brown gray>" }
  { "cmd": "pensize", "value": <number> }
  { "cmd": "beginfill" }
  { "cmd": "endfill" }
  { "cmd": "circle", "value": <radius 1-300> }
  { "cmd": "dot", "value": <diameter> }
  { "cmd": "repeat", "count": <integer 1-50>, "body": [ ...commands ] }
  { "cmd": "home" }
  { "cmd": "clear" }
  { "cmd": "goto", "x": <number -400..400>, "y": <number -300..300> }
  { "cmd": "comment", "value": "<short plain-English description of what the next lines do>" }

Movement rules (IMPORTANT):
- Strongly prefer forward/backward/left/right for all drawing. This is the Logo way.
- Use repeat blocks heavily — repeating forward+turn is the natural Logo idiom for polygons, spirals, stars and patterns.
- Only use goto (with penup/pendown around it) when you genuinely need to jump to a specific starting position, e.g. to place separate shapes. Never use goto to draw lines.
- Use setheading only to set an initial facing direction, not as a substitute for turning.
- Build shapes by walking the turtle: a square is repeat(4, [forward(100), right(90)]), not four goto calls.

Other rules:
- Always start with: { "cmd": "penup" }, { "cmd": "home" }, { "cmd": "pendown" }
- Keep total expanded command count under 500.
- Nest repeat blocks at most 6 levels deep.
- Add comment commands liberally throughout the code to label each logical section (e.g. "draw the body", "draw the roof", "draw the windows"). Place a comment just before each distinct part. Comments help learners understand what each block of code does.
- Return ONLY a raw JSON array — no markdown, no explanation, no code fences.
`;

const rateLimitStore = new Map();

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
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

async function commandsForPrompt(prompt) {
  if (!AI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[AI] AI_API_KEY is not set — falling back to default commands.');
    return { commands: FALLBACK_COMMANDS, aiUsed: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.7,
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

    // Strip optional markdown code fences the model may include despite instructions
    const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();
    const commands = JSON.parse(cleaned);

    if (!Array.isArray(commands)) {
      throw new Error('AI did not return a JSON array.');
    }

    return { commands, aiUsed: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[AI] commandsForPrompt failed:', error.message);
    return { commands: FALLBACK_COMMANDS, aiUsed: false };
  } finally {
    clearTimeout(timer);
  }
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

async function buildProgramFromPrompt(prompt, ageMode = 'kids') {
  const simplified = shouldSimplify(prompt);
  const { commands, aiUsed } = await commandsForPrompt(prompt);

  const program = {
    title: 'AI Turtle Drawing',
    description: simplified ? 'A simpler version of your idea for easy turtle drawing.' : 'A turtle drawing from your prompt.',
    explanation: simplified
      ? 'I made a simpler version so the turtle could draw it clearly. The turtle follows each command to build the picture.'
      : 'The turtle follows each command in order to draw your picture step by step.',
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
    warnings.push('The AI drawing service is unavailable — showing a sample drawing instead.');
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
      aiUsed
    };
  }

  return {
    program: validation.program,
    warnings,
    executionPlan: validation.executionPlan,
    aiUsed
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

function handleGenerate(req, res) {
  readJson(req)
    .then(async (body) => {
      const prompt = clampPrompt(body.prompt);
      if (!prompt) {
        jsonResponse(res, 400, {
          error: 'Please type what you want the turtle to draw.'
        });
        return;
      }

      const { program, warnings, executionPlan, aiUsed } = await buildProgramFromPrompt(prompt, body.ageMode);
      const displayCode = formatProgram(program);

      jsonResponse(res, 200, {
        program,
        displayCode,
        warnings,
        suggestions: getSuggestions(program),
        executionPlan,
        aiUsed,
        transparencyNote: aiUsed
          ? 'The AI turned your words into turtle code. You can check and change its code below.'
          : 'This is a sample drawing. Set AI_API_KEY to enable AI-generated drawings.'
      });
    })
    .catch((error) => {
      jsonResponse(res, 400, { error: error.message || 'Could not read request.' });
    });
}

function handleValidate(req, res) {
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
        });
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
      });
    })
    .catch((error) => {
      jsonResponse(res, 400, { valid: false, errors: [{ message: error.message || 'Invalid request.' }] });
    });
}

function handleExplain(req, res) {
  readJson(req)
    .then((body) => {
      if (typeof body.code === 'string') {
        const parsed = parseDisplayCode(body.code);
        if (!parsed.valid) {
          jsonResponse(res, 200, {
            valid: false,
            errors: parsed.errors
          });
          return;
        }

        jsonResponse(res, 200, {
          valid: true,
          explanation: explainProgram(parsed.program)
        });
        return;
      }

      if (body.program && typeof body.program === 'object') {
        const validation = validateProgram(body.program);
        if (!validation.valid) {
          jsonResponse(res, 200, {
            valid: false,
            errors: validation.errors
          });
          return;
        }

        jsonResponse(res, 200, {
          valid: true,
          explanation: explainProgram(validation.program)
        });
        return;
      }

      jsonResponse(res, 400, {
        valid: false,
        errors: [{ message: 'Please provide code or a program to explain.' }]
      });
    })
    .catch((error) => {
      jsonResponse(res, 400, {
        valid: false,
        errors: [{ message: error.message || 'Could not read request.' }]
      });
    });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const ipAddress = req.socket.remoteAddress || 'unknown';
    if (isRateLimited(ipAddress)) {
      jsonResponse(res, 429, {
        error: 'Too many drawing requests right now. Please try again in a moment.'
      });
      return;
    }

    handleGenerate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/validate') {
    handleValidate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/explain') {
    handleExplain(req, res);
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
  server
};
