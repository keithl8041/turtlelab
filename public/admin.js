const loginForm = document.querySelector('#admin-login-form');
const passwordInput = document.querySelector('#admin-password');
const statusEl = document.querySelector('#admin-status');
const entryList = document.querySelector('#admin-entry-list');
const refreshButton = document.querySelector('#admin-refresh-button');
const previewModal = document.querySelector('#admin-preview-modal');
const previewMeta = document.querySelector('#admin-preview-meta');
const previewStatus = document.querySelector('#admin-preview-status');
const previewCanvas = document.querySelector('#admin-preview-canvas');
const previewCtx = previewCanvas?.getContext('2d');

const state = {
  password: '',
  entriesById: new Map()
};

function toCanvasX(x) {
  return previewCanvas.width / 2 + x;
}

function toCanvasY(y) {
  return previewCanvas.height / 2 - y;
}

function clearPreviewCanvas(background = '#ffffff') {
  if (!previewCtx) {
    return;
  }
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.fillStyle = background;
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
}

function runPreviewCommand(command, turtle) {
  if (!previewCtx || !command || !command.cmd) {
    return;
  }

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
      const nextX = Number(command.x) || 0;
      const nextY = Number(command.y) || 0;
      if (turtle.penDown) {
        previewCtx.beginPath();
        previewCtx.strokeStyle = turtle.strokeColor;
        previewCtx.lineWidth = turtle.penSize;
        previewCtx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
        previewCtx.lineTo(toCanvasX(nextX), toCanvasY(nextY));
        previewCtx.stroke();
      }
      turtle.x = nextX;
      turtle.y = nextY;
      break;
    }
    case 'forward':
    case 'backward': {
      const multiplier = command.cmd === 'forward' ? 1 : -1;
      const radians = (Math.PI / 180) * turtle.heading;
      const distance = Number(command.value) || 0;
      const nextX = turtle.x + Math.cos(radians) * distance * multiplier;
      const nextY = turtle.y + Math.sin(radians) * distance * multiplier;
      if (turtle.penDown) {
        previewCtx.beginPath();
        previewCtx.strokeStyle = turtle.strokeColor;
        previewCtx.lineWidth = turtle.penSize;
        previewCtx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
        previewCtx.lineTo(toCanvasX(nextX), toCanvasY(nextY));
        previewCtx.stroke();
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
      turtle.penSize = Math.max(1, Number(command.value) || 1);
      break;
    case 'circle':
      previewCtx.beginPath();
      previewCtx.strokeStyle = turtle.strokeColor;
      previewCtx.lineWidth = turtle.penSize;
      previewCtx.arc(toCanvasX(turtle.x), toCanvasY(turtle.y), Math.abs(Number(command.value) || 0), 0, Math.PI * 2);
      previewCtx.stroke();
      break;
    case 'dot':
      previewCtx.beginPath();
      previewCtx.fillStyle = turtle.fillColor;
      previewCtx.arc(toCanvasX(turtle.x), toCanvasY(turtle.y), Math.abs(Number(command.value) || 0) / 2, 0, Math.PI * 2);
      previewCtx.fill();
      break;
    case 'beginfill':
      turtle.fillMode = true;
      previewCtx.beginPath();
      previewCtx.moveTo(toCanvasX(turtle.x), toCanvasY(turtle.y));
      break;
    case 'endfill':
      if (turtle.fillMode) {
        previewCtx.closePath();
        previewCtx.fillStyle = turtle.fillColor;
        previewCtx.fill();
      }
      turtle.fillMode = false;
      break;
    case 'home':
      turtle.x = 0;
      turtle.y = 0;
      turtle.heading = 0;
      break;
    case 'clear':
      clearPreviewCanvas(turtle.background || '#ffffff');
      break;
    default:
      break;
  }
}

