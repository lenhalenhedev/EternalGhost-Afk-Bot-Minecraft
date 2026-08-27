import { CheckCircle2, XCircle } from 'lucide-react';
import { useToastStore } from '../state/toastStore';

export function Toasts() {
  const items = useToastStore((state) => state.items);
  return (
    <div
      className="fixed right-4 top-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`panel flex items-start gap-2 px-3 py-2 text-sm ${item.tone === 'error' ? 'border-red-400/50 text-status-error' : 'border-green-400/50 text-status-online'}`}
        >
          {item.tone === 'error' ? (
            <XCircle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
