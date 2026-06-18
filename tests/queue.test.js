'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Queue = require('../src/manager/Queue');

const silentLogger = { warn() {}, debug() {} };

test('runs tasks sequentially in FIFO order', async () => {
  const q = new Queue('test-bot', 10, 1_000, silentLogger);
  const order = [];
  const results = await Promise.all([
    q.enqueue(async () => { order.push(1); return 'a'; }),
    q.enqueue(async () => { order.push(2); return 'b'; }),
    q.enqueue(async () => { order.push(3); return 'c'; }),
  ]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(results, ['a', 'b', 'c']);
});

test('rejects non-function tasks', async () => {
  const q = new Queue('test-bot', 10, 1_000, silentLogger);
  await assert.rejects(() => q.enqueue('nope'), /expects a function/);
});

test('enforces per-task timeout', async () => {
  const q = new Queue('test-bot', 10, 20, silentLogger);
  await assert.rejects(
    () => q.enqueue(() => new Promise((r) => setTimeout(r, 200))),
    /timed out/,
  );
});

test('drops tasks when full and counts overflow', async () => {
  const q = new Queue('test-bot', 1, 1_000, silentLogger);
  // First task occupies the runner; the second sits pending (fills maxSize=1).
  const running = q.enqueue(() => new Promise((r) => setTimeout(() => r('done'), 30)));
  q.enqueue(async () => 'pending').catch(() => {});
  await assert.rejects(() => q.enqueue(async () => 'overflow'), /Queue full/);
  assert.ok(q.dropped >= 1);
  await running;
});

test('a failing task does not stall the queue', async () => {
  const q = new Queue('test-bot', 10, 1_000, silentLogger);
  await assert.rejects(() => q.enqueue(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await q.enqueue(async () => 'still works'), 'still works');
});

test('drain rejects pending tasks and blocks new ones', async () => {
  const q = new Queue('test-bot', 10, 1_000, silentLogger);
  q.drain();
  await assert.rejects(() => q.enqueue(async () => 'x'), /draining/);
});

test('reset re-opens a drained queue', async () => {
  const q = new Queue('test-bot', 10, 1_000, silentLogger);
  q.drain();
  q.reset();
  assert.equal(q.draining, false);
  assert.equal(await q.enqueue(async () => 'ok'), 'ok');
});
