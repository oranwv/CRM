import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('crm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Payload of a JWT, or null. Only read here to compare two of our own tokens — never trusted.
function tokenPayload(token) {
  try {
    const b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { return null; }
}

api.interceptors.response.use(
  res => {
    // Sliding session: the server re-issues a token once a day of use (see server/middleware/auth.js).
    // Take it ONLY if it is for the same user as the token this request was sent with, and it lasts
    // longer. A response replayed from the browser's HTTP cache carries the X-Refresh-Token of
    // whoever made the request back then — on a shared PC that was another user's session
    // (Phase 108), and for the same user an old copy would shorten the session.
    const fresh = res.headers?.['x-refresh-token'];
    if (fresh) {
      const sent = String(res.config?.headers?.Authorization || '').replace(/^Bearer /, '');
      const cur = tokenPayload(sent), next = tokenPayload(fresh);
      const sameUser = cur && next && cur.id != null && String(cur.id) === String(next.id);
      const stillCurrent = sent && localStorage.getItem('crm_token') === sent;
      if (sameUser && stillCurrent && Number(next.exp) > Number(cur.exp)) {
        try { localStorage.setItem('crm_token', fresh); } catch {}
      }
    }
    return res;
  },
  err => {
    // Never log out on a canceled/aborted request (e.g. in-flight during back navigation or unmount).
    if (axios.isCancel(err) || err.code === 'ERR_CANCELED') return Promise.reject(err);

    if (err.response?.status === 401) {
      // Log out ONLY for a real session failure. The server marks those (X-Auth-Failed / `auth`
      // in the body — middleware/auth.js); any other 401 is an ordinary error of that one request.
      // The message check covers a server instance from before the marker during a deploy.
      const legacy = ['Unauthorized', 'Invalid token'].includes(err.response.data?.error) ? 'unmarked' : null;
      const reason = err.response.headers?.['x-auth-failed'] || err.response.data?.auth || legacy;
      if (!reason) return Promise.reject(err);

      // The token changed after this request left (another tab logged in again, or the daily
      // refresh landed): the session is fine — repeat the request once with the current token.
      const current = localStorage.getItem('crm_token');
      const sent = err.config?.headers?.Authorization;
      if (current && sent !== `Bearer ${current}` && err.config && !err.config.__retriedAuth) {
        err.config.__retriedAuth = true;
        return api.request(err.config);
      }

      // Remember why, so the login screen can say it and it can be reported (last 10 kept).
      const entry = {
        at: new Date().toISOString(), reason,
        request: `${(err.config?.method || '').toUpperCase()} ${String(err.config?.url || '').split('?')[0]}`,
        page: window.location.pathname,
      };
      try {
        const log = JSON.parse(localStorage.getItem('crm_logout_log') || '[]');
        localStorage.setItem('crm_logout_log', JSON.stringify([entry, ...log].slice(0, 10)));
      } catch {}

      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      document.cookie = 'crm_app=; path=/; max-age=0';
      // Controlled redirect, and avoid a loop when already on the login page.
      if (!window.location.pathname.startsWith('/login')) {
        sessionStorage.setItem('crm_session_expired', JSON.stringify(entry));
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  }
);

export default api;
