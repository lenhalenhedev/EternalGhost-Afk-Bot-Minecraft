import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useDashboardStore } from '../state/dashboardStore';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useDashboardStore((state) => state.setUser);
  const expired = new URLSearchParams(location.search).get('expired') === '1';

  const submit = async (event) => {
    event.preventDefault();
    if (!token.trim()) return setError('Paste a token to continue.');
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { token: token.trim() });
      setUser(data);
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError, 'Invalid or expired token.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section className="panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-8">
          <div className="text-sm font-semibold text-accent">EternalGhost</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Sign in to Dashboard
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Paste the JWT token sent by the Discord bot.
          </p>
        </div>
        {expired && (
          <div className="mb-4 border-l-2 border-status-pending bg-amber-950/30 px-3 py-2 text-sm text-status-pending">
            Your session has expired or was revoked. Please sign in again.
          </div>
        )}
        {error && (
          <div className="mb-4 border-l-2 border-status-error bg-red-950/30 px-3 py-2 text-sm text-status-error">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="label">Dashboard token</span>
            <textarea
              id="dashboard-token"
              name="token"
              className="field min-h-28 resize-y font-mono text-xs"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste token here"
              autoComplete="off"
            />
          </label>
          <button
            className="btn-primary w-full"
            disabled={loading || !token.trim()}
          >
            <LogIn size={16} />
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-xs text-text-secondary">
          Tokens are stored in an httpOnly session cookie and are never saved in
          browser storage.
        </p>
      </section>
    </main>
  );
}
