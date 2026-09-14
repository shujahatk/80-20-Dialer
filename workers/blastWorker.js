import { BlastCampaignStore, LeadStore, MessageStore, ActivityLogStore, UserStore } from '../lib/store.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { sendEmail } from '../lib/emailService.js';
import { sendBlastSms } from '../lib/sms/sendBlastSms.js';

const POLL_INTERVAL_MS = 5000;
const STALE_RESERVATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let isWorkerRunning = false;

/**
 * Recovers any recipients stuck in 'processing' state due to worker restart or crash
 */
export async function recoverStaleReservations(campaign) {
  if (!campaign || !Array.isArray(campaign.recipients)) return;
  const now = Date.now();
  let modified = false;

  for (const r of campaign.recipients) {
    if (r.status === 'processing' && r.reserved_at) {
      const reservedTime = new Date(r.reserved_at).getTime();
      if (now - reservedTime > STALE_RESERVATION_TIMEOUT_MS) {
        console.warn(`[Blast Worker] Recovering stale reservation for lead ${r.lead_id} in campaign ${campaign._id || campaign.id}`);
        r.status = 'pending';
        r.attempt_count = (r.attempt_count || 0) + 1;
        r.last_error = 'Stale reservation recovered after worker crash';
        modified = true;
      }
    }
  }

  if (modified) {
    await BlastCampaignStore.update(campaign._id || campaign.id, {
      recipients: campaign.recipients
    });
  }
}

export async function processQueuedCampaigns() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    const allCampaigns = await BlastCampaignStore.findAll();
    const activeCampaigns = allCampaigns.filter(c => c.status === 'queued' || c.status === 'processing');

    for (const campaign of activeCampaigns.slice(0, 5)) {
      await processSingleCampaign(campaign._id || campaign.id);
    }
  } catch (err) {
    console.error('[Blast Worker] Error processing queue:', err.message);
  } finally {
    isWorkerRunning = false;
  }
}

