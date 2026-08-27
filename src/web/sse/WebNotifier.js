const { publish } = require('./eventHub');

function snapshot(instance) {
  return typeof instance?.toJSON === 'function' ? instance.toJSON() : instance;
}

function attachWebNotifier(instance) {
  const onState = (_oldState, state) =>
    publish('bot:state', {
      botId: instance.id,
      state,
      snapshot: snapshot(instance),
    });
  const onHealth = (metrics) =>
    publish('bot:health', {
      botId: instance.id,
      ...metrics,
      snapshot: snapshot(instance),
    });

  instance.on('stateChange', onState);
  instance.on('healthUpdate', onHealth);

  return () => {
    instance.off('stateChange', onState);
    instance.off('healthUpdate', onHealth);
  };
}

function createWebNotifier(botManager) {
  const detachments = new Map();

  for (const instance of botManager.listAllInstances?.() || []) {
    detachments.set(instance.id, attachWebNotifier(instance));
  }

  return {
    attach(instance) {
      detachments.get(instance.id)?.();
      detachments.set(instance.id, attachWebNotifier(instance));
    },
    detach(botId) {
      detachments.get(botId)?.();
      detachments.delete(botId);
    },
    publishCreated(instance) {
      publish('bot:created', { snapshot: snapshot(instance) });
    },
    publishUpdated(instance) {
      publish('bot:updated', { snapshot: snapshot(instance) });
    },
    publishDeleted(botId) {
      publish('bot:deleted', { botId });
    },
    close() {
      for (const detach of detachments.values()) detach();
      detachments.clear();
    },
  };
}

module.exports = { attachWebNotifier, createWebNotifier };
