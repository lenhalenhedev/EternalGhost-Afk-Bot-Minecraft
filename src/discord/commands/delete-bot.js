'use strict';
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { successEmbed, errorEmbed } = require('../embeds');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-bot')
    .setDescription('Xóa một bot (sẽ stop bot trước nếu đang chạy)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('id').setDescription('Full bot ID').setRequired(true)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let match;
    try {
      match = BotManager.resolveAuthorizedBot(
        principal,
        interaction.options.getString('id').trim()
      );
    } catch (err) {
      return interaction.editReply({
        embeds: [
          errorEmbed(safeErrorMessage(err, 'Bot not found or access denied.')),
        ],
      });
    }

    // Show confirm buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_delete')
        .setLabel('✅ Xác nhận xóa')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('❌ Hủy')
        .setStyle(ButtonStyle.Secondary)
    );

    const r = match.record;
    await interaction.editReply({
      content: `⚠️ Bạn có chắc muốn **xóa** bot \`${r.username}\`@\`${r.host}:${r.port}\` (\`${match.id}\`)?`,
      components: [row],
    });

    // Wait for button click (30s timeout)
    let btn;
    try {
      btn = await interaction.channel.awaitMessageComponent({
        filter: (i) =>
          i.user.id === interaction.user.id &&
          ['confirm_delete', 'cancel_delete'].includes(i.customId),
        componentType: ComponentType.Button,
        time: 30_000,
      });
    } catch {
      return interaction.editReply({
        content: '⏱ Hết thời gian xác nhận. Bot không bị xóa.',
        components: [],
      });
    }

    await btn.deferUpdate();

    if (btn.customId === 'cancel_delete') {
      return interaction.editReply({
        content: '❌ Đã hủy thao tác xóa.',
        components: [],
      });
    }

    try {
      await BotManager.deleteBot(principal, match.id);
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Deleted',
            `Bot \`${r.username}\` đã được xóa thành công.`
          ),
        ],
        components: [],
      });
    } catch (err) {
      logger.error(`[delete-bot] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not delete bot.'))],
        components: [],
      });
    }
  },
};
