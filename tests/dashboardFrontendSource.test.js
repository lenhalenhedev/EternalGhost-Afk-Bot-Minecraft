'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
