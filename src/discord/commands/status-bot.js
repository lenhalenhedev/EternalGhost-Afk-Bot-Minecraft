'use strict';
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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

  async execute(interaction) {
    await interaction.deferReply();

    const partial = interaction.options.getString('id')?.trim();
    const instance = partial
      ? BotManager.getAllBots().find(
          (b) => b.id.startsWith(partial) || b.id === partial
        )
      : BotManager.getUserSelection(interaction.user.id);

    if (!instance) {
      const hint = partial
        ? `Không tìm thấy bot \`${partial}\`.`
        : 'Chưa chọn bot. Dùng `/select-bot` trước hoặc cung cấp ID.';
      return interaction.editReply({ embeds: [errorEmbed(hint)] });
    }

    await interaction.editReply({ embeds: [buildStatusEmbed(instance)] });
  },
};
