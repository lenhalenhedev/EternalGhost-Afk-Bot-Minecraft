'use strict';

/**
 * EG-009 regression tests: a confirmation click must authorise only the exact
 * destructive action shown in the message the administrator clicked.
 *
 * Every deletion dialog used to share the same two component IDs and the
 * collector filtered only on the clicking user, so with two prompts open in one
 * channel a single Confirm click satisfied both collectors and could delete a
 * target the click never pointed at.
 *
 * No Discord gateway, database, or bot is contacted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BotManager = require('../src/manager/BotManager');
const deleteBotCommand = require('../src/discord/commands/delete-bot');

const USER = '123456789012345678';
const PRINCIPAL = Object.freeze({ userId: USER, guildId: null, roles: [] });

const BOT_A = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  record: { username: 'BotA', host: '93.184.216.34', port: 25565 },
};
const BOT_B = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  record: { username: 'BotB', host: '93.184.216.35', port: 25565 },
};

class FakeChannel {
  constructor() {
    this.collectors = [];
  }

  async awaitMessageComponent(options) {
    const entry = { options, settled: false, resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    entry.timer = setTimeout(() => {
      if (entry.settled) return;
      entry.settled = true;
      entry.reject(new Error('Collector timeout'));
    }, options.time);
    entry.timer.unref?.();
    this.collectors.push(entry);
    return promise;
  }

  /** Deliver one component interaction to every collector whose filter accepts it. */
  click(component) {
    let matched = 0;
    for (const entry of this.collectors) {
      if (entry.settled) continue;
      if (!entry.options.filter(component)) continue;
      entry.settled = true;
      clearTimeout(entry.timer);
      entry.resolve(component);
      matched += 1;
    }
    return matched;
  }

  /** Simulate the 30s timeout on every still-pending collector. */
  expirePending() {
    for (const entry of this.collectors) {
      if (entry.settled) continue;
      entry.settled = true;
      clearTimeout(entry.timer);
      entry.reject(new Error('Collector timeout'));
    }
  }
}

function fakeInteraction(channel, promptId, botId) {
  const replies = [];
  return {
    replies,
    channel,
    user: { id: USER },
    options: { getString: () => botId },
    deferReply: async () => {},
    editReply: async (payload) => {
      replies.push(payload);
      return { id: promptId };
    },
    fetchReply: async () => ({ id: promptId }),
  };
}

function customIds(payload) {
  const row = payload?.components?.[0];
  const list = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  return (list?.components || []).map((component) => component.custom_id);
}

function stubManager() {
  const deleted = [];
  const original = {
    resolveAuthorizedBot: BotManager.resolveAuthorizedBot,
    deleteBot: BotManager.deleteBot,
  };
  BotManager.resolveAuthorizedBot = (_principal, id) => {
    if (id === BOT_A.id) return BOT_A;
    if (id === BOT_B.id) return BOT_B;
    throw new Error('Bot not found or access denied.');
  };
  BotManager.deleteBot = async (_principal, id) => {
    deleted.push(id);
    return true;
  };
  return {
    deleted,
    restore() {
      BotManager.resolveAuthorizedBot = original.resolveAuthorizedBot;
      BotManager.deleteBot = original.deleteBot;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A component interaction as discord.js would hand it to the collector. */
function componentInteraction({ userId, customId, messageId }) {
  return {
    user: { id: userId },
    customId,
    message: { id: messageId },
    deferUpdate: async () => {},
  };
}

test('EG-009: a Confirm click deletes only the bot shown in the clicked prompt', async () => {
  const stub = stubManager();
  const channel = new FakeChannel();
  try {
    const interactionA = fakeInteraction(channel, 'prompt-a', BOT_A.id);
    const interactionB = fakeInteraction(channel, 'prompt-b', BOT_B.id);

    const pendingA = deleteBotCommand.execute(interactionA, PRINCIPAL);
    const pendingB = deleteBotCommand.execute(interactionB, PRINCIPAL);
    await tick();

    assert.equal(channel.collectors.length, 2, 'both dialogs are waiting');
    assert.notEqual(
      customIds(interactionA.replies[0]).join(),
      customIds(interactionB.replies[0]).join(),
      'each dialog must use its own component IDs'
    );

    const [confirmB] = customIds(interactionB.replies[0]);
    assert.match(confirmB, /^confirm_delete:[0-9a-f]{18}:/);

    const matched = channel.click(
      componentInteraction({
        userId: USER,
        customId: confirmB,
        messageId: 'prompt-b',
      })
    );
    assert.equal(matched, 1, 'exactly one collector may accept the click');

    await pendingB;
    channel.expirePending();
    await pendingA;

    assert.deepEqual(
      stub.deleted,
      [BOT_B.id],
      'only the clicked target is deleted'
    );
  } finally {
    stub.restore();
  }
});

test('EG-009: a click from a different message or with a foreign nonce is ignored', async () => {
  const stub = stubManager();
  const channel = new FakeChannel();
  try {
    const interaction = fakeInteraction(channel, 'prompt-a', BOT_A.id);
    const pending = deleteBotCommand.execute(interaction, PRINCIPAL);
    await tick();

    const [confirmA] = customIds(interaction.replies[0]);

    assert.equal(
      channel.click(
        componentInteraction({
          userId: USER,
          customId: confirmA,
          messageId: 'some-other-message',
        })
      ),
      0,
      'a click bound to another prompt must not be accepted'
    );
    assert.equal(
      channel.click(
        componentInteraction({
          userId: USER,
          customId: `confirm_delete:${'f'.repeat(18)}:${BOT_A.id}`,
          messageId: 'prompt-a',
        })
      ),
      0,
      'a stale or forged nonce must not be accepted'
    );
    assert.equal(
      channel.click(
        componentInteraction({
          userId: '999999999999999999',
          customId: confirmA,
          messageId: 'prompt-a',
        })
      ),
      0,
      'another user must not be able to confirm'
    );

    channel.expirePending();
    await pending;
    assert.deepEqual(stub.deleted, [], 'nothing may be deleted');
  } finally {
    stub.restore();
  }
});

test('EG-009: cancel on the correct prompt deletes nothing', async () => {
  const stub = stubManager();
  const channel = new FakeChannel();
  try {
    const interaction = fakeInteraction(channel, 'prompt-a', BOT_A.id);
    const pending = deleteBotCommand.execute(interaction, PRINCIPAL);
    await tick();

    const [, cancelA] = customIds(interaction.replies[0]);
    assert.match(cancelA, /^cancel_delete:[0-9a-f]{18}:/);

    const matched = channel.click(
      componentInteraction({
        userId: USER,
        customId: cancelA,
        messageId: 'prompt-a',
      })
    );
    assert.equal(matched, 1);
    await pending;
    assert.deepEqual(stub.deleted, []);
  } finally {
    stub.restore();
  }
});
