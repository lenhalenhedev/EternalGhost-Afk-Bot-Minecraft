import { useEffect, useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { api } from './lib/api';
import { useSse } from './hooks/useSse';
import { useDashboardStore } from './state/dashboardStore';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BotDetailPage } from './pages/BotDetailPage';
import { TokenManagementPage } from './pages/TokenManagementPage';

export default function App() {
  const [checking, setChecking] = useState(true);
  const user = useDashboardStore((state) => state.user);
  const setUser = useDashboardStore((state) => state.setUser);
  useEffect(() => {
    api
      .get('/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, [setUser]);
  useSse(Boolean(user));
  if (checking)
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-text-secondary">
        Loading dashboard…
      </div>
    );
  return (
    <BrowserRouter>
      <Toasts />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute user={user} />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/:botId" element={<BotDetailRoute />} />
            <Route path="/admin/tokens" element={<AdminRoute user={user} />} />
          </Route>
        </Route>
        <Route
          path="/"
          element={<Navigate to={user ? '/dashboard' : '/login'} replace />}
        />
        <Route
          path="*"
          element={<Navigate to={user ? '/dashboard' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

function ProtectedRoute({ user }) {
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function AdminRoute({ user }) {
  return user?.isAdmin ? (
    <TokenManagementPage />
  ) : (
    <Navigate to="/dashboard" replace />
  );
}
function BotDetailRoute() {
  const { botId } = useParams();
  return <BotDetailPage botId={botId} />;
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const reset = useDashboardStore((state) => state.reset);
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      reset();
      navigate('/login', { replace: true });
    }
  };
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar open={sidebarOpen} onToggle={setSidebarOpen} />
      <div className="min-w-0 flex-1">
        <header className="flex min-h-14 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="rounded-panel p-1.5 text-text-secondary hover:bg-canvas/70"
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label="Toggle navigation"
            >
              <Menu size={19} />
            </button>
            <div className="truncate text-sm font-medium text-text-secondary">
              {location.pathname.startsWith('/admin')
                ? 'Administration'
                : 'Dashboard'}
            </div>
          </div>
          <button className="btn-secondary px-2.5 py-1.5" onClick={logout}>
            <LogOut size={15} />{' '}
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
