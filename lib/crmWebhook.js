import { SystemConfigStore } from './store';

export async function triggerCrmWebhook(lead, history) {
  try {
    const config = await SystemConfigStore.getConfig();
    const url = config.crmWebhookUrl;

    if (!url || url.trim() === '') {
      console.log('[CRM Webhook] No webhook URL configured. Skipping handoff.');
      return;
    }

    const payload = {
      event: 'lead.meeting-booked',
      timestamp: new Date().toISOString(),
      lead: {
        id: lead._id,
        name: lead.contact?.name || '',
        phone: lead.contact?.phone || '',
        email: lead.contact?.email || '',
        position: lead.contact?.position || '',
        company: lead.company?.name || '',
        website: lead.company?.website || '',
        niche: lead.company?.niche || '',
        notes: lead.company?.notes || '',
        geography: lead.geography || {}
      },
      booking: lead.booking || {},
      history: (history || []).map(h => ({
        timestamp: h.timestamp,
        action: h.action,
        channel: h.channel || '',
        outcome: h.outcome || '',
        notes: h.notes || '',
        duration: h.duration || 0
      }))
    };

    console.log(`[CRM Webhook] Dispatching payload to: ${url}`);
    
    // Dispatched in background (non-blocking)
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(res => {
      console.log(`[CRM Webhook] Dispatched successfully. Response status: ${res.status}`);
    }).catch(err => {
      console.error(`[CRM Webhook] Dispatch failed: ${err.message}`);
    });
  } catch (err) {
    console.error(`[CRM Webhook] Error: ${err.message}`);
  }
}
