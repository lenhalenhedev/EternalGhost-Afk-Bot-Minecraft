'use strict';

/**
 * EG-012 regression tests: the production image must contain only the runtime
 * artefacts, and the runtime COPY allowlist must be complete.
 *
 * The runtime stage used `COPY . .`, which shipped developer material (the
 * security audit report, browser-verification notes, probe helpers, the
 * Dockerfile itself) and any locally dropped credential file into the image,
 * and overwrote the freshly built web/dist with whatever the host had.
 *
 * Docker is not available in this environment, so these tests verify the
 * build definition statically and by walking the module graph from the real
 * entrypoint. They do not build or run a container.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const dockerignore = fs
  .readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

/** Split a Dockerfile into its build stages with their instructions. */
function parseStages(source) {
  const stages = [];
  let current = null;
  let continuation = '';
  for (const rawLine of source.split('\n')) {
    const trimmed = rawLine.trim();
    if (continuation) {
      if (trimmed.endsWith('\\')) {
        continuation += ` ${trimmed.slice(0, -1)}`;
        continue;
      }
      const merged = `${continuation} ${trimmed}`.trim();
      continuation = '';
      if (current) current.instructions.push(merged);
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.endsWith('\\')) {
      continuation = trimmed.slice(0, -1);
      continue;
    }
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(trimmed);
    if (from) {
      current = {
        image: from[1],
        name: (from[2] || '').toLowerCase(),
        instructions: [],
      };
      stages.push(current);
      continue;
    }
    if (current) current.instructions.push(trimmed);
  }
  assert.ok(stages.length >= 3, 'the Dockerfile must define its build stages');
  return stages;
}

/** Parse COPY instructions into { from, sources, dest }. */
function parseCopies(stage) {
  return stage.instructions
    .filter((instruction) => /^COPY\b/i.test(instruction))
    .map((instruction) => {
      const tokens = instruction.split(/\s+/).slice(1);
      const flags = tokens.filter((token) => token.startsWith('--'));
      const paths = tokens.filter((token) => !token.startsWith('--'));
      const fromFlag = flags.find((flag) => /^--from=/i.test(flag));
      return {
        raw: instruction,
        from: fromFlag ? fromFlag.replace(/^--from=/i, '') : null,
        sources: paths.slice(0, -1),
        dest: paths[paths.length - 1],
      };
    });
}

const stages = parseStages(dockerfile);
const runtimeStage = stages[stages.length - 1];
const runtimeCopies = parseCopies(runtimeStage);
const contextCopies = runtimeCopies.filter((copy) => copy.from === null);

test('EG-012: the runtime stage never copies the whole build context', () => {
  assert.equal(
    runtimeStage.name,
    'runtime',
    'the last stage is the runtime image'
  );
  for (const copy of contextCopies) {
    for (const source of copy.sources) {
      assert.notEqual(source, '.', `whole-context copy found: ${copy.raw}`);
      assert.notEqual(source, './', `whole-context copy found: ${copy.raw}`);
      assert.notEqual(
        source.endsWith('/.'),
        true,
        `whole-context copy found: ${copy.raw}`
      );
    }
  }
});

test('EG-012: runtime context copies are an explicit allowlist', () => {
  const ALLOWED = new Set([
    'package.json',
    'index.js',
    'run.js',
    'deploy-commands.js',
    'src/',
  ]);
  const sources = contextCopies.flatMap((copy) => copy.sources);
  assert.ok(sources.length > 0, 'the runtime stage must copy its code');
  for (const source of sources) {
    assert.ok(
      ALLOWED.has(source),
      `unexpected build-context source in the runtime image: ${source}`
    );
  }
  assert.ok(
    sources.includes('src/'),
    'the application source tree must be copied'
  );
  // node_modules and the built dashboard must come from their build stages.
  const stageCopies = runtimeCopies.filter((copy) => copy.from !== null);
  assert.ok(
    stageCopies.some((copy) => copy.dest.includes('node_modules')),
    'production dependencies must come from the deps stage'
  );
  assert.ok(
    stageCopies.some((copy) => copy.dest.includes('web/dist')),
    'the dashboard bundle must come from the web-build stage'
  );
  // The freshly built bundle must not be shadowed by a later context copy.
  const bundleIndex = runtimeStage.instructions.findIndex((instruction) =>
    /COPY --from=\S+ .*web\/dist/.test(instruction)
  );
  assert.ok(
    bundleIndex >= 0,
    'the runtime stage must copy the built dashboard'
  );
  const shadowing = runtimeStage.instructions
    .slice(bundleIndex + 1)
    .filter(
      (instruction) =>
        /^COPY\b/i.test(instruction) &&
        !/--from=/i.test(instruction) &&
        /\.?\/?web(\/|$)/.test(instruction)
    );
  assert.deepEqual(
    shadowing,
    [],
    `a build-context COPY overwrites the built dashboard: ${shadowing.join(' | ')}`
  );
});

