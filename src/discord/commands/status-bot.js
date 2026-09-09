'use strict';
const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { buildStatusEmbed, errorEmbed } = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status-bot')
    .setDescription('Xem trạng thái chi tiết của một bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    // EG-008: detailed live status for one bot must stay caller-only.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const instance = BotManager.resolveAuthorizedBot(
        principal,
        interaction.options.getString('id')?.trim() || null,
        { allowSelection: true }
      );
      await interaction.editReply({ embeds: [buildStatusEmbed(instance)] });
    } catch {
      await interaction.editReply({
        embeds: [errorEmbed('Bot not found or access denied.')],
      });
    }
  },
};
