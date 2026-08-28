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
const config = require('../../config');
const { safeErrorMessage } = require('../safeError');

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

    const message = interaction.options.getString('message');

    // Validate message
    const validation = validateChatMessage(
      message,
      config.web.allowedCommandPrefixes
    );
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
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Message Sent',
            `**Bot:** \`${instance.record.username}\`\n**Nội dung:** ${message}`
          ),
        ],
      });
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') {
        const remaining = (err.retryAfterMs / 1_000).toFixed(1);
        return interaction.editReply({
          embeds: [
            errorEmbed(
              `Cooldown: chờ thêm **${remaining}s** trước khi gửi tiếp.`
            ),
          ],
        });
      }
      logger.error({ err }, '[chat] Could not send message.');
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not send message.'))],
      });
    }
  },
};
