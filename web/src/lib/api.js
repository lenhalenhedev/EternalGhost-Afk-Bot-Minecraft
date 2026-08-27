import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const protectedPath =
      window.location.pathname.startsWith('/dashboard') ||
      window.location.pathname.startsWith('/admin');
    if (error.response?.status === 401 && protectedPath) {
      window.location.assign('/login?expired=1');
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = 'Something went wrong.') {
  return error?.response?.data?.error || fallback;
}
