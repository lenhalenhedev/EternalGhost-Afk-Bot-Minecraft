'use strict';
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { successEmbed, errorEmbed } = require('../embeds');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-bot')
    .setDescription('Xóa một bot (sẽ stop bot trước nếu đang chạy)')
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (8 ký tự đầu hoặc đầy đủ)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const partial = interaction.options.getString('id').trim();

    // Resolve bot by prefix
    const all = BotManager.getAllBots();
    const match = all.find((b) => b.id.startsWith(partial) || b.id === partial);
    if (!match) {
      return interaction.editReply({
        embeds: [errorEmbed(`Không tìm thấy bot với ID \`${partial}\``)],
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
      content: `⚠️ Bạn có chắc muốn **xóa** bot \`${r.username}\`@\`${r.host}:${r.port}\` (\`${match.id.slice(0, 8)}\`)?`,
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
      await BotManager.deleteBot(match.id, interaction.user.id);
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
