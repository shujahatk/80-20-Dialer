import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const sqlFile = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const migration = await sqlFile('20260914_supabase_only_runtime.sql');
const legacySchema = await readFile(new URL('./fixtures/legacy-supabase.sql', import.meta.url), 'utf8');
const agentId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';

async function database(t) {
  // This is an isolated PostgreSQL engine: no environment credentials or network.
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  return db;
}

test('migration upgrades the observed legacy schema and preserves data across reruns', async t => {
  const db = await database(t);
  await db.exec(legacySchema);
  await db.exec(migration);

  const lead = (await db.query('SELECT * FROM public.leads WHERE id=$1', [leadId])).rows[0];
  assert.equal(lead.assigned_to, agentId);
  assert.equal(lead._id, 'legacy-lead');
  assert.equal(lead.notes, 'Keep this note');
  assert.deepEqual(lead.company, { name: 'Test Company' });
  assert.equal(lead.contact.email, 'contact@example.test');
  assert.deepEqual(lead.suppression, { email: true, sms: true });
  assert.equal(lead.locked_by, null);
  assert.equal(lead.lock_heartbeat_at, null);
  assert.equal(lead.deleted_at, null);

  const call = (await db.query('SELECT * FROM public.calls')).rows[0];
  assert.equal(call.duration, 75);
  assert.equal(call.duration_seconds, 75);
  assert.equal(call.to_number, '+12025550123');
  assert.equal(call.user_id, agentId);
  assert.equal(call.lead_id, leadId);
  const messages = (await db.query('SELECT * FROM public.messages ORDER BY channel')).rows;
  assert.equal(messages[0].body, 'Keep this email');
  assert.equal(messages[0].to_email, 'contact@example.test');
  assert.equal(messages[1].body, 'Keep this SMS');
  assert.equal(messages[1].to_number, '+12025550123');
  assert.equal(messages[1].status, 'delivered');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.suppression_list')).rows[0].count, 2);

  const lock = (await db.query('SELECT * FROM public.lock_outbound_lead($1,$2)', [leadId, agentId])).rows[0];
  assert.equal(lock.locked_by, agentId);
  const patched = (await db.query('SELECT * FROM public.patch_outbound_lead($1,$2)', ['legacy-lead', {
    notes: 'Updated note', data: { custom: 'Retained' }, locked_by: null, locked_at: null
  }])).rows[0];
  assert.equal(patched.notes, 'Updated note');
  assert.equal(patched.data.custom, 'Retained');
  const queued = (await db.query("INSERT INTO public.leads(name,status) VALUES('Queued contact','new') RETURNING id")).rows[0];
  assert.equal((await db.query('SELECT * FROM public.claim_outbound_lead($1)', [agentId])).rows[0].id, queued.id);

  // A replay must not replace later edits from stale legacy columns or duplicate opt-outs.
  await db.query("UPDATE public.messages SET body='Edited message' WHERE channel='sms'");
  await db.exec(migration);
  assert.equal((await db.query("SELECT body FROM public.messages WHERE channel='sms'")).rows[0].body, 'Edited message');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.suppression_list')).rows[0].count, 2);
  assert.equal((await db.query('SELECT notes FROM public.leads WHERE id=$1', [leadId])).rows[0].notes, 'Updated note');

  const permissions = (await db.query(`SELECT
    has_table_privilege('anon','public.leads','SELECT') AS anon_read,
    has_table_privilege('authenticated','public.users','SELECT') AS browser_read,
    has_table_privilege('service_role','public.leads','SELECT') AS server_read,
    has_function_privilege('anon','public.claim_outbound_lead(uuid)','EXECUTE') AS anon_claim`)).rows[0];
  assert.deepEqual(permissions, { anon_read: false, browser_read: false, server_read: true, anon_claim: false });
  await db.query('DELETE FROM public.leads WHERE id=$1', [leadId]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.suppression_list')).rows[0].count, 2);
});

test('standalone migration supports registration, refresh rotation, and leased campaigns', async t => {
  const db = await database(t);
  await db.exec(migration);
  const owner = (await db.query('SELECT * FROM public.register_outbound_user($1,$2,$3)', ['Owner', 'owner@example.test', 'hash'])).rows[0];
  const member = (await db.query('SELECT * FROM public.register_outbound_user($1,$2,$3)', ['Member', 'member@example.test', 'hash'])).rows[0];
  assert.equal(owner.role, 'owner');
  assert.equal(owner.approved, true);
  assert.equal(member.role, 'salesperson');
  assert.equal(member.approved, false);

  await db.query("INSERT INTO public.refresh_sessions(user_id,token_hash,refresh_token_jti,expires_at) VALUES($1,'old-hash','old-jti',now()+interval '1 day')", [owner.id]);
  const rotate = () => db.query('SELECT public.rotate_outbound_refresh($1,$2,$3,$4,$5,$6) AS rotated', [
    'old-hash', owner.id, 1, 'new-hash', 'new-jti', new Date(Date.now() + 86400000).toISOString()
  ]);
  assert.equal((await rotate()).rows[0].rotated, true);
  assert.equal((await rotate()).rows[0].rotated, false);
  await db.query("INSERT INTO public.outbound_blast_campaigns(status) VALUES('queued')");
  const campaign = (await db.query('SELECT * FROM public.claim_outbound_blast($1)', ['worker-a'])).rows[0];
  assert.equal(campaign.status, 'processing');
  assert.equal((await db.query('SELECT * FROM public.claim_outbound_blast($1)', ['worker-b'])).rows[0].id, null);
  await db.query('SELECT * FROM public.patch_outbound_blast($1,$2)', [campaign.id, { status: 'paused' }]);
  const checkpoint = (await db.query('SELECT * FROM public.checkpoint_outbound_blast($1,$2,$3,$4)', [campaign.id, 'worker-a', { sent: 1 }, 'completed'])).rows[0];
  assert.equal(checkpoint.status, 'paused');
  assert.equal(checkpoint.data.sent, 1);
});

test('migration remains compatible with the core, hardening, and Twilio schema', async t => {
  const db = await database(t);
  for (const name of ['20260905_production_core_schema.sql', '20260913_hardening_v2_schema.sql', '20260914_twilio_voice_sms_schema.sql']) {
    await db.exec(await sqlFile(name));
  }
  await db.query('INSERT INTO public.users(id,name,email,password) VALUES($1,$2,$3,$4)', [agentId, 'Agent', 'agent@example.test', 'hash']);
  await db.query('INSERT INTO public.leads(id,assigned_to,contact,company) VALUES($1,$2,$3,$4)', [leadId, agentId,
    { name: 'Contact', email: 'contact@example.test' }, { name: 'Company', website: 'https://example.test' }]);
  await db.exec(migration);
  await db.exec(migration);
  const lead = (await db.query('SELECT * FROM public.lock_outbound_lead($1,$2)', [leadId, agentId])).rows[0];
  assert.equal(lead.assigned_to, agentId);
  assert.equal(lead.company.website, 'https://example.test');
  const type = (await db.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='assigned_to'")).rows[0];
  assert.equal(type.data_type, 'uuid');
});
