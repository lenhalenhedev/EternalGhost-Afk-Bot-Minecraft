import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToastStore } from '../state/toastStore';

export function Toasts() {
  const items = useToastStore((state) => state.items);
  const modal = useToastStore((state) => state.modal);
  const closeModal = useToastStore((state) => state.closeModal);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!modal?.retryAfterMs) return undefined;
    const update = () =>
      setRemainingSeconds(
        Math.max(0, Math.ceil((modal.until - Date.now()) / 1_000))
      );
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [modal]);

  return (
    <>
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
      {modal && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="panel w-full max-w-md space-y-4 p-5">
            <h2 className="text-lg font-semibold">{modal.title}</h2>
            <p className="text-sm text-text-secondary">{modal.message}</p>
            {modal.retryAfterMs ? (
              <p className="text-sm text-text-secondary">
                Try again in <strong>{remainingSeconds}s</strong>.
              </p>
            ) : null}
            <button
              className="btn-primary"
              disabled={Boolean(modal.retryAfterMs && remainingSeconds > 0)}
              onClick={() => {
                closeModal();
                modal.onConfirm?.();
              }}
            >
              {modal.retryAfterMs && remainingSeconds > 0
                ? `Wait ${remainingSeconds}s`
                : modal.confirmLabel || 'OK'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
