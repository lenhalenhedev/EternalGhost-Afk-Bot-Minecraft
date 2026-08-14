'use strict';
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { buildListEntry } = require('../embeds');

const PAGE_SIZE = 15;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-bot')
    .setDescription('Danh sách tất cả các bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((o) =>
      o
        .setName('page')
        .setDescription('Trang (mặc định: 1)')
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction, principal) {
    await interaction.deferReply();

    const bots = BotManager.listAuthorizedBots(principal);
    if (bots.length === 0) {
      return interaction.editReply(
        '📭 Chưa có bot nào. Dùng `/create-bot` để tạo.'
      );
    }

    const page = interaction.options.getInteger('page') ?? 1;
    const totalPages = Math.ceil(bots.length / PAGE_SIZE);
    const slice = bots.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const selectedBot = BotManager.getUserSelection(principal);
    const lines = slice.map((b) => buildListEntry(b, selectedBot?.id === b.id));

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`🤖 Bot List (${bots.length} tổng cộng)`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Trang ${page}/${totalPages}  •  ⭐ = bot đang chọn` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
