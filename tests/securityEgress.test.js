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

// ── EG-003: IPv6 special-use classification ─────────────────────────────────

const SPECIAL_USE_IPV6 = [
  '::', // unspecified
  '::1', // loopback
  '::7f00:1', // deprecated IPv4-compatible loopback (::127.0.0.1)
  '::a00:1', // deprecated IPv4-compatible (::10.0.0.1)
  '64:ff9b::808:808', // NAT64 translation of 8.8.8.8
  '64:ff9b:1::1', // local-use translation
  '100::1', // discard-only
  '2001::1', // Teredo
  '2001:1::1', // PCP anycast
  '2001:1::2', // TRACEROUTE anycast
  '2001:2::1', // benchmarking
  '2001:3::1', // AMT
  '2001:4:112::1', // AS112-v6
  '2001:10::1', // ORCHID
  '2001:20::1', // ORCHIDv2
  '2001:db8::1', // documentation
  '2002:7f00:1::1', // 6to4 of 127.0.0.1
  '2620:4f:8000::1', // RFC 9637 test-net
  '3ffe::1', // 6bone
  '5f00::1', // 6bone
  'fc00::1', // unique local
  'fd12:3456::1', // unique local
  'fe80::1', // link-local
  'fec0::1', // deprecated site-local
  'ff02::1', // multicast
  '1000::1', // outside global unicast
  '4000::1', // outside global unicast
];

test('EG-003: IPv6 special-use and translated literals are never public', () => {
  for (const address of SPECIAL_USE_IPV6) {
    assert.equal(
      isPublicIpAddress(address),
      false,
      `${address} must be denied`
    );
  }
});

test('EG-003: globally routable IPv6 literals remain permitted', () => {
  for (const address of [
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001:81a::200e',
    '::ffff:8.8.8.8', // IPv4-mapped stays governed by the IPv4 policy
  ]) {
    assert.equal(
      isPublicIpAddress(address),
      true,
      `${address} must be allowed`
    );
  }
});

test('EG-003: a denial reason names the offending range', () => {
  const { ipv6DenialReason } = require('../src/utils/validators');
  assert.equal(ipv6DenialReason('2606:4700:4700::1111'), null);
  assert.match(ipv6DenialReason('fec0::1'), /fec0::\/10/);
  assert.match(ipv6DenialReason('::127.0.0.1'), /::\/96/);
  assert.match(ipv6DenialReason('64:ff9b::808:808'), /64:ff9b::\/96/);
  assert.match(ipv6DenialReason('4000::1'), /2000::\/3/);
  assert.match(ipv6DenialReason('::ffff:10.0.0.1'), /embedded IPv4/);
});

test('EG-003: assertPublicDestination rejects special-use literals without DNS', async () => {
  const lookup = async () => {
    throw new Error('DNS must not be consulted for a literal');
  };
  for (const address of [
    'fec0::1',
    '::127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::1',
  ]) {
    await assert.rejects(
      assertPublicDestination(address, { lookup }),
      /Destination is not permitted/,
      address
    );
  }
});

test('EG-003: a DNS answer containing a special-use address is rejected', async () => {
  await assert.rejects(
    assertPublicDestination('special.example.test', {
      lookup: async () => [{ address: 'fec0::1', family: 6 }],
    }),
    /Destination is not permitted/
  );
});

test('EG-003: mixed public and special-use IPv6 DNS answers fail closed', async () => {
  await assert.rejects(
    assertPublicDestination('mixed.example.test', {
      lookup: async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '2002:7f00:1::1', family: 6 },
      ],
    }),
    /Destination is not permitted/
  );
});

test('EG-003: the connector is never reached for a special-use destination', async () => {
  const mineflayer = require('mineflayer');
  const originalCreateBot = mineflayer.createBot;
  const { createMineflayerBot } = require('../src/bot/connection/connector');
  let called = false;
  mineflayer.createBot = () => {
    called = true;
    return {};
  };
  try {
    await assert.rejects(
      createMineflayerBot({
        id: 'eg003-test',
        host: 'fec0::1',
        port: 25565,
        username: 'Tester',
        version: '1.20.1',
      }),
      /Destination is not permitted/
    );
    assert.equal(called, false, 'mineflayer.createBot must not be called');
  } finally {
    mineflayer.createBot = originalCreateBot;
  }
});
