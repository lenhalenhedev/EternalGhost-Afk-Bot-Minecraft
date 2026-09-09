'use strict';

/**
 * EG-004 regression tests: untrusted runtime text must be redacted and bounded
 * before it reaches a durable or broadcast log sink, durable log files must be
 * size-bounded and retained, and a stalled SSE client must not make the
 * process buffer without limit.
 *
 * No Minecraft server, database, or network endpoint is contacted: messages
 * are injected directly into the application's own log entry points and the
 * stream/transport classes are exercised with in-process fakes and a temporary
 * directory.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');

const {
  redactForLog,
  MAX_LOG_MESSAGE_CHARS,
} = require('../src/utils/security');
const { RotatingFileStream } = require('../src/services/logFile');
const { SseWriter } = require('../src/web/sse/sseWriter');
const {
  logger,
  botLog,
  getBotLogs,
  subscribeBotLogs,
} = require('../src/services/logger');

// Marker chosen so it can never collide with a real value.
const SECRET_MARKER = 'Sup3rS3cretMarkerValue';
const UNTRUSTED_MESSAGE = `Login failed! password=${SECRET_MARKER} token: ${SECRET_MARKER}.jwt.sig`;

test('EG-004: redactForLog removes secret-shaped untrusted text', () => {
  const redacted = redactForLog(UNTRUSTED_MESSAGE);
  assert.equal(redacted.includes(SECRET_MARKER), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test('EG-004: redactForLog bounds the retained message length', () => {
  const long = `AAAA${'x'.repeat(50_000)}`;
  const redacted = redactForLog(long);
  assert.ok(redacted.length <= MAX_LOG_MESSAGE_CHARS + 64);
  assert.match(redacted, /truncated \d+ chars/);
});

test('EG-004: botLog never retains or streams raw untrusted server text', () => {
  const streamed = [];
  const unsubscribe = subscribeBotLogs((entry) => streamed.push(entry));
  try {
    botLog('eg004-bot', 'error', UNTRUSTED_MESSAGE);
  } finally {
    unsubscribe();
  }

  const buffered = getBotLogs('eg004-bot', 50);
  assert.equal(buffered.length, 1);
  assert.equal(buffered[0].msg.includes(SECRET_MARKER), false);
  assert.equal(streamed.length, 1);
  assert.equal(streamed[0].message.includes(SECRET_MARKER), false);
});

test('EG-004: the Pino stdout sink receives only redacted text', () => {
  const captured = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    logger.error(UNTRUSTED_MESSAGE);
    logger.error({ botId: 'eg004-pino' }, `hard fail "${UNTRUSTED_MESSAGE}"`);
  } finally {
    process.stdout.write = original;
  }

  const output = captured.join('');
  assert.equal(output.includes(SECRET_MARKER), false);
  assert.match(output, /\[REDACTED\]/);
});

test('EG-004: an overlong untrusted message cannot reach the durable sink whole', () => {
  const captured = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    botLog('eg004-flood', 'error', `A${'y'.repeat(200_000)}${SECRET_MARKER}`);
  } finally {
    process.stdout.write = original;
  }
  const output = captured.join('');
  assert.ok(output.length < 20_000, 'a single record must stay bounded');
  assert.equal(output.includes(SECRET_MARKER), false);
});

test('EG-004: the auth hard-fail path logs a redacted server message', async () => {
  const { AuthFlow } = require('../src/bot/auth/authFlow');
  const instance = { id: 'eg004-auth', state: 'AUTHENTICATING' };
  const flow = new AuthFlow(instance);

  flow.onHardFail(`Invalid credentials: password=${SECRET_MARKER}`);

  const lines = getBotLogs('eg004-auth', 50);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.equal(line.msg.includes(SECRET_MARKER), false);
  }
});

test('EG-004: RotatingFileStream bounds on-disk usage and retains generations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg004-logs-'));
  const file = path.join(dir, 'combined.jsonl');
  const maxBytes = 4_096;
  const maxFiles = 2;
  const stream = new RotatingFileStream(file, { maxBytes, maxFiles });
  try {
    for (let i = 0; i < 40; i += 1) {
      stream.write(`${JSON.stringify({ i, pad: 'z'.repeat(200) })}\n`);
    }
    assert.ok(stream.rotations >= 2, 'the file must have rotated');
    assert.ok(fs.existsSync(file), 'live file present');
    assert.ok(fs.existsSync(`${file}.1`), 'generation 1 retained');
    assert.ok(fs.existsSync(`${file}.2`), 'generation 2 retained');
    assert.equal(
      fs.existsSync(`${file}.3`),
      false,
      'generations beyond maxFiles must be discarded'
    );

    const total = [file, `${file}.1`, `${file}.2`]
      .map((p) => fs.statSync(p).size)
      .reduce((a, b) => a + b, 0);
    assert.ok(
      total <= stream.budgetBytes,
      `total ${total} must stay within budget ${stream.budgetBytes}`
    );
    assert.equal(
      stream.generations().length,
      maxFiles + 1,
      'generations() must describe every retained file'
    );
  } finally {
    stream.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('EG-004: RotatingFileStream resumes from the existing file size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg004-resume-'));
  const file = path.join(dir, 'combined.jsonl');
  fs.writeFileSync(file, 'x'.repeat(5_000));
  const stream = new RotatingFileStream(file, { maxBytes: 4_096, maxFiles: 1 });
  try {
    assert.equal(stream.bytesWritten, 5_000);
    stream.write('more\n');
    assert.ok(
      stream.rotations >= 1,
      'an over-budget existing file must rotate'
    );
  } finally {
    stream.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

class FakeResponse extends EventEmitter {
  constructor({ stall = false } = {}) {
    super();
    this.stall = stall;
    this.frames = [];
    this.ended = false;
  }

  write(frame) {
    // A real socket still accepts the bytes; `false` only signals that the
    // high-water mark was crossed and the writer must wait for 'drain'.
    this.frames.push(frame);
    return !this.stall;
  }

  end() {
    this.ended = true;
  }
}

test('EG-004: SSE writes are bounded and log frames are dropped first', () => {
  const res = new FakeResponse({ stall: true });
  const writer = new SseWriter(res, { maxBuffered: 10 });

  for (let i = 0; i < 40; i += 1) {
    writer.write(`data: log ${i}\n\n`, 'log');
  }
  // One frame reached the socket before backpressure engaged; the rest stay in
  // a hard-bounded buffer and the surplus is counted as dropped.
  assert.equal(writer.buffered, 10, 'the buffer must never exceed its budget');
  assert.equal(writer.dropped, 29);

  // A control frame still gets a slot by evicting a buffered log frame.
  assert.equal(writer.write('data: state\n\n', 'event'), true);
  assert.equal(writer.buffered, 10);
  assert.equal(writer.dropped, 30);
  assert.ok(
    writer._buffered.some((entry) => entry.frame === 'data: state\n\n'),
    'non-log frames must be retained over droppable log frames'
  );
  assert.ok(
    writer._buffered.every(
      (entry) => entry.kind === 'log' || entry.kind === 'event'
    ),
    'every retained frame keeps its kind'
  );
  writer.close();
});

test('EG-004: a stalled SSE writer resumes and flushes on drain', () => {
  const res = new FakeResponse({ stall: true });
  const writer = new SseWriter(res, { maxBuffered: 50 });

  for (let i = 0; i < 5; i += 1) writer.write(`data: ${i}\n\n`, 'event');
  assert.equal(res.frames.length, 1, 'only the first frame reaches the socket');
  assert.equal(writer.buffered, 4, 'the rest wait for drain');
  assert.equal(writer.dropped, 0);

  res.stall = false;
  res.emit('drain');
  assert.equal(writer.buffered, 0, 'drain must flush the backlog');
  assert.deepEqual(res.frames, [
    'data: 0\n\n',
    'data: 1\n\n',
    'data: 2\n\n',
    'data: 3\n\n',
    'data: 4\n\n',
  ]);
  writer.close();
});

test('EG-004: a closed SSE writer drops further frames', () => {
  const res = new FakeResponse();
  const writer = new SseWriter(res);
  writer.close();
  assert.equal(writer.write('data: late\n\n'), false);
  assert.equal(res.frames.length, 0);
});
