let refreshInFlight;
async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.message || 'Session refresh failed.');
        error.sessionExpired = [401, 403].includes(response.status);
        throw error;
      }
      localStorage.setItem('token', result.data.accessToken);
      if (result.data.user) localStorage.setItem('user', JSON.stringify(result.data.user));
      return result.data.accessToken;
    })().finally(() => { refreshInFlight = undefined; });
  }
  return refreshInFlight;
}
export async function authenticatedFetch(endpoint, requestOptions = {}) {
  const browser = typeof window !== 'undefined';
  const headers = new Headers(requestOptions.headers);
  const token = browser ? localStorage.getItem('token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const options = { ...requestOptions, headers, credentials: 'same-origin' };
  let response = await fetch(endpoint, options);
  const publicAuth = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/logout'];
  if (response.status === 401 && browser && !publicAuth.includes(endpoint)) {
    try {
      // Web Locks serialize rotation across browser tabs; the promise handles one tab.
      const refresh = async () => {
        const latest = localStorage.getItem('token');
        return latest && latest !== token ? latest : refreshAccessToken();
      };
      headers.set('Authorization', `Bearer ${navigator.locks ? await navigator.locks.request('outbound-session-refresh', refresh) : await refresh()}`);
      response = await fetch(endpoint, options);
    } catch (error) {
      if (error.sessionExpired) {
        localStorage.removeItem('token'); localStorage.removeItem('user');
        window.location.href = new URL('/login', window.location.origin).href;
      }
      throw error;
    }
  }
  return response;
}
export async function apiRequest(endpoint, method = 'GET', data = null, isMultipart = false) {
  const response = await authenticatedFetch(endpoint, { method, headers: isMultipart ? {} : { 'Content-Type': 'application/json' },
    ...(data !== null ? { body: isMultipart ? data : JSON.stringify(data) } : {}) });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Server returned an invalid response (${response.status}).`); }
  if (!response.ok) throw new Error(result.error?.message || result.message || `API request failed (${response.status}).`);
  return result;
}
