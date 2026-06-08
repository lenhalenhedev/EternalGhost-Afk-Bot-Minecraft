'use strict';
const { EmbedBuilder } = require('discord.js');
const { STATE_COLORS, STATE_EMOJI } = require('../bot/states');
const { formatUptime, formatPos, formatMB } = require('../utils/helpers');

/**
 * Build a standard bot status embed.
 * @param {import('../../bot/BotInstance')} instance
 */
function buildStatusEmbed(instance) {
  const r     = instance.record;
  const state = instance.state;
  const color = STATE_COLORS[state] ?? 0x95a5a6;
  const emoji = STATE_EMOJI[state]  ?? '⚫';

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Bot Status — \`${r.username}\``)
    .setDescription(`Server: \`${r.host}:${r.port}\`  •  Version: \`${r.version}\``)
    .addFields(
      { name: '🔄 State',    value: state,                                    inline: true },
      { name: '⏱ Uptime',   value: formatUptime(instance.uptime),            inline: true },
      { name: '📶 Ping',     value: `${instance.ping} ms`,                   inline: true },
      { name: '❤️ HP',       value: `${instance.health.toFixed(1)} / 20`,    inline: true },
      { name: '🍗 Food',     value: `${instance.food} / 20`,                 inline: true },
      { name: '📍 Position', value: formatPos(instance.position),            inline: true },
      { name: '🔁 Reconnects', value: String(instance._reconnectAttempts),   inline: true },
      { name: '🤖 Auto-Reconnect', value: r.autoReconnect ? '✅' : '❌',    inline: true },
      { name: '🆔 Bot ID',   value: `\`${instance.id.slice(0, 8)}\``,        inline: true },
    )
    .setFooter({ text: `Full ID: ${instance.id}` })
    .setTimestamp();
}

/**
 * Build a compact one-line field for /list-bot.
 * @param {import('../../bot/BotInstance')} instance
 * @param {boolean} isSelected  – mark if this is the user's active bot
 */
function buildListEntry(instance, isSelected = false) {
  const r     = instance.record;
  const emoji = STATE_EMOJI[instance.state] ?? '⚫';
  const sel   = isSelected ? ' ⭐' : '';
  return `${emoji}${sel} \`${r.username}\`@\`${r.host}:${r.port}\` — **${instance.state}** — \`${instance.id.slice(0, 8)}\``;
}

/**
 * Build a generic success embed.
 */
function successEmbed(title, description = '') {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`✅ ${title}`)
    .setDescription(description || '')
    .setTimestamp();
}

/**
 * Build a generic error embed.
 */
function errorEmbed(description) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌ Error')
    .setDescription(description)
    .setTimestamp();
}

/**
 * Build a stats embed for /stats.
 * @param {object} stats  – from BotManager.getStats()
 * @param {import('../../bot/BotInstance')[]} bots
 */
function buildStatsEmbed(stats, bots) {
  const { BOT_STATES, STATE_EMOJI } = require('../bot/states');

  const stateCounts = {};
  for (const b of bots) {
    stateCounts[b.state] = (stateCounts[b.state] || 0) + 1;
  }
  const stateLines = Object.entries(stateCounts)
    .map(([s, n]) => `${STATE_EMOJI[s] || '⚫'} ${s}: **${n}**`)
    .join('\n') || 'No bots';

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 System Stats')
    .addFields(
      { name: '⏱ Node.js Uptime',      value: formatUptime(stats.uptime * 1000),    inline: true },
      { name: '🤖 Total Bots',          value: String(stats.totalBots),              inline: true },
      { name: '🟢 Alive Bots',          value: String(stats.aliveBots),              inline: true },
      { name: '🧠 Heap Used',           value: formatMB(stats.memHeapUsed),          inline: true },
      { name: '💾 RSS',                 value: formatMB(stats.memRSS),               inline: true },
      { name: '📦 Est. /bot RAM',       value: `~${stats.estimatedPerBotMB} MB`,     inline: true },
      { name: '📋 Bot States',          value: stateLines,                           inline: false },
    )
    .setTimestamp();
}

module.exports = { buildStatusEmbed, buildListEntry, successEmbed, errorEmbed, buildStatsEmbed };
