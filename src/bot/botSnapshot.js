'use strict';

/**
 * Serialise a BotInstance into a plain status object for Discord embeds and
 * persistence. Kept separate so the read-model shape lives in one place.
 */
function toSnapshot(instance) {
  const r = instance.record;
  return {
    id: instance.id,
    host: r.host,
    port: r.port,
    username: r.username,
    version: r.version,
    state: instance.state,
    uptime: instance.uptime,
    health: instance.health,
    food: instance.food,
    ping: instance.ping,
    position: instance.position,
    reconnectAttempts: instance.reconnectAttempts,
    autoReconnect: r.autoReconnect,
  };
}

module.exports = { toSnapshot };
