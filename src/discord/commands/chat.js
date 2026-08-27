'use strict';
const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { validateChatMessage } = require('../../utils/validators');
const { successEmbed, errorEmbed } = require('../embeds');
const { ALIVE_STATES } = require('../../bot/states');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

// Per-user cooldown: userId -> lastSentTs
const cooldowns = new Map();
const COOLDOWN_MS = 2500;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Gửi tin nhắn vào game Minecraft qua bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('Nội dung tin nhắn (tối đa 200 ký tự)')
        .setRequired(true)
        .setMaxLength(200)
    )
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Cooldown check
    const now = Date.now();
    const lastSent = cooldowns.get(interaction.user.id) || 0;
    if (now - lastSent < COOLDOWN_MS) {
      const remaining = ((COOLDOWN_MS - (now - lastSent)) / 1000).toFixed(1);
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Cooldown: chờ thêm **${remaining}s** trước khi gửi tiếp.`
          ),
        ],
      });
    }

    const message = interaction.options.getString('message');

    // Validate message
    const validation = validateChatMessage(message);
    if (!validation.valid) {
      return interaction.editReply({ embeds: [errorEmbed(validation.reason)] });
    }

    // Resolve an exact canonical ID or an owner-scoped saved selection.
    let instance;
    try {
      instance = BotManager.resolveAuthorizedBot(
        principal,
        interaction.options.getString('id')?.trim() || null,
        { allowSelection: true }
      );
    } catch (err) {
      return interaction.editReply({
        embeds: [
          errorEmbed(safeErrorMessage(err, 'Bot not found or access denied.')),
        ],
      });
    }

    if (!ALIVE_STATES.has(instance.state)) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Bot đang ở trạng thái **${instance.state}** — không thể gửi chat.`
          ),
        ],
      });
    }

    try {
      await BotManager.chatBot(principal, instance.id, message);
      cooldowns.set(interaction.user.id, Date.now());
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Message Sent',
            `**Bot:** \`${instance.record.username}\`\n**Nội dung:** ${message}`
          ),
        ],
      });
    } catch (err) {
      logger.error(`[chat] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not send message.'))],
      });
    }
  },
};
