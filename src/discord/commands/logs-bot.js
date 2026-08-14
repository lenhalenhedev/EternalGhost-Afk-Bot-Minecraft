'use strict';
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { getBotLogs } = require('../../services/logger');
const { redactDiagnostic } = require('../../utils/security');
const { errorEmbed } = require('../embeds');

const LEVEL_EMOJI = { info: 'ℹ️', warn: '⚠️', error: '❌', debug: '🔍' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs-bot')
    .setDescription('Xem log gần nhất của bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName('id')
        .setDescription('Bot ID (để trống = dùng bot đang chọn)')
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName('lines')
        .setDescription('Số dòng log (tối đa 50, mặc định 30)')
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName('hours')
        .setDescription(
          'Lọc trong bao nhiêu giờ gần nhất (1-24, mặc định: không giới hạn)'
        )
        .setMinValue(1)
        .setMaxValue(24)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('level')
        .setDescription('Lọc theo level')
        .setRequired(false)
        .addChoices(
          { name: 'ALL', value: 'all' },
          { name: 'INFO', value: 'info' },
          { name: 'WARN', value: 'warn' },
          { name: 'ERROR', value: 'error' },
          { name: 'DEBUG', value: 'debug' }
        )
    ),

  async execute(interaction, principal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let instance;
    try {
      instance = BotManager.resolveAuthorizedBot(
        principal,
        interaction.options.getString('id')?.trim() || null,
        { allowSelection: true }
      );
    } catch {
      return interaction.editReply({
        embeds: [errorEmbed('Bot not found or access denied.')],
      });
    }

    const lines = interaction.options.getInteger('lines') ?? 30;
    const hours = interaction.options.getInteger('hours') ?? 0;
    const level = interaction.options.getString('level') ?? 'all';
    const maxAge = hours ? hours * 3_600_000 : 0;

    let entries = getBotLogs(instance.id, lines, maxAge);
    if (level !== 'all') entries = entries.filter((e) => e.level === level);

    if (entries.length === 0) {
      return interaction.editReply(
        '📭 Không có log nào phù hợp với điều kiện lọc.'
      );
    }

    // Build plain text (for file attachment if too long)
    const lines_text = entries.map((e) => {
      const ts = new Date(e.ts).toISOString().slice(11, 19);
      const em = LEVEL_EMOJI[e.level] || '•';
      return `[${ts}] ${em} [${e.level.toUpperCase()}] ${redactDiagnostic(e.msg)}`;
    });

    const raw = redactDiagnostic(lines_text.join('\n'));

    // If fits in Discord message (< 1900 chars), send inline; otherwise as file
    const header = `📋 **Logs: \`${instance.record.username}\`** (${entries.length} dòng${hours ? `, ${hours}h gần nhất` : ''})\n\`\`\`\n`;
    const footer = '\n```';

    if (header.length + raw.length + footer.length <= 1950) {
      await interaction.editReply(`${header}${raw}${footer}`);
    } else {
      const buf = Buffer.from(raw, 'utf8');
      const file = new AttachmentBuilder(buf, {
        name: `logs-${instance.id.slice(0, 8)}-${Date.now()}.txt`,
      });
      await interaction.editReply({
        content: `📋 Log quá dài – đã xuất file (**${entries.length} dòng**):`,
        files: [file],
      });
    }
  },
};