test('EG-012: the require graph of index.js stays inside the copied paths', () => {
  const entry = path.join(repoRoot, 'index.js');
  const allowedRoots = [
    path.join(repoRoot, 'src') + path.sep,
    entry,
    path.join(repoRoot, 'run.js'),
    path.join(repoRoot, 'deploy-commands.js'),
    path.join(repoRoot, 'package.json'),
  ];
  const seen = new Set();
  const escaped = [];
  const queue = [entry];

  const literalRequires = (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const out = [];
    const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
    let match;
    while ((match = re.exec(source)) !== null) out.push(match[2]);
    return out;
  };

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const requireFromFile = createRequire(file);
    for (const specifier of literalRequires(file)) {
      if (!specifier.startsWith('.') && !specifier.startsWith(path.sep)) {
        continue; // external package, provided by node_modules
      }
      let resolved;
      try {
        resolved = requireFromFile.resolve(specifier);
      } catch {
        continue; // optional/diagnostic require; not part of the copy set
      }
      if (resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const inside = allowedRoots.some(
        (root) => resolved === root || resolved.startsWith(root)
      );
      if (!inside)
        escaped.push(`${path.relative(repoRoot, file)} -> ${specifier}`);
      queue.push(resolved);
    }
  }

  assert.ok(
    seen.size > 20,
    `the module graph must be walked (saw ${seen.size})`
  );
  assert.deepEqual(
    escaped,
    [],
    `runtime requires outside the COPY allowlist: ${escaped.join(', ')}`
  );
});

/** .dockerignore glob matcher (supports `*`, `?` and `**`, plus `!` negation). */
function compileIgnore(patterns) {
  return patterns.map((pattern) => {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    const source = body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '@@GLOBSTAR@@')
      .replace(/\*/g, '[^/]*')
      .replace(/@@GLOBSTAR@@/g, '.*')
      .replace(/\?/g, '[^/]');
    return { negated, re: new RegExp(`^${source}(?:/.*)?$`) };
  });
}

function isIgnored(relativePath, compiled) {
  let ignored = false;
  for (const { negated, re } of compiled) {
    if (re.test(relativePath)) ignored = !negated;
  }
  return ignored;
}

test('EG-012: .dockerignore excludes developer and credential material', () => {
  const REQUIRED = [
    'report',
    'docs',
    'tasks',
    'tests',
    'web/dist',
    'web/node_modules',
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    '.env',
  ];
  for (const entry of REQUIRED) {
    assert.ok(
      dockerignore.includes(entry),
      `.dockerignore must exclude ${entry}`
    );
  }
  for (const glob of ['*.pem', '*.key', '*.p12', 'credentials*.json']) {
    assert.ok(
      dockerignore.includes(glob),
      `.dockerignore must exclude ${glob}`
    );
  }

  const compiled = compileIgnore(dockerignore);
  for (const probe of [
    'report/security-audit-result.json',
    'docs/browser-verification-notes.md',
    'tasks/check-web-security.js',
    'tests/webSecurity.test.js',
    'web/dist/index.html',
    'web/node_modules/vite/index.js',
    'operator.pem',
    '.env',
    '.env.production',
  ]) {
    assert.ok(isIgnored(probe, compiled), `${probe} must be excluded`);
  }
});

test('EG-012: every top-level entry is copied explicitly or ignored', () => {
  const compiled = compileIgnore(dockerignore);
  const runtimeSources = new Set(contextCopies.flatMap((copy) => copy.sources));
  // Sources consumed only by earlier stages never reach the runtime image.
  const buildOnlyRoots = new Set(['web', 'package-lock.json']);

  const offenders = [];
  for (const entry of fs.readdirSync(repoRoot)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    if (runtimeSources.has(entry) || runtimeSources.has(`${entry}/`)) continue;
    if (buildOnlyRoots.has(entry)) continue;
    if (isIgnored(entry, compiled)) continue;
    offenders.push(entry);
  }
  assert.deepEqual(
    offenders,
    [],
    `top-level paths neither copied nor ignored (they would reach the build context): ${offenders.join(', ')}`
  );
});

test('EG-012: the web-build stage installs dependencies from the manifest first', () => {
  const webStage = stages.find((stage) => stage.name === 'web-build');
  assert.ok(webStage, 'a web-build stage must exist');
  const manifestCopy = webStage.instructions.findIndex((instruction) =>
    /^COPY web\/package(-lock)?\.json/.test(instruction)
  );
  const npmCi = webStage.instructions.findIndex((instruction) =>
    /^RUN npm ci/.test(instruction)
  );
  const sourceCopy = webStage.instructions.findIndex((instruction) =>
    /^COPY web\/ \.\//.test(instruction)
  );
  assert.ok(
    manifestCopy >= 0 && npmCi > manifestCopy && sourceCopy > npmCi,
    'manifest copy, npm ci and source copy must be ordered for cache reuse'
  );
});
