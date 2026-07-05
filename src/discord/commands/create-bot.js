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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-bot')
    .setDescription('Tạo một Minecraft AFK bot mới')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('host').setDescription('Server IP / hostname').setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('port')
        .setDescription('Server port (1-65535)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(65535)
    )
    .addStringOption((o) =>
      o
        .setName('username')
        .setDescription('Tên nhân vật (3-16 ký tự)')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(16)
    )
    .addStringOption((o) =>
      o
        .setName('version')
        .setDescription('Minecraft version (vd: 1.20.4)')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('password')
        .setDescription('Mật khẩu AuthMe (để trống nếu offline)')
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o
        .setName('auto-reconnect')
        .setDescription('Tự động kết nối lại khi mất kết nối (mặc định: true)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const host = interaction.options.getString('host');
    const port = interaction.options.getInteger('port');
    const username = interaction.options.getString('username');
    const version = interaction.options.getString('version');
    const password = interaction.options.getString('password') || '';
    const autoReconnect =
      interaction.options.getBoolean('auto-reconnect') ?? true;

    try {
      const { id, record } = await BotManager.createBot(
        { host, port, username, password, version, autoReconnect },
        interaction.user.id
      );

      const embed = successEmbed(
        'Bot Created',
        [
          `**Username:** \`${username}\``,
          `**Server:** \`${host}:${port}\``,
          `**Version:** \`${version}\``,
          `**Auto-Reconnect:** ${autoReconnect ? '✅' : '❌'}`,
          `**Bot ID:** \`${id}\``,
          '',
          `Dùng \`/start\` để khởi động bot.`,
        ].join('\n')
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error(`[create-bot] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not create bot.'))],
      });
    }
  },
};
