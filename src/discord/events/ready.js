'use strict';
const { REST, Routes, ActivityType, Events } = require('discord.js');
const { logger } = require('../../services/logger');
const BotManager = require('../../manager/BotManager');
const config     = require('../../config');

module.exports = {
  name:  Events.ClientReady, // 'clientReady' in discord.js v14.22+/v15 (was 'ready')
  once:  true,

  async execute(client) {
    logger.info(`[Discord] Logged in as ${client.user.tag}`);

    // Set presence
    client.user.setPresence({
      activities: [{ name: 'Minecraft', type: ActivityType.Playing }],
      status: 'online',
    });

    // Register slash commands
    const commands = [...client.commands.values()].map(c => c.data.toJSON());
    const rest     = new REST({ version: '10' }).setToken(config.discord.token);

    try {
      if (config.discord.guildId) {
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
          { body: commands }
        );
        logger.info(`[Discord] Registered ${commands.length} guild commands to ${config.discord.guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
        logger.info(`[Discord] Registered ${commands.length} global commands (may take up to 1h to propagate)`);
      }
    } catch (err) {
      logger.error(`[Discord] Command registration failed: ${err.message}`);
    }

    // Connect BotManager to Discord client for alerts
    BotManager.setDiscordClient(client);
  },
};
