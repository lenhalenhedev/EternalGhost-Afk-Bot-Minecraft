'use strict';
const { logger } = require('../../services/logger');
const { isAdmin } = require('../../utils/validators');
const config      = require('../../config');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    // ── Admin guard ───────────────────────────────────────────────────────────
    if (!isAdmin(interaction.user.id, config.access.adminIds)) {
      await interaction.reply({
        content: '❌ You do not have permission to use this bot.',
        ephemeral: true,
      });
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({
        content: '❌ Lệnh không hợp lệ 👉 Dùng `/help` để xem danh sách lệnh.',
        ephemeral: true,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`[Discord] Command /${interaction.commandName} threw: ${err.message}`);
      const msg = `❌ Lỗi khi thực thi lệnh: \`${err.message}\``;
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: msg, ephemeral: true });
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch (_) { /* ignore double-reply race */ }
    }
  },
};
