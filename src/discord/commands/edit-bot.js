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
    .addStringOption((o) =>
      o
        .setName('label')
        .setDescription('Display label mới')
        .setMaxLength(80)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('username')
        .setDescription('Tên nhân vật mới')
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(false)
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

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let instance;
    try {
      instance = BotManager.resolveAuthorizedBot(
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
    const label = interaction.options.getString('label');
    const username = interaction.options.getString('username');
    const port = interaction.options.getInteger('port');
    const version = interaction.options.getString('version');
    const password = interaction.options.getString('password');
    const autoReconnect = interaction.options.getBoolean('auto-reconnect');

    if (host !== null) patch.host = host;
    if (label !== null) patch.label = label;
    if (username !== null) patch.username = username;
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
      await BotManager.editBot(principal, instance.id, patch);
      const changed = Object.keys(patch)
        .filter((k) => k !== 'password')
        .join(', ');
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Bot Updated',
            `Đã cập nhật: \`${changed || 'password'}\`\nBot ID: \`${instance.id}\``
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