function renderPreview(program, executionPlan) {
  clearPreviewCanvas(program?.settings?.background || '#ffffff');

  const turtle = {
    x: 0,
    y: 0,
    heading: 0,
    penDown: true,
    strokeColor: '#111111',
    fillColor: '#111111',
    penSize: 2,
    fillMode: false,
    background: program?.settings?.background || '#ffffff'
  };

  for (const command of executionPlan || []) {
    runPreviewCommand(command, turtle);
  }
}

async function showPreviewForEntry(entry) {
  if (!entry || !entry.code) {
    statusEl.textContent = 'This submission has no code to preview.';
    return;
  }

  previewMeta.textContent = `${entry.title || 'Submission'} · ${entry.id || ''}`;
  previewStatus.textContent = 'Rendering final preview...';
  clearPreviewCanvas('#ffffff');
  previewModal.showModal();

  try {
    const payload = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: entry.code })
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Could not validate code for preview.');
      }
      return body;
    });

    if (!payload.valid) {
      const firstError = Array.isArray(payload.errors) && payload.errors.length
        ? payload.errors[0]
        : { message: 'Could not render this submission.' };
      throw new Error(firstError.message || 'Could not render this submission.');
    }

    renderPreview(payload.program, payload.executionPlan || []);
    previewStatus.textContent = 'Showing final drawing state (no animation).';
  } catch (error) {
    previewStatus.textContent = error.message || 'Could not render this submission.';
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function adminFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Password': state.password
    }
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function renderEntries(items = []) {
  entryList.innerHTML = '';
  state.entriesById.clear();
  if (!items.length) {
    entryList.innerHTML = '<p class="panel-subtitle">No submissions yet.</p>';
    return;
  }

  for (const item of items) {
    state.entriesById.set(String(item.id || ''), item);
    const card = document.createElement('article');
    card.className = 'admin-entry';
    const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.join(', ') : 'none';
    card.innerHTML = `
      <h3>${escapeHtml(item.title || 'Submission')}</h3>
      <p><strong>Status:</strong> ${escapeHtml(item.status || 'pending')}</p>
      <p><strong>ID:</strong> ${escapeHtml(item.id || '')}</p>
      <p><strong>Name:</strong> ${escapeHtml(item.name || '')}</p>
      <p><strong>Email:</strong> ${escapeHtml(item.email || '')}</p>
      <p><strong>Prompt:</strong> ${escapeHtml(item.prompt || '')}</p>
      <p><strong>Description:</strong> ${escapeHtml(item.description || '')}</p>
      <p><strong>Tags:</strong> ${escapeHtml(tags)}</p>
      <details>
        <summary>Code</summary>
        <pre>${escapeHtml(item.code || '')}</pre>
      </details>
      <div class="button-row">
        <button type="button" data-action="play" data-id="${escapeHtml(item.id || '')}">Play</button>
        <button type="button" data-action="accept" data-id="${escapeHtml(item.id || '')}">Accept</button>
        <button type="button" data-action="reject" data-id="${escapeHtml(item.id || '')}" class="secondary-button">Reject</button>
      </div>
    `;
    entryList.append(card);
  }
}

async function refreshEntries() {
  const payload = await adminFetch('/api/admin/submissions');
  renderEntries(payload.items || []);
}

async function setDecision(id, decision) {
  await adminFetch(`/api/admin/submissions/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision })
  });
  await refreshEntries();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.password = passwordInput.value;
  try {
    await refreshEntries();
    statusEl.textContent = 'Loaded submissions.';
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

refreshButton.addEventListener('click', async () => {
  try {
    await refreshEntries();
    statusEl.textContent = 'Refreshed.';
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

entryList.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const id = target.getAttribute('data-id');
  const action = target.getAttribute('data-action');
  if (!id || !action) {
    return;
  }
  if (action === 'play') {
    const entry = state.entriesById.get(id);
    await showPreviewForEntry(entry);
    return;
  }
  try {
    await setDecision(id, action);
    statusEl.textContent = action === 'reject'
      ? `Submission ${id} deleted.`
      : `Submission ${id} accepted.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
