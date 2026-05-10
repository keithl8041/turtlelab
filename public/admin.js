const loginForm = document.querySelector('#admin-login-form');
const passwordInput = document.querySelector('#admin-password');
const statusEl = document.querySelector('#admin-status');
const entryList = document.querySelector('#admin-entry-list');
const refreshButton = document.querySelector('#admin-refresh-button');

const state = {
  password: ''
};

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  if (!items.length) {
    entryList.innerHTML = '<p class="panel-subtitle">No submissions yet.</p>';
    return;
  }

  for (const item of items) {
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
  try {
    await setDecision(id, action);
    statusEl.textContent = `Submission ${id} ${action}ed.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
