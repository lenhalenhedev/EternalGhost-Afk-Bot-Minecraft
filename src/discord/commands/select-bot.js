'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { successEmbed, errorEmbed } = require('../embeds');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

// ── /select-bot ───────────────────────────────────────────────────────────────
const selectBot = {
  data: new SlashCommandBuilder()
    .setName('select-bot')
    .setDescription('Chọn bot để điều khiển (dùng cho /start /stop /chat ...)')
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (8 ký tự đầu hoặc đầy đủ)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const partial = interaction.options.getString('id').trim();
    const match = BotManager.getAllBots().find(
      (b) => b.id.startsWith(partial) || b.id === partial
    );

    if (!match) {
      return interaction.editReply({
        embeds: [errorEmbed(`Không tìm thấy bot \`${partial}\``)],
      });
    }

    try {
      BotManager.setUserSelection(interaction.user.id, match.id);
      const r = match.record;
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Selected',
            `Đã chọn **\`${r.username}\`**@\`${r.host}:${r.port}\`\nBot ID: \`${match.id.slice(0, 8)}\``
          ),
        ],
      });
    } catch (err) {
      logger.error(`[select-bot] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not select bot.'))],
      });
    }
  },
};

module.exports = selectBot;
