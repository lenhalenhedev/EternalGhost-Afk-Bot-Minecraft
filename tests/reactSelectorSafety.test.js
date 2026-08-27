const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webSrc = path.resolve(__dirname, '../web/src');
const read = (relativePath) =>
  fs.readFileSync(path.join(webSrc, relativePath), 'utf8');

test('derived bot selectors use shallow equality', () => {
  const sidebar = read('components/Sidebar.jsx');
  const dashboard = read('pages/DashboardPage.jsx');
  assert.match(
    sidebar,
    /useShallow\(\(state\) => Object\.values\(state\.bots\)\)/s
  );
  assert.match(
    dashboard,
    /useShallow\(\(state\) => Object\.values\(state\.bots\)\)/s
  );
});

test('empty log selector returns a stable shared snapshot', () => {
  const logPanel = read('components/LogPanel.jsx');
  assert.match(logPanel, /const EMPTY_LOGS = Object\.freeze\(\[\]\);/);
  assert.match(logPanel, /state\.logsByBot\[botId\] \|\| EMPTY_LOGS/);
  assert.doesNotMatch(logPanel, /state\.logsByBot\[botId\] \|\| \[\]/);
});

test('dashboard shell has no third-party ad or iframe resources', () => {
  const html = fs.readFileSync(path.join(webSrc, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /<iframe\b|googletag|doubleclick|adsense/i);
});
