import { Menu, Plus, Shield, X } from 'lucide-react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router';
import { useDashboardStore } from '../state/dashboardStore';
import { StatusBadge } from './StatusBadge';

export function Sidebar({ open, onToggle }) {
  const navigate = useNavigate();
  const bots = useDashboardStore(
    useShallow((state) => Object.values(state.bots))
  );
  const selectedBotId = useDashboardStore((state) => state.selectedBotId);
  const user = useDashboardStore((state) => state.user);
  const groups = useMemo(() => {
    const grouped = new Map();
    bots.forEach((bot) => {
      const key = bot.serverKey || `${bot.host}:${bot.port}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(bot);
    });
    return [...grouped.entries()];
  }, [bots]);

  const chooseBot = (botId) => {
    navigate(`/dashboard/${botId}`);
    onToggle(false);
  };

  return (
    <>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-text-primary/20 md:hidden"
          onClick={() => onToggle(false)}
          aria-label="Close navigation overlay"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(85vw,280px)] flex-col border-r border-border bg-surface transition-all duration-150 md:static md:z-auto ${open ? 'translate-x-0 md:w-60' : '-translate-x-full md:w-0 md:overflow-hidden'}`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              EternalGhost
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              Bot operations
            </div>
          </div>
          <button
            className="rounded-panel p-1.5 text-text-secondary hover:bg-canvas md:hidden"
            onClick={() => onToggle(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            <span>Bots</span>
            <span>{bots.length}</span>
          </div>
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-text-secondary">
              No bots yet.
            </p>
          ) : (
            groups.map(([server, serverBots]) => (
              <div key={server} className="mb-4">
                <div className="mb-1 truncate px-2 font-mono text-[11px] text-text-secondary">
                  {server}
                </div>
                <div className="space-y-1">
                  {serverBots.map((bot) => (
                    <button
                      key={bot.id}
                      onClick={() => chooseBot(bot.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-panel px-2 py-2 text-left text-sm hover:bg-canvas ${selectedBotId === bot.id ? 'bg-accent/15 text-accent' : 'text-text-primary'}`}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {bot.label || bot.username}
                      </span>
                      <StatusBadge state={bot.state} />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          <button
            className="btn-secondary mt-2 w-full"
            onClick={() => {
              navigate('/dashboard?create=1');
              onToggle(false);
            }}
          >
            <Plus size={16} /> Create bot
          </button>
        </div>
        <div className="space-y-1 border-t border-border p-3">
          {user?.isAdmin && (
            <button
              className="flex w-full items-center gap-2 rounded-panel px-2 py-2 text-sm text-text-secondary hover:bg-canvas"
              onClick={() => {
                navigate('/admin/tokens');
                onToggle(false);
              }}
            >
              <Shield size={16} /> Token management
            </button>
          )}
          <div className="truncate px-2 pt-2 text-xs text-text-secondary">
            ID: {user?.userId || '—'}
          </div>
        </div>
      </aside>
    </>
  );
}
