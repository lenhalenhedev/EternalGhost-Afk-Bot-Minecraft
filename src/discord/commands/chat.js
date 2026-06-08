'use strict';
const { SlashCommandBuilder } = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { validateChatMessage } = require('../../utils/validators');
const { successEmbed, errorEmbed } = require('../embeds');
const { ALIVE_STATES } = require('../../bot/states');

// Per-user cooldown: userId -> lastSentTs
const cooldowns = new Map();
const COOLDOWN_MS = 2500;

// Whitelisted slash-commands the bot may send
const ALLOWED_COMMANDS = ['/register', '/login', '/spawn', '/home', '/back'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Gửi tin nhắn vào game Minecraft qua bot')
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Nội dung tin nhắn (tối đa 200 ký tự)')
        .setRequired(true)
        .setMaxLength(200)
    )
    .addStringOption(o =>
      o.setName('id').setDescription('Bot ID (để trống = dùng bot đang chọn)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Cooldown check
    const now      = Date.now();
    const lastSent = cooldowns.get(interaction.user.id) || 0;
    if (now - lastSent < COOLDOWN_MS) {
      const remaining = ((COOLDOWN_MS - (now - lastSent)) / 1000).toFixed(1);
      return interaction.editReply({ embeds: [errorEmbed(`Cooldown: chờ thêm **${remaining}s** trước khi gửi tiếp.`)] });
    }

    const message = interaction.options.getString('message');

    // Validate message
    const validation = validateChatMessage(message, ALLOWED_COMMANDS);
    if (!validation.valid) {
      return interaction.editReply({ embeds: [errorEmbed(validation.reason)] });
    }

    // Resolve bot
    const partial  = interaction.options.getString('id')?.trim();
    const instance = partial
      ? BotManager.getAllBots().find(b => b.id.startsWith(partial) || b.id === partial)
      : BotManager.getUserSelection(interaction.user.id);

    if (!instance) {
      const hint = partial ? `Không tìm thấy bot \`${partial}\`.` : 'Chưa chọn bot. Dùng `/select-bot` trước.';
      return interaction.editReply({ embeds: [errorEmbed(hint)] });
    }

    if (!ALIVE_STATES.has(instance.state)) {
      return interaction.editReply({ embeds: [errorEmbed(`Bot đang ở trạng thái **${instance.state}** — không thể gửi chat.`)] });
    }

    try {
      await BotManager.chatBot(instance.id, message);
      cooldowns.set(interaction.user.id, Date.now());
      await interaction.editReply({
        embeds: [successEmbed('Message Sent', `**Bot:** \`${instance.record.username}\`\n**Nội dung:** ${message}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
    }
  },
};
