export async function apiRequest(endpoint, method = 'GET', data = null, isMultipart = false) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = {};
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers
  };

  if (data) {
    options.body = isMultipart ? data : JSON.stringify(data);
  }

  const res = await fetch(endpoint, options);
  
  if (res.status === 401 && typeof window !== 'undefined') {
    // Exclude silent background pulse endpoints from forcing automatic logout
    const isBackgroundPulse = endpoint.includes('/api/session/') || endpoint.includes('/api/manager/alerts');
    if (!isBackgroundPulse) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  let result;
  const text = await res.text();

  try {
    result = text ? JSON.parse(text) : {};
  } catch (e) {
    if (!res.ok) {
      throw new Error(`Server returned status ${res.status} (${res.statusText || 'Error'})`);
    }
    result = { success: true, data: text };
  }

  if (!res.ok) {
    throw new Error(result.error?.message || result.message || `API request failed with status ${res.status}`);
  }
  return result;
}
