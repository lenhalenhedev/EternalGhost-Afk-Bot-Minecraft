'use strict';

/**
 * Deterministic dummy configuration for the automated test suite.
 *
 * These values are non-functional placeholders only. They let the security
 * and unit tests load src/config without real credentials. Real secrets must
 * never be committed here or anywhere else in the repository.
 *
 * Loaded before every test file by the npm test script:
 *   node --require ./tests/support/envSetup.js --test
 *
 * `||=` keeps any environment already provided by the operator/CI intact so
 * the suite can still be run against intentionally overridden values.
 */
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.ADMIN_USER_IDS ||= '123456789012345678';
process.env.DISCORD_TOKEN ||= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';
