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

/** Resolve bot: by ID arg → fallback to user selection */
function resolveBot(interaction) {
  const partial = interaction.options.getString('id')?.trim();
  if (partial) {
    const match = BotManager.getAllBots().find(
      (b) => b.id.startsWith(partial) || b.id === partial
    );
    if (!match) throw new Error(`Không tìm thấy bot \`${partial}\``);
    return match;
  }
  const sel = BotManager.getUserSelection(interaction.user.id);
  if (!sel)
    throw new Error(
      'Chưa chọn bot. Dùng `/select-bot` trước hoặc cung cấp ID.'
    );
  return sel;
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

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction);
      await BotManager.startBot(instance.id);
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

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction);
      const force = interaction.options.getBoolean('force') ?? false;
      await BotManager.stopBot(instance.id, force);
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

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const instance = resolveBot(interaction);
      await interaction.editReply({
        content: `🔄 Đang restart bot \`${instance.record.username}\`...`,
      });
      await BotManager.restartBot(instance.id);
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
