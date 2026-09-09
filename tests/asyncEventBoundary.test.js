'use strict';

/**
 * EG-001 regression tests: every external async event boundary must own the
 * rejection of the work it starts, so a failed handler degrades that handler
 * instead of tripping index.js's `unhandledRejection` → process.exit(1) path.
 *
 * No Discord gateway, Minecraft server, or PostgreSQL instance is contacted;
 * these tests use in-process emitters and a stubbed persistence singleton.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const {
  safeEventListener,
  attachSafeListener,
} = require('../src/utils/asyncBoundary');

/** Collect unhandled rejections for the duration of `fn`. */
async function captureUnhandledRejections(fn) {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
    // Let the microtask + macrotask queues drain so a late rejection surfaces.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

test('EG-001: a rejecting async listener is reported, not escaped', async () => {
  const reported = [];
  const listener = safeEventListener(
    'test:ready',
    async () => {
      throw new Error('password=hunter2 downstream failure');
    },
    (label, err) => reported.push({ label, err })
  );

  const seen = await captureUnhandledRejections(async () => {
    listener();
  });

  assert.deepEqual(
    seen,
    [],
    'the rejection must not reach the process handler'
  );
  assert.equal(reported.length, 1);
  assert.equal(reported[0].label, 'test:ready');
});

test('EG-001: a synchronously throwing listener is reported, not escaped', async () => {
  const reported = [];
  const listener = safeEventListener(
    'test:sync',
    () => {
      throw new Error('boom');
    },
    (label, err) => reported.push({ label, err })
  );

  const seen = await captureUnhandledRejections(async () => {
    assert.doesNotThrow(() => listener());
  });

  assert.deepEqual(seen, []);
  assert.equal(reported.length, 1);
});

test('EG-001: a throwing reporter cannot recreate an unhandled rejection', async () => {
  const listener = safeEventListener(
    'test:badreporter',
    async () => {
      throw new Error('boom');
    },
    () => {
      throw new Error('reporter is broken');
    }
  );

  const seen = await captureUnhandledRejections(async () => {
    listener();
  });

  assert.deepEqual(seen, []);
});

test('EG-001: the default reporter redacts secret-shaped handler output', () => {
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const { defaultReport } = require('../src/utils/asyncBoundary');
    defaultReport('test:redact', new Error('token=abc.def.ghi failed'));
  } finally {
    process.stderr.write = original;
  }
  const output = writes.join('');
  assert.match(output, /\[async-boundary\] test:redact failed/);
  assert.doesNotMatch(output, /abc\.def\.ghi/);
});

test('EG-001: attachSafeListener keeps valid handlers working', async () => {
  const emitter = new EventEmitter();
  const received = [];
  attachSafeListener(emitter, 'ping', async (value) => received.push(value));

  const seen = await captureUnhandledRejections(async () => {
    emitter.emit('ping', 1);
    emitter.emit('ping', 2);
  });

  assert.deepEqual(seen, []);
  assert.deepEqual(received, [1, 2]);
});

test('EG-001: a rejected stateChange persistence write cannot escape or crash', async () => {
  const Persistence = require('../src/manager/Persistence');
  const {
    attachInstanceEvents,
    getStateWriteStats,
  } = require('../src/manager/instanceEvents');

  const originalUpdate = Persistence.updateBotState;
  const instance = new EventEmitter();
  instance.id = 'eg001-bot';
  instance.record = { createdBy: '123456789012345678' };
  instance.toJSON = () => ({ id: instance.id });
  const notifier = {
    sendAlert: async () => {},
    sendErrorLog: async () => {},
  };
  const alerts = [];
  instance.on('alert', (type) => alerts.push(type));
  attachInstanceEvents(instance, notifier);

  let calls = 0;
  Persistence.updateBotState = async () => {
    calls += 1;
    throw new Error('connection terminated unexpectedly');
  };

  const before = getStateWriteStats();
  try {
    const seen = await captureUnhandledRejections(async () => {
      instance.emit('stateChange', 'OFFLINE', 'PLAYING');
      // 250ms + 500ms backoff for attempts 2 and 3, then exhaustion.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });

    assert.deepEqual(seen, [], 'no unhandledRejection may reach the process');
    assert.equal(calls, 3, 'the retry budget must be exhausted exactly once');
    const after = getStateWriteStats();
    assert.equal(after.failures - before.failures, 3);
    assert.equal(after.exhausted - before.exhausted, 1);
    assert.deepEqual(
      alerts,
      ['persistenceDegraded'],
      'exhaustion must be observable as a degraded-persistence alert'
    );
  } finally {
    Persistence.updateBotState = originalUpdate;
    instance.removeAllListeners();
  }
});

test('EG-001: a state write that recovers on retry succeeds without an alert', async () => {
  const Persistence = require('../src/manager/Persistence');
  const { persistBotState } = require('../src/manager/instanceEvents');

  const originalUpdate = Persistence.updateBotState;
  const instance = new EventEmitter();
  instance.id = 'eg001-recover';
  const alerts = [];
  instance.on('alert', (type) => alerts.push(type));

  let calls = 0;
  Persistence.updateBotState = async () => {
    calls += 1;
    if (calls === 1) throw new Error('transient database failure');
    return true;
  };

  try {
    // The retry timer is unref()'d on purpose (it must never block process
    // shutdown), so keep the loop alive here with a ref'd guard timer.
    let guard;
    const timeout = new Promise((resolve) => {
      guard = setTimeout(() => resolve('timeout'), 3_000);
    });
    let ok;
    try {
      ok = await Promise.race([persistBotState(instance, 'PLAYING'), timeout]);
    } finally {
      clearTimeout(guard);
    }
    assert.equal(ok, true, 'a recovered write must resolve true');
    assert.equal(calls, 2);
    assert.deepEqual(alerts, []);
  } finally {
    Persistence.updateBotState = originalUpdate;
    instance.removeAllListeners();
  }
});

test('EG-001: the Discord client installs redacted non-fatal error handling', async () => {
  const client = require('../src/discord/client');

  assert.ok(
    client.listenerCount('error') >= 1,
    'a client error listener must be installed'
  );
  assert.equal(client.listenerCount('interactionCreate'), 1);

  const seen = await captureUnhandledRejections(async () => {
    assert.doesNotThrow(() =>
      client.emit('error', new Error('gateway connection reset'))
    );
  });
  assert.deepEqual(seen, []);
});

test('EG-001: autocomplete failures are contained inside interactionCreate', async () => {
  const interactionCreate = require('../src/discord/events/interactionCreate');
  const responses = [];
  const interaction = {
    commandName: 'select-bot',
    user: { id: '123456789012345678' },
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    responded: false,
    respond: async (choices) => {
      responses.push(choices);
    },
    client: {
      commands: {
        get: () => ({
          autocomplete: async () => {
            throw new Error('metadata lookup failed');
          },
        }),
      },
    },
  };

  const seen = await captureUnhandledRejections(async () => {
    await interactionCreate.execute(interaction);
  });

  assert.deepEqual(seen, []);
  assert.deepEqual(
    responses,
    [[]],
    'a failed autocomplete degrades to no results'
  );
});
