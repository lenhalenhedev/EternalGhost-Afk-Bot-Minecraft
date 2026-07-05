'use strict';
const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { successEmbed, errorEmbed } = require('../embeds');
const { ALIVE_STATES } = require('../../bot/states');
const { logger } = require('../../services/logger');
const { safeErrorMessage } = require('../safeError');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-bot')
    .setDescription('Chỉnh sửa cấu hình bot (cần stop bot trước nếu đang chạy)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('id').setDescription('Bot ID').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('host').setDescription('Server IP mới').setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName('port')
        .setDescription('Port mới')
        .setMinValue(1)
        .setMaxValue(65535)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('version')
        .setDescription('Version mới (vd: 1.20.4)')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('password').setDescription('Mật khẩu mới').setRequired(false)
    )
    .addBooleanOption((o) =>
      o
        .setName('auto-reconnect')
        .setDescription('Bật/tắt auto-reconnect')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const partial = interaction.options.getString('id').trim();
    const instance = BotManager.getAllBots().find(
      (b) => b.id.startsWith(partial) || b.id === partial
    );
    if (!instance) {
      return interaction.editReply({
        embeds: [errorEmbed(`Không tìm thấy bot \`${partial}\``)],
      });
    }

    // Warn if bot is alive
    if (ALIVE_STATES.has(instance.state)) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Bot đang ở trạng thái **${instance.state}**. Hãy dùng \`/stop\` trước khi chỉnh sửa.`
          ),
        ],
      });
    }

    const patch = {};
    const host = interaction.options.getString('host');
    const port = interaction.options.getInteger('port');
    const version = interaction.options.getString('version');
    const password = interaction.options.getString('password');
    const autoReconnect = interaction.options.getBoolean('auto-reconnect');

    if (host !== null) patch.host = host;
    if (port !== null) patch.port = port;
    if (version !== null) patch.version = version;
    if (password !== null) patch.password = password;
    if (autoReconnect !== null) patch.autoReconnect = autoReconnect;

    if (Object.keys(patch).length === 0) {
      return interaction.editReply({
        embeds: [errorEmbed('Không có thông tin nào được thay đổi.')],
      });
    }

    try {
      await BotManager.editBot(instance.id, patch, interaction.user.id);
      const changed = Object.keys(patch)
        .filter((k) => k !== 'password')
        .join(', ');
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Updated',
            `Đã cập nhật: \`${changed || 'password'}\`\nBot ID: \`${instance.id.slice(0, 8)}\``
          ),
        ],
      });
    } catch (err) {
      logger.error(`[edit-bot] ${err?.stack || err?.message || err}`);
      await interaction.editReply({
        embeds: [errorEmbed(safeErrorMessage(err, 'Could not update bot.'))],
      });
    }
  },
};
