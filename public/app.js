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
const PROJECT_DRAFT_KEY = 'turtlelab.project';
const PROJECT_HISTORY_KEY = 'turtlelab.projects';
const MAX_SAVED_PROJECTS = 20;
const SPLASH_DISPLAY_DURATION_MS = 2600;

const promptModal = document.querySelector('#prompt-modal');
const splashModal = document.querySelector('#splash-modal');
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
const aiOverview = document.querySelector('#ai-overview');
const reviewHint = document.querySelector('#review-hint');
const warningsList = document.querySelector('#warnings-list');
const suggestionsList = document.querySelector('#suggestions-list');
const savedProjects = document.querySelector('#saved-projects');

const ctx = canvas.getContext('2d');

const state = {
  aiCode: '',
  currentCode: '',
  currentProgram: null,
  currentPlan: [],
  animationTimer: null,
  isGenerating: false
};

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
}

function setSuggestions(suggestions) {
  suggestionsList.innerHTML = '';
  for (const suggestion of suggestions || []) {
    const item = document.createElement('li');
    item.textContent = suggestion;
    suggestionsList.append(item);
  }
}

function applySavedProject(project) {
  promptInput.value = project.prompt || '';
  codeEditor.value = project.code || '';
  state.aiCode = project.aiCode || project.code || '';
  aiOverview.textContent = project.aiOverview || '';
  transparencyNote.textContent = project.transparencyNote || '';
  reviewHint.textContent = project.reviewHint || 'Suggest → Review → Edit: let the AI guess, then fix the code.';
  setWarnings(project.warnings || []);
  setSuggestions(project.suggestions || []);
  syncHighlight();
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

function showSplashThenPrompt() {
  const finishSplash = () => {
    if (typeof splashModal.close === 'function') {
      splashModal.close();
    } else {
      splashModal.removeAttribute('open');
    }
    openPromptModal();
  };

  if (typeof splashModal.showModal === 'function') {
    splashModal.showModal();
  } else {
    splashModal.setAttribute('open', 'open');
  }

  setTimeout(finishSplash, SPLASH_DISPLAY_DURATION_MS);
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

async function generateFromPrompt(event) {
  event.preventDefault();
  if (state.isGenerating) {
    return;
  }

  codeError.textContent = '';
  setGeneratingUi(true);

  try {
    if (isHappyRobotPrompt(promptInput.value)) {
      state.aiCode = HAPPY_ROBOT_CODE;
      codeEditor.value = HAPPY_ROBOT_CODE;
      syncHighlight();

      aiOverview.textContent = 'Built-in example: happy robot.';
      transparencyNote.textContent = 'This result uses a local hardcoded example and bypasses AI generation.';
      reviewHint.textContent = 'Suggest → Review → Edit: let the AI guess, then fix the code.';
      setWarnings([]);
      setSuggestions([]);

      await runEditedCode();
      closePromptModal();
      return;
    }

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

    aiOverview.textContent = payload.aiOverview || payload.program.explanation || '';
    transparencyNote.textContent = payload.transparencyNote || '';
    reviewHint.textContent = payload.workflowHint || 'Suggest → Review → Edit: let the AI guess, then fix the code.';
    setWarnings(payload.warnings || []);
    setSuggestions(payload.suggestions || []);

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveDraftProject();
    closePromptModal();
  } catch (error) {
    codeError.textContent = error.message;
  } finally {
    setGeneratingUi(false);
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
    aiOverview.textContent = payload.program.explanation;

    renderProgram(payload.program, state.currentPlan, animateToggle.checked);
    saveDraftProject();
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

setupPromptChips();
loadDraftProject();
renderSavedProjects();
syncHighlight();
clearCanvas();
showSplashThenPrompt();
