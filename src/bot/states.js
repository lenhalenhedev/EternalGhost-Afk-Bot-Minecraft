'use strict';

/**
 * State machine for each BotInstance.
 *
 * Transition diagram:
 *
 *   OFFLINE ──start──▶ CONNECTING ──login──▶ AUTHENTICATING ──auth ok──▶ PLAYING ──settle──▶ AFK
 *                                │                                                          ▲   │
 *                                │                                           mob attacks ───┘   │
 *                                │                                                        COMBAT ┘
 *   ANY ──error/kick──▶ ERROR ──▶ DISCONNECTED ──autoReconnect──▶ RECONNECTING ──▶ CONNECTING
 *   /stop ──▶ OFFLINE (immediate, cancels all timers)
 */
const BOT_STATES = Object.freeze({
  OFFLINE:         'OFFLINE',
  CONNECTING:      'CONNECTING',
  AUTHENTICATING:  'AUTHENTICATING',
  PLAYING:         'PLAYING',
  AFK:             'AFK',
  COMBAT:          'COMBAT',
  ERROR:           'ERROR',
  DISCONNECTED:    'DISCONNECTED',
  RECONNECTING:    'RECONNECTING',
});

/** States that mean the bot is "alive" (mineflayer instance exists). */
const ALIVE_STATES = new Set([
  BOT_STATES.CONNECTING,
  BOT_STATES.AUTHENTICATING,
  BOT_STATES.PLAYING,
  BOT_STATES.AFK,
  BOT_STATES.COMBAT,
]);

/** States from which /start can be issued. */
const STARTABLE_STATES = new Set([
  BOT_STATES.OFFLINE,
  BOT_STATES.DISCONNECTED,
  BOT_STATES.ERROR,
]);

/** States from which /stop can be issued. */
const STOPPABLE_STATES = new Set([
  BOT_STATES.CONNECTING,
  BOT_STATES.AUTHENTICATING,
  BOT_STATES.PLAYING,
  BOT_STATES.AFK,
  BOT_STATES.COMBAT,
  BOT_STATES.RECONNECTING,
  BOT_STATES.ERROR,
  BOT_STATES.DISCONNECTED,
]);

/** State colour map for Discord embeds. */
const STATE_COLORS = {
  [BOT_STATES.OFFLINE]:        0x95a5a6,
  [BOT_STATES.CONNECTING]:     0x3498db,
  [BOT_STATES.AUTHENTICATING]: 0x9b59b6,
  [BOT_STATES.PLAYING]:        0x2ecc71,
  [BOT_STATES.AFK]:            0xf1c40f,
  [BOT_STATES.COMBAT]:         0xe74c3c,
  [BOT_STATES.ERROR]:          0xe74c3c,
  [BOT_STATES.DISCONNECTED]:   0x7f8c8d,
  [BOT_STATES.RECONNECTING]:   0xe67e22,
};

/** State emoji map for Discord displays. */
const STATE_EMOJI = {
  [BOT_STATES.OFFLINE]:        '⚫',
  [BOT_STATES.CONNECTING]:     '🔵',
  [BOT_STATES.AUTHENTICATING]: '🟣',
  [BOT_STATES.PLAYING]:        '🟢',
  [BOT_STATES.AFK]:            '🟡',
  [BOT_STATES.COMBAT]:         '🔴',
  [BOT_STATES.ERROR]:          '❌',
  [BOT_STATES.DISCONNECTED]:   '⚪',
  [BOT_STATES.RECONNECTING]:   '🟠',
};

module.exports = { BOT_STATES, ALIVE_STATES, STARTABLE_STATES, STOPPABLE_STATES, STATE_COLORS, STATE_EMOJI };
