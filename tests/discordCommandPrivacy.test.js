'use strict';

/**
 * EG-008 regression tests: administrator Discord commands that render
 * fleet/bot metadata must produce caller-only (ephemeral) responses.
 *
 * Slash-command permissions gate *invocation*, not *visibility*: a normal
 * deferred reply can be read by every member with channel access, and no later
 * edit can convert it into a private response.
 *
 * No Discord gateway is contacted; the interaction and BotManager are stubbed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MessageFlags } = require('discord.js');
const BotManager = require('../src/manager/BotManager');

const PRINCIPAL = Object.freeze({
  userId: '123456789012345678',
  guildId: null,
  roles: [],
});

function fakeInteraction(options = {}) {
  const calls = [];
  return {
    calls,
    options: {
      getInteger: () => options.page ?? null,
      getString: () => options.id ?? null,
    },
    deferReply: async (payload) => {
      calls.push({ method: 'deferReply', payload });
    },
    editReply: async (payload) => {
      calls.push({ method: 'editReply', payload });
      return {};
    },
    reply: async (payload) => {
      calls.push({ method: 'reply', payload });
      return {};
    },
  };
}

const BOT_INSTANCE = {
  id: '44444444-4444-4444-8444-444444444444',
  state: 'PLAYING',
  record: {
    username: 'VisibleBot',
    host: '93.184.216.34',
    port: 25565,
  },
  toJSON: () => ({}),
};

const STATS = {
  uptime: 120,
  totalBots: 1,
  aliveBots: 1,
  memHeapUsed: 40 * 1024 * 1024,
  memRSS: 90 * 1024 * 1024,
  estimatedPerBotMB: 30,
  activeSubsystems: 3,
};

function stubManager(overrides = {}) {
  const original = {
    listAuthorizedBots: BotManager.listAuthorizedBots,
    getUserSelection: BotManager.getUserSelection,
    resolveAuthorizedBot: BotManager.resolveAuthorizedBot,
    getStats: BotManager.getStats,
  };
  Object.assign(BotManager, {
    listAuthorizedBots: () => [BOT_INSTANCE],
    getUserSelection: () => null,
    resolveAuthorizedBot: () => BOT_INSTANCE,
    getStats: () => STATS,
    ...overrides,
  });
  return () => Object.assign(BotManager, original);
}

function assertEphemeralDefer(interaction, commandName) {
  const defers = interaction.calls.filter((c) => c.method === 'deferReply');
  assert.equal(defers.length, 1, `${commandName} must defer exactly once`);
  assert.deepEqual(
    defers[0].payload,
    { flags: MessageFlags.Ephemeral },
    `${commandName} must defer ephemerally so only the caller can read it`
  );
  assert.equal(
    interaction.calls.some((c) => c.method === 'reply'),
    false,
    `${commandName} must not create a channel-visible reply`
  );
}

test('EG-008: /list-bot responds ephemerally', async () => {
  const restore = stubManager();
  const command = require('../src/discord/commands/list-bot');
  const interaction = fakeInteraction();
  try {
    await command.execute(interaction, PRINCIPAL);
    assertEphemeralDefer(interaction, '/list-bot');
    const edit = interaction.calls.find((c) => c.method === 'editReply');
    assert.ok(edit, 'the listing must still be delivered to the caller');
    assert.match(JSON.stringify(edit.payload), /VisibleBot/);
  } finally {
    restore();
  }
});

test('EG-008: /status-bot responds ephemerally, including on error', async () => {
  const restore = stubManager();
  const command = require('../src/discord/commands/status-bot');
  try {
    const ok = fakeInteraction({ id: BOT_INSTANCE.id });
    await command.execute(ok, PRINCIPAL);
    assertEphemeralDefer(ok, '/status-bot');

    const failing = stubManager({
      resolveAuthorizedBot: () => {
        throw new Error('Bot not found or access denied.');
      },
    });
    const denied = fakeInteraction({ id: 'nope' });
    await command.execute(denied, PRINCIPAL);
    failing();
    assertEphemeralDefer(denied, '/status-bot (error path)');
  } finally {
    restore();
  }
});

test('EG-008: /stats responds ephemerally', async () => {
  const restore = stubManager();
  const command = require('../src/discord/commands/stats');
  const interaction = fakeInteraction();
  try {
    await command.execute(interaction, PRINCIPAL);
    assertEphemeralDefer(interaction, '/stats');
    const edit = interaction.calls.find((c) => c.method === 'editReply');
    assert.ok(edit);
    assert.match(JSON.stringify(edit.payload), /93\.184\.216\.34/);
  } finally {
    restore();
  }
});

test('EG-008: every command module defers ephemerally (no public-response allowlist)', () => {
  const dir = path.join(__dirname, '..', 'src', 'discord', 'commands');
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .sort();
  assert.ok(files.length >= 15, 'the command directory must be enumerated');

  // Intentionally public responses would have to be listed here after review.
  const PUBLIC_RESPONSE_ALLOWLIST = new Set([]);

  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const responses =
      source.match(/(?:deferReply|\.reply)\s*\(([^;]*?)\);/g) || [];
    for (const call of responses) {
      if (
        !call.includes('MessageFlags.Ephemeral') &&
        !PUBLIC_RESPONSE_ALLOWLIST.has(file)
      ) {
        offenders.push(`${file}: ${call.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `non-ephemeral Discord responses found: ${offenders.join(' | ')}`
  );
});
