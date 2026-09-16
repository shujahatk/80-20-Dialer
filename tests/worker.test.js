import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const events = [];
let campaign;
let providerFailure;
let loggingFailure;
const store = {
  BlastCampaignStore: {
    async checkpoint(id, owner, patch, terminal) {
      events.push({ event: 'checkpoint', status: patch.recipients[0]?.status });
      campaign = { ...campaign, ...structuredClone(patch), ...(terminal ? { status: terminal } : {}) };
      return structuredClone(campaign);
    },
    async release() { events.push({ event: 'release' }); }
  },
  LeadStore: { async findById() { return { id: 'lead', assigned_to: 'user', contact: { name: 'Rep', email: 'recipient@example.com' }, company: { name: 'Company' } }; }, async updateStage() {} },
  UserStore: { async findById() { return { id: 'user', approved: true, active: true, role: 'salesperson', name: 'Rep', email: 'rep@example.com' }; } },
  SendingInboxStore: { async findInboxById() { return null; } },
  MessageStore: { async create() { if (loggingFailure) throw new Error('Log database down'); } },
  ActivityLogStore: { async create() {} }
};
mock.module('../lib/store.js', { exports: store });
mock.module('../lib/suppression/suppressionStore.js', { exports: { SuppressionStore: { async isSuppressed() { return { suppressed: false }; } } } });
mock.module('../lib/emailService.js', { exports: {
  prepareEmail(options) { return { to: [options.to], from: options.fromEmail, html: options.html }; },
  async sendEmail() { events.push({ event: 'send' }); if (providerFailure) throw new Error('Provider timeout'); return { success: true, id: 'provider-id' }; }
} });
mock.module('../lib/sms/sendBlastSms.js', { exports: { async sendBlastSms() { throw new Error('Unexpected SMS dispatch'); } } });
const { processSingleCampaign, recoverStaleReservations } = await import('../workers/blastWorker.js');
function setup() {
  events.length = 0; loggingFailure = false; providerFailure = false;
  campaign = { id: 'campaign', status: 'processing', type: 'email', createdBy: 'user', sendingInboxId: 'default',
    templateBody: 'Hello {{firstName}}', recipients: [{ lead_id: 'lead', status: 'pending', attempt_count: 0, idempotency_key: 'stable' }] };
}
test('reservation is persisted before sending and success before logging; log failure never resends', async () => {
  setup(); loggingFailure = true;
  await processSingleCampaign(structuredClone(campaign), 'worker');
  const send = events.findIndex(event => event.event === 'send');
  assert.equal(events[send - 1].status, 'processing');
  assert.equal(events[send + 1].status, 'sent');
  assert.equal(campaign.stats.sent, 1);
  assert.equal(campaign.stats.failed, 0);
  assert.equal(campaign.recipients[0].log_error, 'Log database down');
  await processSingleCampaign(structuredClone(campaign), 'worker');
  assert.equal(events.filter(event => event.event === 'send').length, 1);
});
test('paused campaign stops before provider dispatch', async () => {
  setup(); campaign.status = 'paused';
  await processSingleCampaign(structuredClone(campaign), 'worker');
  assert.equal(events.some(event => event.event === 'send'), false);
  assert.equal(campaign.status, 'paused');
});
test('ambiguous email failure retains exact payload and waits for retry', async () => {
  setup(); providerFailure = true;
  await processSingleCampaign(structuredClone(campaign), 'worker');
  assert.equal(campaign.recipients[0].status, 'pending');
  assert.ok(campaign.recipients[0].dispatch_payload);
  assert.ok(campaign.recipients[0].retry_at);
  assert.equal(campaign.stats.sent, 0);
});
test('crash recovery only replays email within the provider safe window', () => {
  const recent = { type: 'email', recipients: [{ status: 'processing', dispatch_payload: {}, first_attempt_at: new Date().toISOString() }] };
  recoverStaleReservations(recent); assert.equal(recent.recipients[0].status, 'pending');
  const old = { type: 'email', recipients: [{ status: 'processing', dispatch_payload: {}, first_attempt_at: new Date(Date.now() - 86400000).toISOString() }] };
  recoverStaleReservations(old); assert.equal(old.recipients[0].status, 'unknown');
  const sms = { type: 'sms', recipients: [{ status: 'processing', first_attempt_at: new Date().toISOString() }] };
  recoverStaleReservations(sms); assert.equal(sms.recipients[0].status, 'unknown');
});
