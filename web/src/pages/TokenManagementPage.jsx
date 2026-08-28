import { useEffect, useState } from 'react';
import { Clipboard, KeyRound, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useToastStore } from '../state/toastStore';

const MAX_TTL_DAYS = 365;

export function TokenManagementPage() {
  const [tokens, setTokens] = useState([]);
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState('30');
  const [renewDays, setRenewDays] = useState({});
  const [newToken, setNewToken] = useState('');
  const [loading, setLoading] = useState(false);
  const push = useToastStore((state) => state.push);
  const load = () =>
    api
      .get('/admin/tokens')
      .then(({ data }) => setTokens(data.tokens || []))
      .catch((error) =>
        push(errorMessage(error, 'Could not load tokens.'), 'error')
      );
  useEffect(() => {
    load();
  }, []);

  const create = async (event) => {
    event.preventDefault();
    const value = Number(days);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TTL_DAYS)
      return push(
        `Expiry must be a whole number of days from 1 to ${MAX_TTL_DAYS}.`,
        'error'
      );
    setLoading(true);
    try {
      const { data } = await api.post('/admin/tokens', {
        userId: userId.trim(),
        days: value,
      });
      setNewToken(data.token);
      setUserId('');
      await load();
      push('Token created. Copy it now; it will not be shown again.');
    } catch (error) {
      push(errorMessage(error, 'Could not create token.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const renew = async (target) => {
    const time = Number(renewDays[target] || 30);
    if (!Number.isSafeInteger(time) || time < 1 || time > MAX_TTL_DAYS)
      return push(
        `Renewal time must be a whole number of days from 1 to ${MAX_TTL_DAYS}.`,
        'error'
      );
    try {
      const { data } = await api.post(`/admin/tokens/${target}/renew`, {
        time,
      });
      setNewToken(data.token);
      await load();
      push(
        'Token renewed. Copy the new token now; it will not be shown again.'
      );
    } catch (error) {
      push(errorMessage(error, 'Could not renew token.'), 'error');
    }
  };

  const revoke = async (target) => {
    if (
      !window.confirm(
        `Revoke the token for ${target}? The user will be logged out immediately.`
      )
    )
      return;
    try {
      await api.delete(`/admin/tokens/${target}`);
      setTokens((items) => items.filter((item) => item.userId !== target));
      push('Token revoked.');
    } catch (error) {
      push(errorMessage(error, 'Could not revoke token.'), 'error');
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-accent" />
          <h1 className="text-xl font-semibold">Token management</h1>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Issue one active dashboard token per Discord User ID.
        </p>
      </div>
      <div className="panel p-4">
        <h2 className="mb-4 text-sm font-semibold">Create token</h2>
        <form
          onSubmit={create}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <label>
            <span className="label">Discord User ID</span>
            <input
              id="token-user-id"
              name="userId"
              className="field font-mono"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="123456789012345678"
              required
            />
          </label>
          <label>
            <span className="label">Expiry (days)</span>
            <input
              id="token-ttl-days"
              name="days"
              className="field font-mono"
              type="number"
              min="1"
              max={MAX_TTL_DAYS}
              step="1"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              required
            />
          </label>
          <button className="btn-primary self-end" disabled={loading}>
            <KeyRound size={16} /> Create
          </button>
        </form>
      </div>
      {newToken && (
        <div className="panel border-accent/40 bg-accent/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-accent">
                Copy this token now
              </h2>
              <p className="mt-1 text-xs text-text-secondary">
                It will not be displayed again.
              </p>
            </div>
            <button
              className="btn-secondary"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(newToken)
                  .then(() => push('Token copied.'))
              }
            >
              <Clipboard size={15} /> Copy
            </button>
          </div>
          <code className="mt-3 block max-h-24 overflow-auto break-all rounded-panel border border-accent/40 bg-surface p-3 font-mono text-xs text-text-primary">
            {newToken}
          </code>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Issued tokens</h2>
          <button
            className="btn-secondary px-2 py-1.5"
            onClick={load}
            aria-label="Refresh tokens"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-3">Discord User ID</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Bots</th>
              <th className="px-4 py-3">Renew (days)</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tokens.map((token) => (
              <tr key={token.userId}>
                <td className="px-4 py-3 font-mono text-xs">{token.userId}</td>
                <td className="px-4 py-3">{token.status}</td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {new Date(token.issuedAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {new Date(token.expiresAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono">{token.botCount}</td>
                <td className="px-4 py-3">
                  <input
                    className="field w-24"
                    type="number"
                    min="1"
                    max={MAX_TTL_DAYS}
                    step="1"
                    value={renewDays[token.userId] || '30'}
                    onChange={(event) =>
                      setRenewDays((current) => ({
                        ...current,
                        [token.userId]: event.target.value,
                      }))
                    }
                    aria-label={`Renewal days for ${token.userId}`}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-secondary px-2 py-1.5"
                      onClick={() => renew(token.userId)}
                    >
                      <RefreshCw size={15} /> Renew
                    </button>
                    <button
                      className="btn-danger px-2 py-1.5"
                      onClick={() => revoke(token.userId)}
                    >
                      <Trash2 size={15} /> Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tokens.length && (
          <p className="p-6 text-center text-sm text-text-secondary">
            No tokens issued.
          </p>
        )}
      </div>
    </section>
  );
}
