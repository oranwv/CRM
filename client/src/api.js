import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('crm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    // Never log out on a canceled/aborted request (e.g. in-flight during back navigation or unmount).
    if (axios.isCancel(err) || err.code === 'ERR_CANCELED') return Promise.reject(err);

    if (err.response?.status === 401) {
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      // Controlled redirect, and avoid a loop when already on the login page.
      if (!window.location.pathname.startsWith('/login')) {
        sessionStorage.setItem('crm_session_expired', '1');
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  }
);

export default api;
