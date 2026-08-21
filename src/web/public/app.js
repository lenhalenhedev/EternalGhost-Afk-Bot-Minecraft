'use strict';
/* global document, location, window */

const state = {
  csrfToken: '',
  bots: [],
  selectedId: '',
  editingId: '',
};

const byId = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setVisible(id, visible) {
  byId(id)?.classList.toggle('hidden', !visible);
}

function showMessage(message, isError = false) {
  const target = byId('global-message');
  if (!target) return;
  target.textContent = message || '';
  target.style.color = isError ? 'var(--red)' : 'var(--green)';
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const request = { ...options, method, headers, credentials: 'same-origin' };
  if (state.csrfToken && ['POST', 'PATCH', 'DELETE'].includes(method))
    headers['X-CSRF-Token'] = state.csrfToken;
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, request);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json')
    ? await response.json()
    : await response.text();
  if (response.status === 401) {
    state.csrfToken = '';
    if (location.pathname === '/admin') showLogin();
  }
  if (!response.ok)
    throw new Error(payload?.error?.message || 'Request failed');
  return payload;
}

function showLogin() {
  setVisible('login-panel', true);
  setVisible('dashboard-panel', false);
}

function showDashboard() {
  setVisible('login-panel', false);
  setVisible('dashboard-panel', true);
}

function renderStats(stats) {
  const grid = byId('stats-grid');
  if (!grid) return;
  grid.replaceChildren();
  const entries = [
    ['Total bots', stats.totalBots ?? 0],
    ['Alive', stats.aliveBots ?? 0],
    ['Process uptime', formatDuration((stats.uptime || 0) * 1000)],
    ['Heap used', formatBytes(stats.memHeapUsed || 0)],
  ];
  for (const [label, value] of entries) {
    const card = element('div', 'stat-card');
    card.append(
      element('span', '', label),
      element('strong', '', String(value))
    );
    grid.append(card);
  }
}

function renderBotList() {
  const list = byId('bot-list');
  if (!list) return;
  list.replaceChildren();
  if (state.bots.length === 0) {
    list.append(element('div', 'empty-state', 'No bots registered yet.'));
    return;
  }
  for (const bot of state.bots) {
    const row = element(
      'div',
      `bot-row${state.selectedId === bot.id ? ' active' : ''}`
    );
    const main = element('div', 'bot-main');
    main.append(
      element('div', 'bot-name', `${bot.username} / ${bot.version}`),
      element('div', 'bot-address', `${bot.host}:${bot.port}`)
    );
    const stateBadge = element(
      'span',
      `bot-state${['OFFLINE', 'ERROR'].includes(bot.state) ? ' offline' : ''}`,
      bot.state
    );
    const actions = element('div', 'bot-actions');
    actions.append(
      actionButton('Open', 'select', bot.id),
      actionButton('Edit', 'edit', bot.id),
      actionButton('Select', 'select-default', bot.id)
    );
    main.append(actions);
    row.append(main, stateBadge);
    list.append(row);
  }
}

