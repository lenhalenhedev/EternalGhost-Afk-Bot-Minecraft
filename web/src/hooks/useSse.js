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
  'auth:revoked',
  'auth:expired',
];
const CHANNEL_NAME = 'eternalghost-dashboard-sse';
const HEARTBEAT_MS = 1_000;
const LEADER_TIMEOUT_MS = 4_000;
const MAX_BACKOFF_MS = 30_000;

function applyEvent(eventName, event, stores) {
  if (eventName === 'auth:revoked' || eventName === 'auth:expired') {
    window.dispatchEvent(new CustomEvent('app:session-expired'));
    return;
  }
  let payload;
  try {
    payload = { ...JSON.parse(event.data), _eventId: event.lastEventId };
  } catch {
    return;
  }
  if (
    eventName === 'bot:snapshot' ||
    eventName === 'bot:created' ||
    eventName === 'bot:updated' ||
    eventName === 'bot:state' ||
    eventName === 'bot:health'
  ) {
    if (payload.snapshot) stores.upsertBot(payload.snapshot);
  } else if (eventName === 'bot:log' && payload.botId) {
    stores.appendLog(payload.botId, payload);
  } else if (eventName === 'bot:deleted' && payload.botId) {
    stores.removeBot(payload.botId);
  }
}

export function useSse(enabled = true) {
  const upsertBot = useDashboardStore((state) => state.upsertBot);
  const removeBot = useDashboardStore((state) => state.removeBot);
  const appendLog = useDashboardStore((state) => state.appendLog);
  const userId = useDashboardStore((state) => state.user?.userId);

  useEffect(() => {
    if (!enabled) return undefined;
    const stores = { upsertBot, removeBot, appendLog };
    const tabId = crypto.randomUUID();
    const channel =
      typeof BroadcastChannel === 'function'
        ? new BroadcastChannel(`${CHANNEL_NAME}:${userId}`)
        : null;
    let source;
    let role = channel ? 'slave' : 'master';
    let lastHeartbeat = 0;
    let heartbeatTimer;
    let electionTimer;
    let reconnectTimer;
    let reconnectAttempt = 0;
    let stopped = false;

    const send = (message) =>
      channel?.postMessage({ ...message, senderId: tabId });
    const closeSource = () => {
      if (source) source.close();
      source = undefined;
    };
    const broadcastEvent = (eventName, event) => {
      send({
        type: 'sse-event',
        eventName,
        data: event.data,
        lastEventId: event.lastEventId,
      });
      applyEvent(eventName, event, stores);
    };
    const scheduleReconnect = () => {
      if (stopped || role !== 'master') return;
      const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** reconnectAttempt);
      const jitter = Math.floor(Math.random() * Math.max(250, base * 0.25));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(
        openSource,
        Math.min(MAX_BACKOFF_MS, base + jitter)
      );
    };
    const openSource = () => {
      if (stopped || role !== 'master' || source) return;
      source = new EventSource('/api/events', { withCredentials: true });
      source.onopen = () => {
        reconnectAttempt = 0;
      };
      EVENTS.forEach((eventName) => {
        source.addEventListener(eventName, (event) =>
          broadcastEvent(eventName, event)
        );
      });
      source.onerror = () => {
        closeSource();
        scheduleReconnect();
      };
    };
    const becomeSlave = () => {
      role = 'slave';
      closeSource();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
    const becomeMaster = () => {
      if (stopped) return;
      role = 'master';
      send({ type: 'leader', leaderId: tabId });
      openSource();
    };
    const startElection = () => {
      if (!channel || stopped || role === 'master') return;
      channel.postMessage({ type: 'election', senderId: tabId });
      window.clearTimeout(electionTimer);
      electionTimer = window.setTimeout(
        () => {
          if (Date.now() - lastHeartbeat >= LEADER_TIMEOUT_MS) becomeMaster();
        },
        50 + Math.floor(Math.random() * 100)
      );
    };

    if (channel) {
      channel.onmessage = ({ data }) => {
        if (!data || data.senderId === tabId) return;
        if (data.type === 'hello' && role === 'master') {
          send({ type: 'leader', leaderId: tabId });
        } else if (data.type === 'leader') {
          lastHeartbeat = Date.now();
          if (role === 'master' && data.leaderId < tabId) becomeSlave();
        } else if (data.type === 'heartbeat') {
          lastHeartbeat = Date.now();
          if (role === 'master' && data.leaderId < tabId) becomeSlave();
        } else if (data.type === 'sse-event') {
          applyEvent(
            data.eventName,
            { data: data.data, lastEventId: data.lastEventId },
            stores
          );
        } else if (data.type === 'election') {
          if (role === 'master') send({ type: 'leader', leaderId: tabId });
          else if (data.senderId < tabId) startElection();
        }
      };
      heartbeatTimer = window.setInterval(() => {
        if (role === 'master') send({ type: 'heartbeat', leaderId: tabId });
        else if (Date.now() - lastHeartbeat > LEADER_TIMEOUT_MS)
          startElection();
      }, HEARTBEAT_MS);
      send({ type: 'hello' });
      startElection();
    } else {
      openSource();
    }

    return () => {
      stopped = true;
      window.clearInterval(heartbeatTimer);
      window.clearTimeout(electionTimer);
      window.clearTimeout(reconnectTimer);
      closeSource();
      channel?.close();
    };
  }, [appendLog, enabled, removeBot, upsertBot, userId]);
}

export { EVENTS };
