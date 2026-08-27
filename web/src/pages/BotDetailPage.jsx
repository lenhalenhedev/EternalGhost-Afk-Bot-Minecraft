import { useEffect, useState } from 'react';
import { Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useDashboardStore } from '../state/dashboardStore';
import { useToastStore } from '../state/toastStore';
import { BotForm } from '../components/BotForm';
import { CommandBar } from '../components/CommandBar';
import { LogPanel } from '../components/LogPanel';
import { StatsPanel } from '../components/StatsPanel';
import { StatusBadge } from '../components/StatusBadge';

export function BotDetailPage({ botId }) {
  const bot = useDashboardStore((state) => state.bots[botId]);
  const upsertBot = useDashboardStore((state) => state.upsertBot);
  const setLogs = useDashboardStore((state) => state.setLogs);
  const selectBot = useDashboardStore((state) => state.selectBot);
  const push = useToastStore((state) => state.push);
  const [tab, setTab] = useState('log');

  useEffect(() => {
    let ignore = false;
    selectBot(botId);
    api
      .get(`/bots/${botId}`)
      .then(({ data }) => {
        if (ignore) return;
        upsertBot(data.bot);
        setLogs(botId, data.logs || []);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [botId, selectBot, setLogs, upsertBot]);

  if (!bot)
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold">Bot not found</h1>
        <p className="mt-2 text-sm text-text-secondary">
          This bot may have been deleted or is not assigned to your account.
        </p>
      </div>
    );

  const action = async (name) => {
    try {
      const { data } = await api.post(`/bots/${botId}/${name}`);
      upsertBot(data.bot);
      push(`${name[0].toUpperCase()}${name.slice(1)} request completed.`);
    } catch (error) {
      push(errorMessage(error, `Could not ${name} bot.`), 'error');
    }
  };
  const remove = async () => {
    if (bot.state !== 'OFFLINE') {
      push('Stop the bot before deleting it.', 'error');
      return;
    }
    if (
      !window.confirm(
        `Delete ${bot.label || bot.username}? This cannot be undone.`
      )
    )
      return;
    try {
      await api.delete(`/bots/${botId}`);
      push('Bot deleted.');
      window.location.assign('/dashboard');
    } catch (error) {
      push(errorMessage(error, 'Could not delete bot.'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <header className="panel flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-lg font-semibold">
              {bot.label || bot.username}
            </h1>
            <StatusBadge state={bot.state} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-text-secondary">
            {bot.username}@{bot.host}:{bot.port} · {bot.version}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => action('start')}
            disabled={!['OFFLINE', 'ERROR', 'DISCONNECTED'].includes(bot.state)}
          >
            <Play size={15} /> Start
          </button>
          <button
            className="btn-secondary"
            onClick={() => action('stop')}
            disabled={bot.state === 'OFFLINE'}
          >
            <Square size={15} /> Stop
          </button>
          <button
            className="btn-secondary"
            onClick={() => action('restart')}
            disabled={bot.state === 'OFFLINE'}
          >
            <RefreshCw size={15} /> Restart
          </button>
          <button className="btn-danger" onClick={remove}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </header>
      <CommandBar botId={botId} />
      <div className="flex gap-1 border-b border-border">
        <Tab active={tab === 'log'} onClick={() => setTab('log')}>
          Log
        </Tab>
        <Tab
          active={tab === 'configuration'}
          onClick={() => setTab('configuration')}
        >
          Configuration
        </Tab>
        <Tab active={tab === 'statistics'} onClick={() => setTab('statistics')}>
          Statistics
        </Tab>
      </div>
      {tab === 'log' && <LogPanel botId={botId} />}
      {tab === 'configuration' && (
        <div className="panel p-4">
          <BotForm bot={bot} />
        </div>
      )}
      {tab === 'statistics' && <StatsPanel bot={bot} />}
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      className={`border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
