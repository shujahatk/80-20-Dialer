import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../lib/auth/jwt.js';
import { verifyAuth } from '../lib/auth.js';
import { UserStore } from '../lib/stores/users.js';
import { generateAuthTokens, rotateRefreshToken } from '../lib/auth/tokenManager.js';
import { BlastCampaignStore } from '../lib/stores/blasts.js';
import { getSupabaseClient } from '../lib/supabase.js';
import { sendEmail } from '../lib/emailService.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { getSystemHealth } from '../lib/systemHealth.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = { id, email: 'rep@example.com', role: 'salesperson', approved: true, active: true, token_version: 2 };
process.env.JWT_SECRET = 'isolated-test-secret-abcdefghijklmnopqrstuvwxyz';
process.env.SUPABASE_URL = 'https://isolated.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

test('refresh tokens cannot access API resources, even with valid signatures', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No lookup should be made for refresh tokens'); });
  const token = generateRefreshToken(user);
  assert.equal(await verifyAuth({ headers: new Headers({ authorization: `Bearer ${token}` }) }), null);
});
test('authentication uses current Supabase account status and exact token version', async t => {
  let row = user;
  t.mock.method(globalThis, 'fetch', async () => Response.json(row));
  const request = { headers: new Headers({ authorization: `Bearer ${generateAccessToken(user)}` }) };
  assert.equal((await verifyAuth(request)).id, id);
  row = { ...user, token_version: 3 };
  assert.equal(await verifyAuth(request), null);
  row = { ...user, active: false };
  assert.equal(await verifyAuth(request), null);
});
test('missing production secrets fail and tampered JWTs are rejected', () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  assert.throws(() => generateAccessToken(user), /JWT_SECRET/);
  process.env.JWT_SECRET = original;
  const token = generateAccessToken(user);
  assert.equal(verifyToken(token + 'tampered'), null);
});
test('Supabase lookup failures never fall back to local users or suppression', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'database unavailable', code: 'XX000' }, { status: 500 }));
  await assert.rejects(UserStore.findOne({ email: user.email }), /Supabase query failed/);
  await assert.rejects(SuppressionStore.isSuppressed({ email: user.email }), /Supabase query failed/);
});
test('server cannot use anonymous Supabase credentials', () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_ANON_KEY = 'anon';
  assert.throws(() => getSupabaseClient(), /SERVICE_ROLE_KEY/);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});
test('refresh tokens are persisted by hash and rotation rejects reuse', async t => {
  let activeHash;
  let saved;
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/users')) return Response.json(user);
    const body = JSON.parse(options.body);
    if (url.includes('/refresh_sessions')) { saved = body; activeHash = body.token_hash; return Response.json(null, { status: 201 }); }
    if (url.includes('/rpc/rotate_outbound_refresh')) {
      const accepted = activeHash === body.p_old_hash;
      if (accepted) activeHash = body.p_new_hash;
      return Response.json(accepted);
    }
    throw new Error('Unexpected request: ' + url);
  });
  const tokens = await generateAuthTokens(user);
  assert.equal(saved.token_hash.length, 64);
  assert.notEqual(saved.token_hash, tokens.refreshToken);
  assert.equal((await rotateRefreshToken(tokens.refreshToken)).success, true);
  assert.equal((await rotateRefreshToken(tokens.refreshToken)).success, false);
});
test('campaign creation deduplicates recipients and writes durable state to Supabase', async t => {
  let row;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /outbound_blast_campaigns/);
    row = JSON.parse(options.body);
    return Response.json(row);
  });
  const campaign = await BlastCampaignStore.create({ name: 'Test', leadIds: [id, id], createdBy: id });
  assert.equal(campaign.recipients.length, 1);
  assert.equal(row.data.recipients[0].status, 'pending');
  assert.match(row.data.recipients[0].idempotency_key, /^blast\//);
});
test('RPC records decode array results and a lost campaign lease fails closed', async t => {
  let lost = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json(lost ? [{ id: null, data: null }] : [{ id, status: 'processing', data: { name: 'Test' } }]));
  assert.equal((await BlastCampaignStore.claim('worker')).id, id);
  lost = true;
  assert.equal(await BlastCampaignStore.claim('worker'), null);
  await assert.rejects(BlastCampaignStore.checkpoint(id, 'worker', {}), /lease lost/);
});
test('email fails without configuration and forwards provider HTTP idempotency key', async t => {
  delete process.env.RESEND_API_KEY;
  await assert.rejects(sendEmail({ to: user.email, subject: 'test', text: 'test' }), /RESEND_API_KEY/);
  process.env.RESEND_API_KEY = 'isolated-test-key';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers['Idempotency-Key'], 'stable-recipient-key');
    return Response.json({ id: 'provider-1' });
  });
  assert.equal((await sendEmail({ to: user.email, subject: 'test', text: 'test', idempotencyKey: 'stable-recipient-key' })).id, 'provider-1');
});
test('health checks distinguish a stopped worker and database failure', async t => {
  let down = false;
  t.mock.method(globalThis, 'fetch', async () => down ? Response.json({ message: 'down' }, { status: 500 }) : Response.json([]));
  let health = await getSystemHealth();
  assert.equal(health.status, 'degraded');
  assert.equal(health.services.worker, 'stopped');
  down = true;
  health = await getSystemHealth();
  assert.equal(health.services.database, 'unavailable');
});
