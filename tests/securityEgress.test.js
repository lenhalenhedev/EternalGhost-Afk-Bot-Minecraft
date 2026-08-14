'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertPublicDestination,
  isPublicIpAddress,
} = require('../src/utils/validators');

test('isPublicIpAddress rejects loopback, private, link-local, multicast, reserved, and IPv6 local addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(
      isPublicIpAddress(address),
      false,
      `${address} must be denied`
    );
  }

  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('assertPublicDestination accepts a public literal without DNS', async () => {
  const destination = await assertPublicDestination('8.8.8.8');
  assert.deepEqual(destination, {
    host: '8.8.8.8',
    address: '8.8.8.8',
    family: 4,
  });
});

test('assertPublicDestination fails closed on direct private targets and DNS failures', async () => {
  await assert.rejects(
    assertPublicDestination('169.254.169.254'),
    /Destination is not permitted/
  );
  await assert.rejects(
    assertPublicDestination('unresolvable.example.test', {
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    }),
    /Destination is not permitted/
  );
});

test('assertPublicDestination rejects a hostname when any resolved address is non-public', async () => {
  await assert.rejects(
    assertPublicDestination('rebind.example.test', {
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    /Destination is not permitted/
  );
});

test('assertPublicDestination pins one verified public DNS result for the connector', async () => {
  const destination = await assertPublicDestination('play.example.test', {
    lookup: async () => [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ],
  });
  assert.deepEqual(destination, {
    host: 'play.example.test',
    address: '2606:4700:4700::1111',
    family: 6,
  });
});

test('assertPublicDestination permits an explicitly approved private literal only', async () => {
  const destination = await assertPublicDestination('10.42.0.10', {
    allowPrivateIps: ['10.42.0.10'],
  });
  assert.equal(destination.address, '10.42.0.10');

  await assert.rejects(
    assertPublicDestination('internal.example.test', {
      allowPrivateIps: ['10.42.0.10'],
      lookup: async () => [{ address: '10.42.0.10', family: 4 }],
    }),
    /Destination is not permitted/
  );
});

test('createMineflayerBot pins the connector to the final verified address', async () => {
  const mineflayer = require('mineflayer');
  const originalCreateBot = mineflayer.createBot;
  const { createMineflayerBot } = require('../src/bot/connection/connector');
  let received;
  const expectedBot = { on() {} };
  mineflayer.createBot = (options) => {
    received = options;
    return expectedBot;
  };

  try {
    const bot = await createMineflayerBot(
      {
        id: 'egress-test',
        host: 'play.example.test',
        port: 25565,
        username: 'player',
        version: '1.20.4',
      },
      {
        resolveDestination: async () => ({
          host: 'play.example.test',
          address: '8.8.8.8',
          family: 4,
        }),
      }
    );
    assert.equal(bot, expectedBot);
    assert.equal(received.host, '8.8.8.8');
  } finally {
    mineflayer.createBot = originalCreateBot;
  }
});
