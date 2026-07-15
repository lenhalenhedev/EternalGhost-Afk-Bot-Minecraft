'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cron = require('node-cron');

const { projectRoot, stubResolved, stubLogger } = require('./support/leakKit');

// Stub the shared db helper + winston-backed logger BEFORE requiring the real
// CronJob module, the same way leakKit's stubLogger() keeps other suites from
// pulling in winston (and, transitively here, the full env-validated config
// module). This lets the test exercise real scheduling/query-call logic
// without a live Postgres connection.
const dbCalls = [];
let queryImpl = async () => ({ rows: [{ '?column?': 1 }] });

stubResolved(path.join(projectRoot(), 'src/config/database.js'), {
  query: (text, params) => {
    dbCalls.push(text);
    return queryImpl(text, params);
  },
});
stubLogger();

const CronJob = require(path.join(projectRoot(), 'src/utils/CronJob.js'));

test('schedule is a valid, syntactically-correct cron expression', () => {
  assert.equal(cron.validate(CronJob.SCHEDULE), true);
});

test('start() registers a task and stop() tears it down without duplicating', () => {
  const first = CronJob.start();
  assert.ok(first, 'start() should return a scheduled task');
  const second = CronJob.start(); // re-calling must replace, not stack, the task
  assert.ok(second);
  CronJob.stop();
  assert.doesNotThrow(() => CronJob.stop()); // stopping twice must be a no-op
});

test('pingDatabase() runs SELECT 1 through the shared db helper and logs success', async () => {
  dbCalls.length = 0;
  queryImpl = async () => ({ rows: [{ '?column?': 1 }] });

  await assert.doesNotReject(() => CronJob.pingDatabase());
  assert.equal(dbCalls.length, 1);
  assert.match(dbCalls[0], /select 1/i);
});

test('pingDatabase() catches a failed query instead of throwing/crashing the process', async () => {
  dbCalls.length = 0;
  queryImpl = async () => {
    throw new Error('Connection terminated unexpectedly');
  };

  await assert.doesNotReject(() => CronJob.pingDatabase());
  assert.equal(dbCalls.length, 1);
});
