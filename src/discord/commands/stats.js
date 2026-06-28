'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const BotManager = require('../../manager/BotManager');
const { buildStatsEmbed } = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription(
      'Kiểm tra tình trạng hệ thống (RAM, Uptime, số bot đang chạy)'
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const stats = BotManager.getStats();
    const bots = BotManager.getAllBots();
    const embed = buildStatsEmbed(stats, bots);

    // Detailed per-bot state table (top 20)
    const topBots = bots.slice(0, 20);
    if (topBots.length > 0) {
      const { STATE_EMOJI } = require('../../bot/states');
      const rows = topBots.map(
        (b) =>
          `${STATE_EMOJI[b.state] || '⚫'} \`${b.record.username}\`@\`${b.record.host}\` — **${b.state}**`
      );
      embed.addFields({
        name: `🤖 Bots (${topBots.length}/${bots.length})`,
        value: rows.join('\n') || 'None',
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
