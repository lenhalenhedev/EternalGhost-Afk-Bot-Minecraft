import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDashboardStore } from '../state/dashboardStore';

const EMPTY_LOGS = Object.freeze([]);

export function LogPanel({ botId }) {
  const allLogs = useDashboardStore(
    (state) => state.logsByBot[botId] || EMPTY_LOGS
  );
  const clearLogs = useDashboardStore((state) => state.clearLogs);
  const [level, setLevel] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const parentRef = useRef(null);
  const logs = useMemo(
    () =>
      level === 'all' ? allLogs : allLogs.filter((log) => log.level === level),
    [allLogs, level]
  );
  const getItemKey = useCallback(
    (index) => {
      const log = logs[index];
      return log
        ? log._eventId || `${log.ts}:${log.level}:${log.message}`
        : index;
    },
    [logs]
  );
  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
    getItemKey,
    anchorTo: 'end',
    followOnAppend: autoScroll ? 'instant' : false,
    scrollEndThreshold: 24,
    useFlushSync: false,
  });

  useEffect(() => {
    if (autoScroll && logs.length)
      virtualizer.scrollToIndex(logs.length - 1, { align: 'end' });
  }, [autoScroll, logs.length, virtualizer]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Live log</span>
          <span className="font-mono text-xs text-text-secondary">
            {logs.length} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="log-level-filter"
            name="logLevel"
            className="field w-auto py-1.5"
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            aria-label="Filter log level"
          >
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-text-secondary">
            <input
              id="log-auto-scroll"
              name="autoScroll"
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />{' '}
            Auto-scroll
          </label>
          <button
            className="btn-secondary px-2 py-1.5"
            onClick={() => clearLogs(botId)}
          >
            <Trash2 size={15} /> Clear
          </button>
        </div>
      </div>
      <div
        ref={parentRef}
        className="h-[min(55vh,560px)] overflow-auto bg-log-bg px-3 py-2"
        role="log"
        aria-live="polite"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const log = logs[item.index];
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 right-0 flex min-w-0 items-start gap-3 py-1 font-mono text-xs leading-5"
                style={{
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <span className="shrink-0 text-log-muted">
                  {new Date(log.ts).toLocaleTimeString()}
                </span>
                <span
                  className={
                    log.level === 'error'
                      ? 'text-log-error'
                      : log.level === 'warn'
                        ? 'text-log-warn'
                        : 'text-log-text'
                  }
                >
                  [{log.level}]
                </span>
                <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-log-text">
                  {log.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
