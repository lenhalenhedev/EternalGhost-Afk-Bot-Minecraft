'use strict';
/**
 * Run this script once to register slash commands:
 *   node deploy-commands.js
 *
 * Uses DISCORD_GUILD_ID for instant guild registration.
 * Leave DISCORD_GUILD_ID empty to deploy globally (up to 1h propagation).
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const commandsPath = path.join(__dirname, 'src', 'discord', 'commands');
const commands = [];

for (const file of fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s)...`);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ Guild commands registered to guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(
        '✅ Global commands registered (may take up to 1 hour to appear)'
      );
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