function actionButton(label, action, id) {
  const button = element('button', 'button button-quiet', label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderSelected(bot) {
  const target = byId('selected-bot-status');
  const label = byId('selected-bot-label');
  if (!bot) {
    label.textContent = 'No selection';
    target.className = 'selected-status empty-state';
    target.textContent =
      'Choose a bot to expose lifecycle and telemetry controls.';
    return;
  }
  label.textContent = `${bot.username} / ${bot.id.slice(0, 8)}`;
  target.className = 'selected-status';
  target.replaceChildren();
  const metrics = element('div', 'status-metrics');
  const values = [
    ['State', bot.state],
    ['Health', `${bot.health}/20`],
    ['Food', `${bot.food}/20`],
    ['Ping', `${bot.ping} ms`],
    ['Uptime', formatDuration(bot.uptime)],
  ];
  for (const [name, value] of values) {
    const metric = element('div', 'status-metric');
    metric.append(
      element('span', '', name),
      element('strong', '', String(value))
    );
    metrics.append(metric);
  }
  target.append(metrics);
}

function fillEditor(bot = null) {
  state.editingId = bot?.id || '';
  const form = byId('bot-form');
  form.reset();
  form.elements.id.value = bot?.id || '';
  form.elements.host.value = bot?.host || '';
  form.elements.port.value = bot?.port || '';
  form.elements.username.value = bot?.username || '';
  form.elements.version.value = bot?.version || '';
  form.elements.autoReconnect.checked = bot?.autoReconnect ?? true;
  form.elements.username.disabled = Boolean(bot);
  byId('editor-title').textContent = bot ? 'Edit bot' : 'Create bot';
  byId('form-error').textContent = '';
}

async function refresh() {
  const [botsPayload, stats] = await Promise.all([
    api('/api/bots'),
    api('/api/stats'),
  ]);
  state.bots = botsPayload.bots || [];
  renderStats(stats);
  renderBotList();
  const selected =
    state.bots.find((bot) => bot.id === state.selectedId) || state.bots[0];
  if (selected) {
    state.selectedId = selected.id;
    renderSelected(selected);
  } else renderSelected(null);
}

async function selectBot(id, persist = false) {
  state.selectedId = id;
  const bot = state.bots.find((candidate) => candidate.id === id);
  renderBotList();
  renderSelected(bot);
  if (persist)
    await api(`/api/bots/${encodeURIComponent(id)}/select`, { method: 'POST' });
}

async function handleBotAction(action, id) {
  if (action === 'select') return selectBot(id);
  if (action === 'edit') {
    const bot = state.bots.find((candidate) => candidate.id === id);
    if (bot) fillEditor(bot);
    return selectBot(id);
  }
  if (action === 'select-default') return selectBot(id, true);
  if (
    action === 'delete' &&
    !window.confirm('Delete this bot and its active instance?')
  )
    return;
  const path =
    action === 'delete'
      ? `/api/bots/${encodeURIComponent(id)}`
      : `/api/bots/${encodeURIComponent(id)}/${action === 'force-stop' ? 'stop' : action}`;
  const options = { method: action === 'delete' ? 'DELETE' : 'POST' };
  if (action === 'stop' || action === 'force-stop')
    options.body = { force: action === 'force-stop' };
  await api(path, options);
  showMessage(`${action} completed.`);
  await refresh();
}

async function loadDetails(kind) {
  if (!state.selectedId) return;
  const output = byId(`${kind}-output`);
  output.textContent = 'Loading…';
  try {
    const payload = await api(
      `/api/bots/${encodeURIComponent(state.selectedId)}/${kind}`
    );
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return `${hours}h ${minutes}m ${remaining}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function setupAdmin() {
  try {
    const session = await api('/api/auth/session');
    if (!session.authenticated) return showLogin();
    state.csrfToken = session.csrfToken;
    showDashboard();
    await refresh();
  } catch (error) {
    showLogin();
    byId('login-error').textContent = error.message;
  }
}

function bindAdminEvents() {
  byId('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = byId('login-error');
    error.textContent = '';
    try {
      const session = await api('/api/auth/login', {
        method: 'POST',
        body: {
          username: form.get('username'),
          password: form.get('password'),
        },
      });
      state.csrfToken = session.csrfToken;
      event.currentTarget.reset();
      showDashboard();
      await refresh();
    } catch (loginError) {
      error.textContent = loginError.message;
    }
  });

  byId('logout-button')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.csrfToken = '';
    showLogin();
  });
  byId('refresh-button')?.addEventListener('click', () =>
    refresh().catch((error) => showMessage(error.message, true))
  );
  byId('new-bot-button')?.addEventListener('click', () => fillEditor());
  byId('clear-editor-button')?.addEventListener('click', () => fillEditor());
  byId('logs-button')?.addEventListener('click', () => loadDetails('logs'));
  byId('activity-button')?.addEventListener('click', () =>
    loadDetails('activity')
  );
  byId('chat-button')?.addEventListener('click', async () => {
    if (!state.selectedId) return showMessage('Select a bot first.', true);
    const input = byId('chat-input');
    try {
      await api(`/api/bots/${encodeURIComponent(state.selectedId)}/chat`, {
        method: 'POST',
        body: { message: input.value },
      });
      input.value = '';
      showMessage('Chat sent.');
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  byId('bot-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    handleBotAction(button.dataset.action, button.dataset.id).catch((error) =>
      showMessage(error.message, true)
    );
  });
  document.querySelectorAll('.operation-controls button').forEach((button) =>
    button.addEventListener('click', () => {
      if (!state.selectedId) return showMessage('Select a bot first.', true);
      handleBotAction(button.dataset.action, state.selectedId).catch((error) =>
        showMessage(error.message, true)
      );
    })
  );
  byId('bot-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      host: form.get('host'),
      port: Number(form.get('port')),
      version: form.get('version'),
      autoReconnect: form.get('autoReconnect') === 'on',
    };
    if (!state.editingId)
      Object.assign(payload, {
        username: form.get('username'),
        password: form.get('password') || '',
      });
    else if (form.get('password')) payload.password = form.get('password');
    try {
      const path = state.editingId
        ? `/api/bots/${encodeURIComponent(state.editingId)}`
        : '/api/bots';
      await api(path, {
        method: state.editingId ? 'PATCH' : 'POST',
        body: payload,
      });
      showMessage(state.editingId ? 'Bot updated.' : 'Bot created.');
      fillEditor();
      await refresh();
    } catch (error) {
      byId('form-error').textContent = error.message;
    }
  });
}

async function setupStatus() {
  const output = byId('status-output');
  try {
    output.textContent = JSON.stringify(await api('/api/status'), null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

function init() {
  const path = location.pathname;
  if (path === '/status') {
    setVisible('home-view', false);
    setVisible('status-view', true);
    setVisible('admin-view', false);
    return setupStatus();
  }
  if (path === '/admin') {
    setVisible('home-view', false);
    setVisible('status-view', false);
    setVisible('admin-view', true);
    bindAdminEvents();
    return setupAdmin();
  }
  setVisible('home-view', true);
  setVisible('status-view', false);
  setVisible('admin-view', false);
}

document.addEventListener('DOMContentLoaded', init);
