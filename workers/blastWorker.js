import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BlastCampaignStore, LeadStore, MessageStore, ActivityLogStore, UserStore, SendingInboxStore } from '../lib/store.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { prepareEmail, sendEmail } from '../lib/emailService.js';
import { sendBlastSms } from '../lib/sms/sendBlastSms.js';
import { getSupabaseClient, queryResult } from '../lib/supabase.js';

const workerId = randomUUID();
let running = false;
const now = () => new Date().toISOString();
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function recipientStats(recipients, excluded = 0) {
  return { total: recipients.length + excluded, eligible: recipients.length,
    sent: recipients.filter(recipient => recipient.status === 'sent').length,
    failed: recipients.filter(recipient => recipient.status === 'failed').length,
    skipped: excluded + recipients.filter(recipient => recipient.status === 'skipped').length,
    unknown: recipients.filter(recipient => recipient.status === 'unknown').length };
}
export function recoverStaleReservations(campaign) {
  for (const recipient of campaign.recipients || []) {
    if (recipient.status !== 'processing') continue;
    const age = Date.now() - new Date(recipient.first_attempt_at || recipient.reserved_at || 0).getTime();
    if (campaign.type === 'email' && recipient.dispatch_payload && age < 23 * 60 * 60 * 1000) {
      recipient.status = 'pending';
    } else {
      recipient.status = 'unknown';
      recipient.last_error = 'Delivery may have occurred before the worker stopped; reconcile with the provider before resending.';
    }
  }
}
export async function processSingleCampaign(campaign, owner = workerId) {
  const id = campaign.id || campaign._id;
  const recipients = campaign.recipients || [];
  const excluded = campaign.excludedCount || 0;
  const save = terminal => BlastCampaignStore.checkpoint(id, owner, { recipients, stats: recipientStats(recipients, excluded),
    ...(terminal ? { completedAt: now() } : {}) }, terminal || null);
  try {
    recoverStaleReservations(campaign);
    let current = await save();
    if (current.status !== 'processing') return;
    const sender = await UserStore.findById(campaign.createdBy);
    const inbox = campaign.sendingInboxId && campaign.sendingInboxId !== 'default'
      ? await SendingInboxStore.findInboxById(campaign.sendingInboxId) : null;
    for (const recipient of recipients) {
      if (recipient.status !== 'pending') continue;
      if (recipient.retry_at && new Date(recipient.retry_at) > new Date()) continue;
      current = await save();
      if (current.status !== 'processing') return;
      if (!sender || sender.approved !== true || sender.active !== true) {
        recipient.status = 'skipped'; recipient.last_error = 'Sender account disabled or not approved'; await save(); continue;
      }
      if (campaign.sendingInboxId !== 'default' && campaign.sendingInboxId && (!inbox || inbox.active === false)) {
        recipient.status = 'skipped'; recipient.last_error = 'Sending inbox unavailable'; await save(); continue;
      }
      const lead = await LeadStore.findById(recipient.lead_id);
      if (!lead) { recipient.status = 'skipped'; recipient.last_error = 'Lead deleted or missing'; await save(); continue; }
      const manager = ['owner', 'manager', 'admin'].includes(sender.role);
      if (inbox && !manager && String(inbox.createdBy || inbox.userId || '') !== String(sender.id) && !(inbox.assignedUsers || []).map(String).includes(String(sender.id))) {
        recipient.status = 'skipped'; recipient.last_error = 'Sending inbox authorization revoked'; await save(); continue;
      }
      if (!manager && String(lead.assigned_to || '') !== String(sender.id)) {
        recipient.status = 'skipped'; recipient.last_error = 'Lead is no longer assigned to sender'; await save(); continue;
      }
      const email = lead.contact?.email || lead.email;
      const phone = lead.contact?.phone || lead.phone;
      const channel = campaign.type === 'sms' ? 'sms' : 'email';
      const suppressed = await SuppressionStore.isSuppressed({ email, phone, channel });
      if (suppressed.suppressed || lead.suppression?.[channel] || ['do_not_contact', 'opted-out'].includes(String(lead.status).toLowerCase())) {
        recipient.status = 'skipped'; recipient.last_error = 'Suppressed'; await save(); continue;
      }
      if ((channel === 'email' && !email?.includes('@')) || (channel === 'sms' && !phone)) {
        recipient.status = 'skipped'; recipient.last_error = 'Missing recipient address'; await save(); continue;
      }
      const firstName = (lead.contact?.name || lead.name || 'there').split(' ')[0];
      const company = typeof lead.company === 'string' ? lead.company : lead.company?.name || 'your team';
      const replace = value => (value || '').replace(/{{firstName}}/g, firstName).replace(/{{company}}/g, company).replace(/{{industry}}/g, lead.industry || lead.niche || 'business');
      const body = replace(campaign.templateBody);
      // Save the exact request before dispatch so a Resend retry has an identical payload.
      recipient.dispatch_payload ||= channel === 'email' ? prepareEmail({ to: email, subject: replace(campaign.templateSubject),
        html: `<div style="white-space: pre-wrap">${escapeHtml(body)}</div>`, fromEmail: inbox?.fromEmail || sender.email, fromName: inbox?.fromName || sender.name })
        : { to: phone, body };
      recipient.first_attempt_at ||= now();
      if (Date.now() - new Date(recipient.first_attempt_at).getTime() >= 23 * 3600000 || recipient.attempt_count >= 3) {
        recipient.status = 'unknown'; recipient.last_error = 'Safe retry window or attempt limit exceeded; provider reconciliation required'; await save(); continue;
      }
      // Suppression also applies to the original address of an immutable retry request.
      const destination = channel === 'email' ? recipient.dispatch_payload.to[0] : recipient.dispatch_payload.to;
      const originalSuppression = await SuppressionStore.isSuppressed({ [channel === 'email' ? 'email' : 'phone']: destination, channel });
      if (originalSuppression.suppressed) { recipient.status = 'skipped'; recipient.last_error = 'Original recipient suppressed'; await save(); continue; }
      recipient.status = 'processing'; recipient.reserved_at = now(); recipient.attempt_count = (recipient.attempt_count || 0) + 1;
      current = await save();
      if (current.status !== 'processing') { recipient.status = 'pending'; await save(); return; }
      let result;
      try {
        result = channel === 'email' ? await sendEmail({ preparedPayload: recipient.dispatch_payload, idempotencyKey: recipient.idempotency_key })
          : await sendBlastSms(recipient.dispatch_payload);
      } catch (error) {
        recipient.last_error = error.message;
        if (error.definitive) recipient.status = 'failed';
        else if (channel === 'email') { recipient.status = 'pending'; recipient.retry_at = new Date(Date.now() + 60000).toISOString(); }
        else recipient.status = 'unknown';
        await save();
        continue;
      }
      recipient.status = 'sent'; recipient.sent_at = now(); recipient.provider_message_id = result.id || result.sid;
      // Provider success is durable before logging; logging failure must never resend it.
      await save();
      try {
        await MessageStore.create({ userId: sender.id, leadId: lead.id, blastCampaignId: id, messageSid: recipient.provider_message_id,
          from: channel === 'email' ? recipient.dispatch_payload.from : process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER, to: destination,
          body: channel === 'email' ? recipient.dispatch_payload.html : recipient.dispatch_payload.body, status: 'sent', channel, direction: 'outbound' });
        await LeadStore.updateStage(lead.id, 'CONTACTED', `Blast: ${campaign.name}`);
        await ActivityLogStore.create({ userId: sender.id, leadId: lead.id, action: channel, channel, outcome: 'sent', messageSid: recipient.provider_message_id, notes: `Blast: ${campaign.name}` });
      } catch (error) { recipient.log_error = error.message; await save(); }
    }
    if (recipients.some(recipient => recipient.status === 'pending')) { await save(); return; }
    const stats = recipientStats(recipients, excluded);
    await save(stats.unknown ? 'needs_review' : stats.failed && !stats.sent ? 'failed' : 'completed');
  } finally { await BlastCampaignStore.release(id, owner); }
}
export async function processQueuedCampaigns() {
  if (running) return;
  running = true;
  try {
    await queryResult(getSupabaseClient().from('worker_health').upsert({ id: workerId, heartbeat_at: now() }));
    // One campaign per poll keeps heartbeat freshness independent of queue length.
    const campaign = await BlastCampaignStore.claim(workerId);
    if (campaign) await processSingleCampaign(campaign);
  } finally { running = false; }
}
export async function startWorker() {
  let stopped = false;
  const heartbeat = setInterval(() => {
    queryResult(getSupabaseClient().from('worker_health').upsert({ id: workerId, heartbeat_at: now() }))
      .catch(error => console.error('[Worker heartbeat]', error.message));
  }, 15000);
  process.once('SIGINT', () => { stopped = true; });
  process.once('SIGTERM', () => { stopped = true; });
  try {
    while (!stopped) {
      try { await processQueuedCampaigns(); } catch (error) { console.error('[Blast worker]', error.message); }
      if (!stopped) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } finally { clearInterval(heartbeat); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nextEnv = await import('@next/env');
  (nextEnv.loadEnvConfig || nextEnv.default.loadEnvConfig)(process.cwd());
  await startWorker();
}
