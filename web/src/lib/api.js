import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

function dispatchAppEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const protectedPath =
      window.location.pathname.startsWith('/dashboard') ||
      window.location.pathname.startsWith('/admin');
    if (error.response?.status === 401 && protectedPath) {
      dispatchAppEvent('app:session-expired');
    }
    if (error.response?.status === 429) {
      const retryAfterSeconds = Number(
        error.response.headers?.['retry-after'] || 0
      );
      const retryAfterMs = Math.max(0, retryAfterSeconds * 1_000);
      const requestUrl = error.config?.url || '';
      let message = 'Too many requests';
      if (requestUrl.includes('/chat')) message = 'Chat cooldown active';
      else if (requestUrl.includes('/events'))
        message = 'SSE reconnect too frequent';
      else if (requestUrl.includes('/bots'))
        message = 'Too many bot creation requests';
      dispatchAppEvent('app:rate-limited', {
        message,
        retryAfterMs,
        until: Date.now() + retryAfterMs,
      });
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = 'Something went wrong.') {
  return error?.response?.data?.error || fallback;
}
