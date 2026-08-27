import { useEffect } from 'react';
import { useDashboardStore } from '../state/dashboardStore';

const EVENTS = [
  'bot:snapshot',
  'bot:created',
  'bot:updated',
  'bot:state',
  'bot:health',
  'bot:log',
  'bot:deleted',
];

export function useSse(enabled = true) {
  const upsertBot = useDashboardStore((state) => state.upsertBot);
  const removeBot = useDashboardStore((state) => state.removeBot);
  const appendLog = useDashboardStore((state) => state.appendLog);

  useEffect(() => {
    if (!enabled) return undefined;
    const source = new EventSource('/api/events', { withCredentials: true });
    const handlers = [];

    const addHandler = (eventName, handler) => {
      const listener = (event) => {
        try {
          handler({ ...JSON.parse(event.data), _eventId: event.lastEventId });
        } catch {
          /* Ignore malformed transient events. */
        }
      };
      source.addEventListener(eventName, listener);
      handlers.push(() => source.removeEventListener(eventName, listener));
    };

    addHandler(
      'bot:snapshot',
      ({ snapshot }) => snapshot && upsertBot(snapshot)
    );
    addHandler(
      'bot:created',
      ({ snapshot }) => snapshot && upsertBot(snapshot)
    );
    addHandler(
      'bot:updated',
      ({ snapshot }) => snapshot && upsertBot(snapshot)
    );
    addHandler('bot:state', ({ snapshot }) => snapshot && upsertBot(snapshot));
    addHandler('bot:health', ({ snapshot }) => snapshot && upsertBot(snapshot));
    addHandler('bot:log', (log) => log.botId && appendLog(log.botId, log));
    addHandler('bot:deleted', ({ botId }) => botId && removeBot(botId));
    addHandler('auth:revoked', () =>
      window.location.assign('/login?expired=1')
    );

    return () => {
      handlers.forEach((remove) => remove());
      source.close();
    };
  }, [appendLog, enabled, removeBot, upsertBot]);
}

export { EVENTS };
