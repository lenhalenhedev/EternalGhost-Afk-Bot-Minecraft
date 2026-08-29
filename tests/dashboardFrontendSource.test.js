'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('detail log state merges REST snapshots instead of replacing live SSE entries', () => {
  const source = read('web/src/state/dashboardStore.js');

  assert.match(
    source,
    /mergeLogs\(state\.logsByBot\[botId\] \|\| \[\], logs\)/
  );
  assert.doesNotMatch(
    source,
    /logsByBot: \{ \.\.\.state\.logsByBot, \[botId\]: logs \}/
  );
});

test('mobile log rows use TanStack dynamic measurement and end-following append behavior', () => {
  const source = read('web/src/components/LogPanel.jsx');

  assert.match(source, /anchorTo:\s*'end'/);
  assert.match(source, /followOnAppend:/);
  assert.match(source, /data-index=\{item\.index\}/);
  assert.match(source, /ref=\{virtualizer\.measureElement\}/);
});

test('the app shell owns the only hamburger navigation trigger', () => {
  const appSource = read('web/src/App.jsx');
  const sidebarSource = read('web/src/components/Sidebar.jsx');

  assert.equal((appSource.match(/<Menu\s+size=/g) || []).length, 1);
  assert.doesNotMatch(sidebarSource, /<Menu\s+size=/);
});

test('every dashboard form control has explicit id and name attributes', () => {
  const sources = [
    read('web/src/components/BotForm.jsx'),
    read('web/src/components/CommandBar.jsx'),
    read('web/src/components/LogPanel.jsx'),
    read('web/src/pages/LoginPage.jsx'),
    read('web/src/pages/TokenManagementPage.jsx'),
  ];
  const controls = sources.join('\n');
  const ids = [...controls.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const names = [...controls.matchAll(/name="([^"]+)"/g)].map(
    (match) => match[1]
  );

  assert.ok(ids.length >= 12);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(names.length >= 6);
  assert.ok((controls.match(/register\('/g) || []).length >= 7);
});

test('SSE tab identity has a fallback when crypto.randomUUID is unavailable', () => {
  const source = read('web/src/hooks/useSse.js');
  assert.match(source, /createTabId/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID\?\./);
  assert.match(source, /fallbackTabSequence/);
  assert.doesNotMatch(source, /const tabId = crypto\.randomUUID\(\)/);
});

test('SSE uses one BroadcastChannel leader with heartbeat election and bounded jittered backoff', () => {
  const source = read('web/src/hooks/useSse.js');
  assert.match(source, /BroadcastChannel/);
  assert.match(source, /HEARTBEAT_MS = 1_000/);
  assert.match(source, /LEADER_TIMEOUT_MS = 4_000/);
  assert.match(source, /MAX_BACKOFF_MS = 30_000/);
  assert.match(source, /2 \*\* reconnectAttempt/);
  assert.match(source, /Math\.random\(\)/);
});
test('toast IDs use a standards-compliant UUID v4 fallback without requiring randomUUID', () => {
  const uuidSource = read('web/src/lib/uuid.js');
  const toastSource = read('web/src/state/toastStore.js');
  assert.match(uuidSource, /export function createUuid/);
  assert.match(uuidSource, /getRandomValues/);
  assert.match(uuidSource, /0x40/);
  assert.match(uuidSource, /0x80/);
  assert.match(toastSource, /createUuid\(\)/);
  assert.doesNotMatch(toastSource, /crypto\.randomUUID/);
});

test('UUID fallback produces a standards-compliant UUID v4 without randomUUID', () => {
  const source = read('web/src/lib/uuid.js').replace(
    'export function createUuid',
    'function createUuid'
  );
  const sandbox = {
    Uint8Array,
    Math: { floor: () => 0, random: () => 0 },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(0);
        return bytes;
      },
    },
  };
  vm.runInNewContext(`${source}\nthis.createUuid = createUuid;`, sandbox);

  const uuid = sandbox.createUuid();
  assert.match(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test('UUID helper delegates to native randomUUID when available', () => {
  const source = read('web/src/lib/uuid.js').replace(
    'export function createUuid',
    'function createUuid'
  );
  const nativeUuid = '123e4567-e89b-42d3-a456-426614174000';
  const sandbox = {
    Uint8Array,
    crypto: { randomUUID: () => nativeUuid },
  };
  vm.runInNewContext(`${source}\nthis.createUuid = createUuid;`, sandbox);

  assert.equal(sandbox.createUuid(), nativeUuid);
});

test('frontend exposes acknowledgement session expiry and unified 429 popup handling', () => {
  const app = read('web/src/App.jsx');
  const api = read('web/src/lib/api.js');
  const toast = read('web/src/components/Toast.jsx');
  assert.match(app, /app:session-expired/);
  assert.match(app, /Session expired/);
  assert.match(api, /app:rate-limited/);
  assert.match(api, /retry-after/);
  assert.match(toast, /remainingSeconds/);
});

test('the frontend defines a dark root palette and log-specific dark colors', () => {
  const styles = read('web/src/styles.css');
  const tokens = read('web/tailwind.config.js');

  assert.match(styles, /color-scheme:\s*dark/);
  assert.match(tokens, /'log-bg':/);
  assert.match(tokens, /canvas:\s*'#0F1115'/);
});

test('all page layouts render the shared natural-flow copyright footer', () => {
  const footerSource = read('web/src/components/Footer.jsx');
  const appSource = read('web/src/App.jsx');
  const loginSource = read('web/src/pages/LoginPage.jsx');

  assert.match(footerSource, /Copyright © 2026 lenhalenhedev/);
  assert.match(appSource, /<Footer\s*\/>/);
  assert.match(loginSource, /<Footer\s*\/>/);
  assert.doesNotMatch(footerSource, /fixed|sticky/);
});
