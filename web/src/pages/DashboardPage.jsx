import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate, useSearchParams } from 'react-router';
import { BotForm } from '../components/BotForm';
import { StatusBadge } from '../components/StatusBadge';
import { useDashboardStore } from '../state/dashboardStore';

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bots = useDashboardStore(
    useShallow((state) => Object.values(state.bots))
  );
  const [creating, setCreating] = useState(searchParams.get('create') === '1');
  const groups = useMemo(
    () =>
      new Set(bots.map((bot) => bot.serverKey || `${bot.host}:${bot.port}`))
        .size,
    [bots]
  );
  if (creating)
    return (
      <section className="panel p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Create bot</h1>
            <p className="mt-1 text-sm text-text-secondary">
              The bot will be created stopped.
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
        <BotForm onSaved={(bot) => navigate(`/dashboard/${bot.id}`)} />
      </section>
    );
  if (!bots.length)
    return (
      <section className="panel flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-panel bg-accent/15 px-3 py-2 text-sm font-medium text-accent">
          No bots connected
        </div>
        <h1 className="text-xl font-semibold">Create your first bot</h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Add a Minecraft AFK bot to start monitoring status, logs, health, and
          connection metrics.
        </p>
        <button className="btn-primary mt-6" onClick={() => setCreating(true)}>
          Create your first bot
        </button>
      </section>
    );
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {bots.length} bots across {groups} server{groups === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-3">Bot</th>
              <th className="px-4 py-3">Server</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Ping</th>
              <th className="px-4 py-3">Players</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bots.map((bot) => (
              <tr
                key={bot.id}
                className="cursor-pointer hover:bg-canvas/70"
                onClick={() => navigate(`/dashboard/${bot.id}`)}
              >
                <td className="px-4 py-3 font-medium">
                  {bot.label || bot.username}
                  <div className="mt-1 font-mono text-xs text-text-secondary">
                    {bot.username}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {bot.host}:{bot.port}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge state={bot.state} />
                </td>
                <td className="px-4 py-3 font-mono">{bot.ping ?? '—'}</td>
                <td className="px-4 py-3 font-mono">
                  {bot.playerCount ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
