import { Activity, Clock3, Gauge, Heart, Users, Utensils } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

export function StatsPanel({ bot }) {
  const cards = [
    ['Uptime', formatUptime(bot.uptime), Clock3],
    ['Health', bot.health ?? '—', Heart],
    ['Food', bot.food ?? '—', Utensils],
    ['Ping', bot.ping == null ? '—' : `${bot.ping} ms`, Gauge],
    ['Players', bot.playerCount == null ? '—' : bot.playerCount, Users],
  ];
  return (
    <div className="space-y-4">
      <div className="panel flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">Current state</span>
        <StatusBadge state={bot.state} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, Icon]) => (
          <div className="panel p-4" key={label}>
            <div className="flex items-center justify-between text-text-secondary">
              <span className="text-xs uppercase tracking-wide">{label}</span>
              <Icon size={17} />
            </div>
            <div className="mt-3 font-mono text-xl font-semibold text-text-primary">
              {value}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-secondary">
        <Activity size={14} className="mr-1 inline" /> Values are shown from the
        bot runtime and updated through SSE.
      </p>
    </div>
  );
}

function formatUptime(value) {
  const seconds = Math.max(0, Math.floor(Number(value || 0) / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return days
    ? `${days}d ${hours}h ${minutes}m`
    : `${hours}h ${minutes}m ${rest}s`;
}
