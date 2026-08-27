const { EventEmitter } = require('node:events');

const eventHub = new EventEmitter();
eventHub.setMaxListeners(0);
const { subscribeBotLogs } = require('../../services/logger');

function publish(event, data) {
  eventHub.emit('event', {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    event,
    data,
  });
}

// Logger events are emitted independently of the web server. Bridge them
// once at module scope so all same-origin SSE subscribers receive live logs.
subscribeBotLogs((entry) => publish('bot:log', entry));

function subscribe(listener) {
  eventHub.on('event', listener);
  return () => eventHub.off('event', listener);
}

module.exports = { publish, subscribe };
