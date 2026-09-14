import { connectDB } from '../db.js';
import { LeadStore } from '../store.js';

const LISTMONK_URL = process.env.LISTMONK_URL || 'http://127.0.0.1:9000';
const LISTMONK_USER = process.env.LISTMONK_API_USERNAME || process.env.LISTMONK_ADMIN_USER || 'admin';
const LISTMONK_PASS = process.env.LISTMONK_API_PASSWORD || process.env.LISTMONK_ADMIN_PASS || 'admin_password_2026';

export function getAuthHeader() {
  const token = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Sync Resend SMTP configuration into Listmonk settings
 */
export async function syncResendSmtpToListmonk() {
  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SMTP_PASSWORD;
  if (!resendApiKey) {
    return { success: false, message: 'No Resend API Key configured in environment' };
  }

  try {
    const getRes = await fetch(`${LISTMONK_URL}/api/settings`, {
      method: 'GET',
      headers: getAuthHeader(),
    });

    if (!getRes.ok) {
      return { success: false, message: `Failed to fetch Listmonk settings (HTTP ${getRes.status})` };
    }

    const { data: currentSettings = {} } = await getRes.json();
    const smtpPort = parseInt(process.env.RESEND_SMTP_PORT || '465', 10);
    const resendSmtpConfig = {
      name: 'Resend SMTP',
      enabled: true,
      host: process.env.RESEND_SMTP_HOST || 'smtp.resend.com',
      hello_hostname: '',
      port: smtpPort,
      auth_protocol: 'login',
      username: process.env.RESEND_SMTP_USER || 'resend',
      password: resendApiKey,
      email_headers: [],
      max_conns: 10,
      max_msg_retries: 3,
      msg_retry_delay: '1m0s',
      idle_timeout: '15s',
      wait_timeout: '5s',
      tls_type: smtpPort === 465 ? 'SSL' : 'STARTTLS',
      tls_skip_verify: false,
      from_addresses: [],
    };

    const updatedSettings = {
      ...currentSettings,
      smtp: [resendSmtpConfig],
      'app.from_email': process.env.EMAIL_FROM || process.env.SYSTEM_FROM_EMAIL || currentSettings['app.from_email'] || 'noreply@yourdomain.com',
    };

    const putRes = await fetch(`${LISTMONK_URL}/api/settings`, {
      method: 'PUT',
      headers: getAuthHeader(),
      body: JSON.stringify(updatedSettings),
    });

    return putRes.ok
      ? { success: true, message: 'Resend SMTP synced into Listmonk successfully' }
      : { success: false, message: `Failed to update Listmonk settings (HTTP ${putRes.status})` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Health check for Listmonk server
 */
export async function checkListmonkHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${LISTMONK_URL}/api/health`, {
      method: 'GET',
      headers: getAuthHeader(),
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (res && res.ok) {
      // Background attempt to sync SMTP settings if available
      syncResendSmtpToListmonk().catch(() => null);
      let healthData = null;
      try {
        healthData = await res.json();
      } catch {}
      return { 
        connected: true, 
        status: 'Connected', 
        url: LISTMONK_URL,
        data: healthData?.data || healthData || {}
      };
    }
    return { connected: false, status: 'Offline', url: LISTMONK_URL };
  } catch (err) {
    return { connected: false, status: 'Offline', url: LISTMONK_URL, error: err.message };
  }
}

/**
 * Get or create target Listmonk recipient list
 */
export async function getOrCreateList(listName = 'Campaign Audience') {
  try {
    const res = await fetch(`${LISTMONK_URL}/api/lists?per_page=100`, {
      method: 'GET',
      headers: getAuthHeader(),
    });

    if (res.ok) {
      const data = await res.json();
      const existing = (data.data?.results || []).find((l) => l.name === listName);
      if (existing) return existing.id;
    }

    const createRes = await fetch(`${LISTMONK_URL}/api/lists`, {
      method: 'POST',
      headers: getAuthHeader(),
      body: JSON.stringify({
        name: listName,
        type: 'private',
        optin: 'single',
        tags: ['blast-campaign'],
      }),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      return created.data?.id || created.id;
    }
    return 1;
  } catch (err) {
    return 1;
  }
}

/**
 * Sync leads to Listmonk subscribers
 */
export async function syncSubscribersToListmonk(leads = [], listId = 1) {
  let synced = 0, suppressed = 0, errors = 0;
  for (const lead of leads) {
    const email = (lead.email || lead.contact?.email || '').trim().toLowerCase();
    if (!email) continue;
    
    const isSuppressed = Boolean(
      lead.suppressed || 
      lead.suppression?.email || 
      lead.status === 'DO_NOT_CONTACT' || 
      lead.status === 'dnc' || 
      lead.status === 'opted-out'
    );

    if (isSuppressed) suppressed++;

    try {
      const res = await fetch(`${LISTMONK_URL}/api/subscribers`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({
          email,
          name: lead.name || lead.fullName || lead.contact?.name || 'Prospect',
          status: isSuppressed ? 'blocklisted' : 'enabled',
          lists: [listId],
          attribs: {
            company: lead.company?.name || lead.company || '',
            phone: lead.phone || lead.contact?.phone || '',
            leadId: lead._id || lead.id || '',
          },
          preconfirm_subscriptions: true,
        }),
      });

      if (res.ok || res.status === 409) synced++;
      else errors++;
    } catch {
      errors++;
    }
  }
  return { synced, suppressed, errors };
}

/**
 * Sync single lead to Listmonk
 */
export async function syncLeadToListmonk(lead, listIds = [1]) {
  const primaryListId = Array.isArray(listIds) && listIds.length > 0 ? listIds[0] : 1;
  const result = await syncSubscribersToListmonk([lead], primaryListId);
  return { success: result.errors === 0, ...result };
}

/**
 * Create a campaign draft in Listmonk
 */
export async function createListmonkCampaign({ name, subject, bodyHtml, listIds = [1], sendAt = null }) {
  await syncResendSmtpToListmonk().catch(() => null);
  const payload = {
    name,
    subject,
    lists: listIds,
    type: 'regular',
    content_type: 'html',
    body: bodyHtml,
    from_email: process.env.EMAIL_FROM || process.env.SYSTEM_FROM_EMAIL || 'outreach@yourdomain.com',
    messenger: 'email',
  };
  if (sendAt) payload.send_at = new Date(sendAt).toISOString();

  const res = await fetch(`${LISTMONK_URL}/api/campaigns`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Listmonk campaign creation failed (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  const campaignId = data.data?.id || data.id;
  return { success: true, campaignId, data };
}

/**
 * Update campaign dispatch status (running, paused, cancelled)
 */
export async function updateListmonkCampaignStatus(campaignId, status = 'running') {
  const res = await fetch(`${LISTMONK_URL}/api/campaigns/${campaignId}/status`, {
    method: 'PUT',
    headers: getAuthHeader(),
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update campaign status to ${status}: ${errText}`);
  }

  const data = await res.json();
  return { success: true, campaignId, status, data };
}

/**
 * Create and dispatch a campaign immediately or scheduled
 */
export async function createAndLaunchListmonkCampaign({ name, subject, bodyHtml, listIds = [1], sendAt = null }) {
  const created = await createListmonkCampaign({ name, subject, bodyHtml, listIds, sendAt });
  await updateListmonkCampaignStatus(created.campaignId, 'running');
  return { success: true, campaignId: created.campaignId };
}

/**
 * Alias for triggerListmonkBlast
 */
export async function triggerListmonkBlast({ title, name, subject, bodyHtml, listIds = [1], sendAt = null }) {
  return await createAndLaunchListmonkCampaign({
    name: name || title,
    subject,
    bodyHtml,
    listIds,
    sendAt,
  });
}

/**
 * Handle Listmonk webhook event (bounces, unsubscribes, complaints)
 */
export async function handleListmonkWebhook(payload = {}) {
  await connectDB();

  const eventType = (payload.event || payload.type || payload.event_type || '').toLowerCase();
  const email = (
    payload.data?.email || 
    payload.email || 
    payload.subscriber?.email || 
    payload.data?.subscriber?.email || 
    ''
  ).trim().toLowerCase();

  if (!email) {
    return { success: false, message: 'No subscriber email found in webhook payload' };
  }

  const isBounce = eventType.includes('bounce') || payload.bounce != null;
  const isUnsub = eventType.includes('unsub') || eventType.includes('blocklist') || eventType.includes('complaint');

  if (!isBounce && !isUnsub) {
    return { success: true, message: `Ignored unhandled event type: ${eventType || 'unknown'}` };
  }

  try {
    const allLeads = await LeadStore.findAll();
    const matchingLeads = allLeads.filter(l => {
      const leadEmail = (l.contact?.email || l.email || '').trim().toLowerCase();
      return leadEmail === email;
    });

    let updatedCount = 0;
    for (const lead of matchingLeads) {
      const updateData = {
        status: isBounce ? 'dnc' : 'opted-out',
        suppression: {
          ...(lead.suppression || {}),
          email: true,
        },
        emailSequence: {
          ...(lead.emailSequence || {}),
          status: 'stopped',
          stopReason: isBounce ? 'listmonk_bounce' : 'listmonk_unsubscribed',
        },
        lastAction: isBounce ? 'Email Bounced (Listmonk)' : 'Unsubscribed (Listmonk)',
        lastActionDate: new Date().toISOString(),
      };

      await LeadStore.update(lead._id || lead.id, updateData);
      updatedCount++;
    }

    return {
      success: true,
      email,
      eventType: isBounce ? 'bounce' : 'unsubscribe',
      leadsUpdated: updatedCount,
    };
  } catch (err) {
    console.error('[Listmonk Webhook Handler Error]:', err.message);
    return { success: false, error: err.message };
  }
}
