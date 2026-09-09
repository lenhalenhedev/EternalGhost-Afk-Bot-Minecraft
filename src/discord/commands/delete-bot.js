'use strict';
const crypto = require('node:crypto');
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

const CONFIRM_TIMEOUT_MS = 30_000;

/** Fresh per-dialog secret so two open prompts can never satisfy each other. */
function newDialogNonce() {
  return crypto.randomBytes(9).toString('hex');
}

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

    // EG-009: every dialog used the same two component IDs and the collector
    // filtered only on the clicking user, so one Confirm click could satisfy
    // every other open dialog for the same administrator and delete a target
    // the click never pointed at. Each dialog now carries a random nonce plus
    // the resolved bot ID in its component IDs, and the collector additionally
    // requires the interaction to belong to this exact prompt message.
    const nonce = newDialogNonce();
    const confirmId = `confirm_delete:${nonce}:${match.id}`;
    const cancelId = `cancel_delete:${nonce}:${match.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('✅ Xác nhận xóa')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('❌ Hủy')
        .setStyle(ButtonStyle.Secondary)
    );

    const r = match.record;
    const prompt = await interaction.editReply({
      content: `⚠️ Bạn có chắc muốn **xóa** bot \`${r.username}\`@\`${r.host}:${r.port}\` (\`${match.id}\`)?`,
      components: [row],
    });
    const promptId =
      prompt?.id ?? (await interaction.fetchReply?.())?.id ?? null;

    // Wait for a button click on *this* prompt only (30s timeout).
    let btn;
    try {
      btn = await interaction.channel.awaitMessageComponent({
        filter: (i) =>
          i.user?.id === interaction.user.id &&
          (i.customId === confirmId || i.customId === cancelId) &&
          (!promptId || i.message?.id === promptId),
        componentType: ComponentType.Button,
        time: CONFIRM_TIMEOUT_MS,
      });
    } catch {
      return interaction.editReply({
        content: '⏱ Hết thời gian xác nhận. Bot không bị xóa.',
        components: [],
      });
    }

    await btn.deferUpdate();

    if (btn.customId !== confirmId) {
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
