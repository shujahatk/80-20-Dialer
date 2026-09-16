import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../lib/apiClient.js';
globalThis.window = undefined;
globalThis.localStorage = undefined;
test('concurrent expired API calls share refresh and retry with the new token', async t => {
  const storage = new Map([['token', 'old']]);
  t.mock.property(globalThis, 'window', { location: { origin: 'https://example.com' } });
  t.mock.property(globalThis, 'localStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
  let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ success: true, data: { accessToken: 'new' } });
    }
    return options.headers.get('Authorization') === 'Bearer new' ? Response.json({ success: true }) : Response.json({}, { status: 401 });
  });
  const results = await Promise.all([apiRequest('/api/leads'), apiRequest('/api/session/stats')]);
  assert.equal(results.every(result => result.success), true);
  assert.equal(refreshes, 1);
});
test('temporary refresh outages preserve the session for retry', async t => {
  const storage = new Map([['token', 'old']]);
  t.mock.property(globalThis, 'window', { location: { origin: 'https://example.com' } });
  t.mock.property(globalThis, 'localStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
  t.mock.method(globalThis, 'fetch', async url => Response.json({}, { status: url === '/api/auth/refresh' ? 503 : 401 }));
  await assert.rejects(apiRequest('/api/leads'), /Session refresh failed/);
  assert.equal(storage.get('token'), 'old');
});
