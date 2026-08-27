import { Circle } from 'lucide-react';

const colors = {
  PLAYING: 'text-status-online',
  AFK: 'text-status-online',
  COMBAT: 'text-status-online',
  OFFLINE: 'text-status-offline',
  DISCONNECTED: 'text-status-offline',
  ERROR: 'text-status-error',
  CONNECTING: 'text-status-pending',
  AUTHENTICATING: 'text-status-pending',
  RECONNECTING: 'text-status-pending',
};

export function StatusBadge({ state = 'OFFLINE' }) {
  const color = colors[state] || 'text-text-secondary';
  const label = state.toLowerCase().replaceAll('_', ' ');
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium capitalize ${color}`}
    >
      <Circle size={9} fill="currentColor" aria-hidden="true" />
      {label}
    </span>
  );
}