async function processSingleCampaign(campaignId) {
  const campaign = await BlastCampaignStore.findById(campaignId);
  if (!campaign || !['queued', 'processing'].includes(campaign.status)) return;

  console.log(`[Blast Worker] Starting async campaign execution: ${campaign.name} (${campaignId})`);

  // Crash recovery check for stale reservations
  await recoverStaleReservations(campaign);

  // Mark status as processing
  await BlastCampaignStore.update(campaignId, { status: 'processing' });

  const { type = 'email', templateSubject = '', templateBody = '', leadIds = [], createdBy } = campaign;
  const sender = (await UserStore.findById(createdBy)) || { name: 'Outbound Team', email: 'outreach@8020acquisition.com' };

  let sentCount = campaign.stats?.sent || 0;
  let failedCount = campaign.stats?.failed || 0;
  let skippedCount = campaign.stats?.skipped || 0;

  // Initialize or load persistent recipient state
  let recipients = Array.isArray(campaign.recipients) && campaign.recipients.length > 0 
    ? [...campaign.recipients]
    : leadIds.map(leadId => ({
        id: `rcpt_${campaignId}_${leadId}`,
        campaign_id: String(campaignId),
        lead_id: String(leadId),
        status: 'pending',
        idempotency_key: `${campaignId}_${leadId}_v1`,
        provider_message_id: null,
        attempt_count: 0,
        reserved_at: null,
        sent_at: null,
        failed_at: null,
        last_error: null
      }));

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const leadId = recipient.lead_id;

    // Skip already completed recipients
    if (['sent', 'skipped'].includes(recipient.status)) {
      continue;
    }

    // Step 7.6: Re-check campaign pause / cancellation immediately before dispatch
    const currentCampaign = await BlastCampaignStore.findById(campaignId);
    if (!currentCampaign || currentCampaign.status === 'cancelled' || currentCampaign.status === 'paused') {
      console.log(`[Blast Worker] Campaign ${campaignId} was ${currentCampaign?.status || 'cancelled'}. Halting worker.`);
      await BlastCampaignStore.update(campaignId, {
        recipients,
        stats: { total: recipients.length, sent: sentCount, failed: failedCount, skipped: skippedCount }
      });
      return;
    }

    // Step 7.4: Atomic reservation
    recipient.status = 'processing';
    recipient.reserved_at = new Date().toISOString();
    recipient.attempt_count = (recipient.attempt_count || 0) + 1;

    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      skippedCount++;
      recipient.status = 'failed';
      recipient.failed_at = new Date().toISOString();
      recipient.last_error = 'Lead not found';
      continue;
    }

    const email = lead.contact?.email || lead.email;
    const phone = lead.contact?.phone || lead.phone;

    // Permanent suppression check (Step 3.3 & Step 7.4)
    const suppCheck = await SuppressionStore.isSuppressed({
      email,
      phone,
      channel: type === 'email' ? 'email' : 'sms'
    });

    const isSuppressed = suppCheck.suppressed || (type === 'email' ? lead.suppression?.email : lead.suppression?.sms);

    if (isSuppressed || (type === 'email' && (!email || !email.includes('@')))) {
      skippedCount++;
      recipient.status = 'skipped';
      recipient.last_error = isSuppressed ? 'Suppressed (DNC)' : 'Missing valid email';
      continue;
    }

    const firstName = lead.contact?.name?.split(' ')[0] || lead.name?.split(' ')[0] || 'there';
    const company = lead.company?.name || (typeof lead.company === 'string' ? lead.company : 'your team');
    const industry = lead.industry || lead.niche || 'business';

    const personalizedSubject = templateSubject
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{company}}/g, company)
      .replace(/{{industry}}/g, industry);

    const personalizedBody = templateBody
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{company}}/g, company)
      .replace(/{{industry}}/g, industry);

    try {
      if (type === 'email') {
        const sendResult = await sendEmail({
          to: email,
          subject: personalizedSubject,
          html: `<div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${personalizedBody}</div>`,
          fromName: sender.name || 'Sales Team',
          fromEmail: sender.email || 'outreach@8020acquisition.com',
          headers: {
            'X-Idempotency-Key': recipient.idempotency_key
          }
        });

        if (sendResult.success) {
          sentCount++;
          recipient.status = 'sent';
          recipient.sent_at = new Date().toISOString();
          recipient.provider_message_id = sendResult.id || `msg_${Date.now()}`;

          await MessageStore.create({
            userId: sender._id || sender.id,
            leadId,
            messageSid: recipient.provider_message_id,
            from: `${sender.name || 'Sales Team'} <${sender.email || 'outreach@8020acquisition.com'}>`,
            to: email,
            body: personalizedBody,
            status: 'sent',
            channel: 'email',
            direction: 'outbound'
          });

          await LeadStore.updateStage(leadId, 'CONTACTED', `Async Blast: ${campaign.name}`);
          await ActivityLogStore.create({
            leadId,
            userId: sender._id || sender.id,
            action: 'email',
            channel: 'email',
            direction: 'outbound',
            outcome: 'sent',
            notes: `Dispatched in async campaign "${campaign.name}"\nSubject: ${personalizedSubject}`,
            messageSid: recipient.provider_message_id
          });
        } else {
          failedCount++;
          recipient.status = 'failed';
          recipient.failed_at = new Date().toISOString();
          recipient.last_error = sendResult.error || 'Provider dispatch error';
        }
      } else {
        // SMS blast
        const smsResult = await sendBlastSms({ to: phone, body: personalizedBody, leadId });
        if (smsResult.success) {
          sentCount++;
          recipient.status = 'sent';
          recipient.sent_at = new Date().toISOString();
          recipient.provider_message_id = smsResult.sid || `sms_${Date.now()}`;
        } else {
          failedCount++;
          recipient.status = 'failed';
          recipient.failed_at = new Date().toISOString();
          recipient.last_error = smsResult.error || 'SMS dispatch failed';
        }
      }
    } catch (e) {
      failedCount++;
      recipient.status = 'failed';
      recipient.failed_at = new Date().toISOString();
      recipient.last_error = e.message;
    }
  }

  const finalStatus = failedCount === recipients.length && sentCount === 0 ? 'failed' : 'completed';
  await BlastCampaignStore.update(campaignId, {
    status: finalStatus,
    recipients,
    completedAt: new Date().toISOString(),
    stats: {
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount
    }
  });

  console.log(`[Blast Worker] Finished campaign ${campaignId}: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped.`);
}

// Background scheduler
if (typeof setInterval !== 'undefined') {
  setInterval(processQueuedCampaigns, POLL_INTERVAL_MS);
}