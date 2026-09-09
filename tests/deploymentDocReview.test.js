'use strict';

/**
 * EG-013 regression tests: the deployment guide must not present a plaintext
 * edge-to-origin hop as a recommended configuration for a session-bearing
 * administration surface.
 *
 * The guide previously labelled Cloudflare **Flexible** a "short-term setup"
 * while stating that the Cloudflare-to-origin hop stays HTTP. These tests are
 * static documentation assertions -- no Cloudflare account, DNS record, origin
 * or public URL is contacted, and no container is built.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.join(
  __dirname,
  '..',
  'docs',
  'cloudflare-reverse-proxy.md'
);
const doc = fs.readFileSync(docPath, 'utf8');

/** Collapse wrapping and drop markdown emphasis so assertions read like prose. */
function normalise(text) {
  return text.replace(/\*{1,3}/g, '').replace(/\s+/g, ' ');
}

/** Headings in document order. */
function headings() {
  return doc
    .split('\n')
    .filter((line) => /^#{2,3}\s/.test(line))
    .map((line) => line.replace(/^#{2,3}\s+/, '').trim());
}

/** Body of a top-level section, from its heading to the next heading. */
function section(headingPrefix) {
  const lines = doc.split('\n');
  const start = lines.findIndex(
    (line) =>
      /^##\s/.test(line) && line.slice(3).trim().startsWith(headingPrefix)
  );
  assert.ok(start >= 0, `the guide must contain a "${headingPrefix}" section`);
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s/.test(line)
  );
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

test('EG-013: Flexible is no longer presented as a recommended short-term setup', () => {
  const heads = headings();
  for (const heading of heads) {
    assert.ok(
      !/recommended/i.test(heading) || !/flexible/i.test(heading),
      `a Flexible configuration must not be described as recommended: ${heading}`
    );
  }
  assert.ok(
    !/short-term setup is/i.test(normalise(doc)),
    'the guide must not offer Flexible as the short-term setup'
  );
  const flexibleSection = section('Emergency exception');
  assert.match(flexibleSection, /non-production only/i);
  assert.match(
    normalise(flexibleSection),
    /not a supported production configuration/i,
    'the exception must state it is unsupported in production'
  );
  assert.match(
    flexibleSection,
    /fully trusted and isolated/i,
    'the exception must require an isolated trusted origin network'
  );
  assert.match(
    flexibleSection,
    /dated migration plan/i,
    'the exception must require a dated migration plan'
  );
});

test('EG-013: Full (strict) is the only recommended public deployment path', () => {
  const recommended = section('The only recommended public deployment path');
  assert.match(recommended, /Full \(strict\)/);
  assert.match(
    recommended,
    /only supported configuration for a public deployment/i,
    'the guide must name Full (strict) as the sole supported public path'
  );
  assert.match(
    normalise(recommended),
    /cannot compensate for a plaintext origin hop/i,
    'the guide must state WEB_HTTPS does not add TLS'
  );
  assert.match(recommended, /WEB_HTTPS=true/);
  assert.match(recommended, /Always Use HTTPS/);

  const target = section('Long-term setup');
  assert.match(target, /Full \(strict\)/);
});

test('EG-013: the compatibility matrix marks plaintext-origin modes as non-production', () => {
  const tableRows = doc
    .split('\n')
    .filter(
      (line) => line.startsWith('|') && line.includes('dashboard.example.com')
    );
  assert.ok(tableRows.length >= 3, 'the compatibility matrix must be present');

  for (const row of tableRows) {
    const cells = row.split('|').map((cell) => cell.trim());
    const originCell = cells.find((cell) => /HTTP `:15029`/.test(cell));
    if (!originCell) continue; // HTTPS-origin rows are the supported case
    assert.match(
      row,
      /No —/,
      `a plaintext-origin row must be marked as not for production: ${row}`
    );
  }

  const supported = tableRows.filter((row) => /valid certificate/.test(row));
  assert.equal(
    supported.length,
    1,
    'exactly one row describes the supported path'
  );
  assert.match(supported[0], /Yes — the only supported public configuration/);
  assert.match(supported[0], /Full \(strict\)/);
});

test('EG-013: a pre-publication checklist gates public exposure', () => {
  const checklist = section('Pre-publication checklist');
  const items = checklist
    .split('\n')
    .filter((line) => line.startsWith('- [ ]'));
  assert.ok(
    items.length >= 7,
    `the checklist must be actionable (found ${items.length})`
  );
  const joined = items.join('\n');
  for (const required of [
    'Full (strict)',
    'Always Use HTTPS',
    'WEB_HTTPS=true',
    'WEB_PUBLIC_ORIGIN',
    'WEB_TRUST_PROXY',
  ]) {
    assert.match(
      joined,
      new RegExp(required.replace(/[()]/g, '\\$&')),
      `checklist must cover ${required}`
    );
  }
  assert.match(
    joined,
    /not published to the Internet/i,
    'the checklist must require the origin port to stay unpublished'
  );
});

test('EG-013: the security deployment notes agree with the Cloudflare guide', () => {
  const deployment = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'security-deployment.md'),
    'utf8'
  );
  assert.match(
    deployment,
    /Never expose a plain HTTP origin containing dashboard sessions directly to the Internet/i,
    'the deployment notes must forbid a public plaintext origin'
  );
  assert.match(
    deployment,
    /keep the Node origin private/i,
    'the deployment notes must require a private origin'
  );
});
