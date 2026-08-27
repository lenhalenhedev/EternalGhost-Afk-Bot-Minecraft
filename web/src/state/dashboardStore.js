import { create } from 'zustand';

function logKey(log) {
  return `${log.ts}:${log.level}:${log.message}`;
}

function mergeLogs(current, incoming) {
  const byKey = new Map();
  for (const log of current) byKey.set(logKey(log), log);
  for (const log of Array.isArray(incoming) ? incoming : []) {
    if (!byKey.has(logKey(log))) byKey.set(logKey(log), log);
  }
  return [...byKey.values()]
    .sort((left, right) => Number(left.ts) - Number(right.ts))
    .slice(-500);
}

export const useDashboardStore = create((set) => ({
  bots: {},
  selectedBotId: null,
  logsByBot: {},
  user: null,
  setUser: (user) => set({ user }),
  setBots: (bots) =>
    set({ bots: Object.fromEntries(bots.map((bot) => [bot.id, bot])) }),
  upsertBot: (bot) =>
    set((state) => ({ bots: { ...state.bots, [bot.id]: bot } })),
  removeBot: (botId) =>
    set((state) => {
      const bots = { ...state.bots };
      delete bots[botId];
      const logsByBot = { ...state.logsByBot };
      delete logsByBot[botId];
      return {
        bots,
        logsByBot,
        selectedBotId:
          state.selectedBotId === botId ? null : state.selectedBotId,
      };
    }),
  selectBot: (selectedBotId) => set({ selectedBotId }),
  setLogs: (botId, logs) =>
    set((state) => ({
      logsByBot: {
        ...state.logsByBot,
        [botId]: mergeLogs(state.logsByBot[botId] || [], logs),
      },
    })),
  appendLog: (botId, log) =>
    set((state) => {
      const current = state.logsByBot[botId] || [];
      const merged = mergeLogs(current, [log]);
      if (merged.length === current.length) return state;
      return { logsByBot: { ...state.logsByBot, [botId]: merged } };
    }),
  clearLogs: (botId) =>
    set((state) => ({ logsByBot: { ...state.logsByBot, [botId]: [] } })),
  reset: () =>
    set({ bots: {}, selectedBotId: null, logsByBot: {}, user: null }),
}));
