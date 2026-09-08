'use strict';
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { logger } = require('../services/logger');
const { redactDiagnostic } = require('../utils/security');
const { safeEventListener } = require('../utils/asyncBoundary');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Load all commands into a Collection
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

for (const file of fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))) {
  const command = require(path.join(commandsPath, file));
  if (!command.data || !command.execute) {
    console.warn(`[Discord] Command file ${file} is missing data or execute.`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

/**
 * Redacted, non-fatal sink for failures that surface outside a command.
 * Never throws: index.js turns an escaping unhandledRejection into a full
 * process shutdown, which would take down every bot and the dashboard.
 */
function reportDiscordFailure(label, error) {
  try {
    logger.error({ route: `discord:${label}` }, redactDiagnostic(error));
  } catch {
    /* logging must never become the reason the process dies */
  }
}

// Load event handlers.
//
// EG-001: every loaded event handler is async. A discarded Promise here became
// an unhandled rejection (or a discord.js Client error, which Node re-raises as
// an unhandled rejection when no error listener is installed) and index.js
// exits the whole process on that path. Each boundary now owns its rejection.
const eventsPath = path.join(__dirname, 'events');
for (const file of fs
  .readdirSync(eventsPath)
  .filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  const listener = safeEventListener(
    event.name,
    (...args) => event.execute(...args),
    reportDiscordFailure
  );
  if (event.once) {
    client.once(event.name, listener);
  } else {
    client.on(event.name, listener);
  }
}

// EG-001: discord.js emits gateway/REST failures as `error` events. Without a
// listener an EventEmitter re-throws them, so install a redacted non-fatal one.
// The handler itself is wrapped so it cannot recursively throw.
client.on(
  'error',
  safeEventListener('clientError', (error) => {
    reportDiscordFailure('clientError', error);
  })
);

module.exports = client;
