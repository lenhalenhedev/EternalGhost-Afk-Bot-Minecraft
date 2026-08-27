'use strict';
const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { successEmbed, errorEmbed } = require('../embeds');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

// ── /select-bot ───────────────────────────────────────────────────────────────
const selectBot = {
  data: new SlashCommandBuilder()
    .setName('select-bot')
    .setDescription('Chọn bot để điều khiển (dùng cho /start /stop /chat ...)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Unique UUID prefix, at least 8 characters')
        .setMinLength(8)
        .setMaxLength(36)
        .setRequired(true)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const match = await BotManager.setUserSelection(
        principal,
        interaction.options.getString('id').trim()
      );
      const r = match.record;
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Selected',
            `Đã chọn **\`${r.username}\`**@\`${r.host}:${r.port}\`\nBot ID: \`${match.id}\``
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
