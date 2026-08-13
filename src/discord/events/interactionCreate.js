'use strict';
const { MessageFlags } = require('discord.js');
const { logger } = require('../../services/logger');
const { isAdmin } = require('../../utils/validators');
const { safeErrorMessage } = require('../safeError');
const config = require('../../config');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    // ── Admin guard ───────────────────────────────────────────────────────
    if (!isAdmin(interaction.user.id, config.access.adminIds)) {
      await interaction.reply({
        content: '❌ You do not have permission to use this bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({
        content: '❌ Lệnh không hợp lệ 👉 Dùng `/help` để xem danh sách lệnh.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      // Full detail always goes server-side, regardless of what we show the user.
      logger.error(
        `[Discord] Command /${interaction.commandName} threw: ${err?.stack || err?.message || err}`
      );

      const content = `❌ ${safeErrorMessage(err, 'Something went wrong running that command. This has been logged.')}`;

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch {
        /* ignore double-reply race */
      }
    }
  },
};
