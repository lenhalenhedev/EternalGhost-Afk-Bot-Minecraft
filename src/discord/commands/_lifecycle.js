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

/** Resolve a command target by canonical ID or the caller's authorized selection. */
function resolveBot(interaction, principal) {
  return BotManager.resolveAuthorizedBot(
    principal,
    interaction.options.getString('id')?.trim() || null,
    { allowSelection: true }
  );
}

// ── /start ────────────────────────────────────────────────────────────────────
const startCmd = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Khởi động bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction, principal);
      await BotManager.startBot(principal, instance.id);
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Started',
            `Bot \`${instance.record.username}\` đang kết nối...\nDùng \`/status-bot\` để theo dõi.`
          ),
        ],
      });
    } catch (err) {
      logger.error(`[start] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not start bot.'))],
      });
    }
  },
};

// ── /stop ─────────────────────────────────────────────────────────────────────
const stopCmd = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Dừng bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o
        .setName('force')
        .setDescription('Force stop (bỏ qua queue)')
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction, principal);
      const force = interaction.options.getBoolean('force') ?? false;
      await BotManager.stopBot(principal, instance.id, force);
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Stopped',
            `Bot \`${instance.record.username}\` đã dừng.${force ? ' (force)' : ''}`
          ),
        ],
      });
    } catch (err) {
      logger.error(`[stop] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not stop bot.'))],
      });
    }
  },
};

// ── /restart ──────────────────────────────────────────────────────────────────
const restartCmd = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Khởi động lại bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction, principal);
      await interaction.editReply({
        content: `🔄 Đang restart bot \`${instance.record.username}\`...`,
      });
      await BotManager.restartBot(principal, instance.id);
      // Edit after restart completes
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Restarted',
            `Bot \`${instance.record.username}\` đã được khởi động lại.`
          ),
        ],
      });
    } catch (err) {
      logger.error(`[restart] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not restart bot.'))],
      });
    }
  },
};

module.exports = { startCmd, stopCmd, restartCmd };
