const EXAMPLE_PROMPTS = [
  'draw a happy robot',
  'draw a house and a tree',
  'draw a star inside a circle'
];
const MIN_SPEED = 1;
const MAX_SPEED = 10;
const DEFAULT_SPEED = 4;

const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt-input');
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
const codeError = document.querySelector('#code-error');

const explanationText = document.querySelector('#explanation-text');
const transparencyNote = document.querySelector('#transparency-note');
const warningsList = document.querySelector('#warnings-list');
const suggestionsList = document.querySelector('#suggestions-list');

const ctx = canvas.getContext('2d');

const state = {
  aiCode: '',
  currentCode: '',
  currentProgram: null,
  currentPlan: [],
  animationTimer: null
};

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
      return `<br /><span class="code-comment">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }).join('\n');
  codeHighlight.innerHTML = html;
}

codeEditor.addEventListener('input', syncHighlight);
codeEditor.addEventListener('scroll', () => {
  codeHighlight.scrollTop = codeEditor.scrollTop;
});

function saveProject() {
  const project = {
    prompt: promptInput.value,
    code: codeEditor.value,
    explanation: explanationText.textContent,
    transparencyNote: transparencyNote.textContent,
    warnings: Array.from(warningsList.children).map((item) => item.textContent),
    suggestions: Array.from(suggestionsList.children).map((item) => item.textContent)
  };

  localStorage.setItem('turtlelab.project', JSON.stringify(project));
}

function loadProject() {
  const raw = localStorage.getItem('turtlelab.project');
  if (!raw) {
    return;
  }

  try {
    const project = JSON.parse(raw);
    promptInput.value = project.prompt || '';
    codeEditor.value = project.code || '';
    state.aiCode = project.code || '';
    syncHighlight();
    explanationText.textContent = project.explanation || explanationText.textContent;
    transparencyNote.textContent = project.transparencyNote || '';

    warningsList.innerHTML = '';
    for (const warning of project.warnings || []) {
      const item = document.createElement('li');
      item.textContent = warning;
      warningsList.append(item);
    }

    suggestionsList.innerHTML = '';
    for (const suggestion of project.suggestions || []) {
      const item = document.createElement('li');
      item.textContent = suggestion;
      suggestionsList.append(item);
    }
  } catch {
    localStorage.removeItem('turtlelab.project');
  }
}

function clearCanvas() {
  stopAnimation();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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

  const lines = codeEditor.value.split('\n');
  let start = 0;
  for (let i = 0; i < lineNumber - 1 && i < lines.length; i += 1) {
    start += lines[i].length + 1;
  }
  const end = start + (lines[lineNumber - 1] || '').length;
  codeEditor.focus();
  codeEditor.setSelectionRange(start, end);
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
    return;
  }

  let index = 0;
  const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(program.settings?.speed) || DEFAULT_SPEED));
  const delay = Math.max(20, 220 - speed * 20);

  const step = () => {
    const command = executionPlan[index];
    if (!command) {
      return;
    }

    runSingleCommand(command, turtle);
    highlightLine(command.line);
    index += 1;
    state.animationTimer = setTimeout(step, delay);
  };

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
      } else {
        result.push(item);
      }
    }
  };

  walk(commands || []);
  return result;
}

function setWarnings(warnings) {
  warningsList.innerHTML = '';
  for (const warning of warnings || []) {
    const item = document.createElement('li');
    item.textContent = warning;
    warningsList.append(item);
  }
}

function setSuggestions(suggestions) {
  suggestionsList.innerHTML = '';
  for (const suggestion of suggestions || []) {
    const item = document.createElement('li');
    item.textContent = suggestion;
    suggestionsList.append(item);
  }
}

async function generateFromPrompt(event) {
  event.preventDefault();

  codeError.textContent = '';
  loadingText.textContent = 'AI is writing turtle code...';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptInput.value,
        ageMode: 'kids',
        difficulty: 'easy'
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'The AI got a bit muddled. Try a simpler prompt.');
    }

    state.currentProgram = payload.program;
    state.currentPlan = payload.executionPlan || flattenCommands(payload.program.commands);
    state.aiCode = payload.displayCode;
    codeEditor.value = payload.displayCode;
    syncHighlight();

    explanationText.textContent = payload.program.explanation;
    transparencyNote.textContent = payload.transparencyNote || '';
    setWarnings(payload.warnings || []);
    setSuggestions(payload.suggestions || []);

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveProject();
  } catch (error) {
    codeError.textContent = error.message;
  } finally {
    loadingText.textContent = '';
  }
}

async function runEditedCode() {
  codeError.textContent = '';

  try {
    const response = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeEditor.value })
    });

    const payload = await response.json();

    if (!payload.valid) {
      const firstError = payload.errors?.[0];
      const prefix = firstError?.line ? `Line ${firstError.line}: ` : '';
      throw new Error(`${prefix}${firstError?.message || 'That code has a small mistake.'}`);
    }

    state.currentProgram = payload.program;
    state.currentPlan = payload.executionPlan || flattenCommands(payload.program.commands);
    state.currentCode = codeEditor.value;
    explanationText.textContent = payload.program.explanation;

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveProject();
  } catch (error) {
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

promptForm.addEventListener('submit', generateFromPrompt);
runButton.addEventListener('click', runEditedCode);
restoreButton.addEventListener('click', restoreAiCode);
copyButton.addEventListener('click', copyCode);
replayButton.addEventListener('click', () => {
  if (state.currentProgram) {
    renderProgram(state.currentProgram, state.currentPlan, animateToggle.checked);
  }
});
clearButton.addEventListener('click', clearCanvas);

setupPromptChips();
loadProject();
clearCanvas();
