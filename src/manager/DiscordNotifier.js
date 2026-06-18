'use strict';

const { EmbedBuilder } = require('discord.js');
const { logger } = require('../services/logger');

const EMBED_DESCRIPTION_LIMIT = 4_000;

const ALERT_EMOJI = {
  death: '\u{1F480}',
  disconnect: '\u{1F50C}',
  loginFailed: '\u{1F510}',
  reconnectFailed: '\u{1F504}',
  noFood: '\u{1F356}',
  inventoryFull: '\u{1F392}',
};

/**
 * Owns all outbound Discord messaging (alerts, log summaries, audit log).
 *
 * Extracted from BotManager so the manager no longer mixes orchestration with
 * Discord rendering. The current client is read lazily via `getClient` because
 * it is injected only after login.
 */
class DiscordNotifier {
  /**
   * @param {object} opts
   * @param {() => (import('discord.js').Client|null)} opts.getClient
   * @param {string} [opts.alertChannelId]
   * @param {string} [opts.auditChannelId]
   */
  constructor({ getClient, alertChannelId, auditChannelId, logChannelId }) {
    this._getClient = getClient;
    this._alertChannelId = alertChannelId;
    this._auditChannelId = auditChannelId;
    this._logChannelId = logChannelId;
  }

  /** Channel for bug/error logs + summaries (falls back to the alert channel). */
  _logTarget() {
    return this._logChannelId || this._alertChannelId;
  }

  /** Channel for alerts (falls back to the log channel so something always shows). */
  _alertTarget() {
    return this._alertChannelId || this._logChannelId;
  }

  async _fetchTextChannel(channelId) {
    const client = this._getClient();
    if (!client || !channelId) return null;
    const channel = await client.channels.fetch(channelId);
    return channel && channel.isTextBased() ? channel : null;
  }

  async sendAlert(instance, type, message) {
    try {
      const channel = await this._fetchTextChannel(this._alertTarget());
      if (!channel) return;
      const emoji = ALERT_EMOJI[type] || '\u26A0\uFE0F';
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`${emoji} Bot Alert \u2014 ${type}`)
        .setDescription(message)
        .addFields(
          { name: 'Bot', value: `\`${instance.record.username}\`@\`${instance.record.host}:${instance.record.port}\``, inline: true },
          { name: 'State', value: instance.state, inline: true },
          { name: 'Bot ID', value: `\`${instance.id.slice(0, 8)}\``, inline: true },
        )
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`[DiscordNotifier] Failed to send alert: ${err.message}`);
    }
  }

  /** Post a runtime/bug error to the dedicated log channel. */
  async sendErrorLog(instance, context, err) {
    try {
      const channel = await this._fetchTextChannel(this._logTarget());
      if (!channel) return;
      const detail = (err && (err.stack || err.message)) || String(err);
      const embed = new EmbedBuilder()
        .setColor(0xc0392b)
        .setTitle('\u{1F6A8} Bot Error')
        .setDescription(`\`\`\`\n${String(detail).slice(0, 1_800)}\n\`\`\``)
        .addFields(
          { name: 'Context', value: context || 'runtime error', inline: false },
          { name: 'Bot', value: `\`${instance.record.username}\`@\`${instance.record.host}:${instance.record.port}\``, inline: true },
          { name: 'State', value: instance.state, inline: true },
          { name: 'Bot ID', value: `\`${instance.id.slice(0, 8)}\``, inline: true },
        )
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    } catch (sendErr) {
      logger.error(`[DiscordNotifier] Failed to send error log: ${sendErr.message}`);
    }
  }

  async sendLogSummary(summary) {
    if (!summary) return;
    try {
      const channel = await this._fetchTextChannel(this._logTarget());
      if (!channel) return;
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('\u{1F4CB} System Log Summary')
        .setDescription(summary.slice(0, EMBED_DESCRIPTION_LIMIT))
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`[DiscordNotifier] Log summary send failed: ${err.message}`);
    }
  }

  async sendAudit(action, userId, meta = {}) {
    try {
      const channel = await this._fetchTextChannel(this._auditChannelId);
      if (!channel) return;
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('\u{1F4DD} Audit Log')
        .addFields(
          { name: 'Action', value: action, inline: true },
          { name: 'User ID', value: userId, inline: true },
          { name: 'Details', value: `\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`` },
        )
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`[DiscordNotifier] Audit log send failed: ${err.message}`);
    }
  }
}

module.exports = DiscordNotifier;
