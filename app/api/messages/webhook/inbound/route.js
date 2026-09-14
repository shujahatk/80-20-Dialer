import { MessageStore, LeadStore, ActivityLogStore } from '@/lib/store';
import { validateTwilioWebhook } from '@/lib/webhookValidator.js';
import { SuppressionStore } from '@/lib/suppression/suppressionStore.js';

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

export async function POST(req) {
  try {
    let body = {};
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        body[key] = value;
      }
    } else {
      try {
        body = await req.json();
      } catch (e) {
        body = {};
      }
    }

    if (!validateTwilioWebhook(req, body)) {
      console.warn('[Inbound SMS Webhook]: Unauthorized Twilio signature rejected.');
      return new Response('Unauthorized Webhook Signature', { status: 401 });
    }

    const { From, Body, MessageSid, To } = body;

    if (!From || !Body) {
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' }
      });
    }

    const senderPhone = From;
    const messageBody = Body.trim();
    const isOptOut = OPT_OUT_KEYWORDS.has(messageBody.toUpperCase());

    // 1. Log the inbound message
    await MessageStore.create({
      userId: null,
      messageSid: MessageSid || `inbound-${Date.now()}`,
      from: senderPhone,
      to: To || '',
      body: messageBody,
      status: 'received',
      channel: 'sms',
      direction: 'inbound'
    });

    const leads = await LeadStore.findPendingByPhone(senderPhone);
    const matchedLead = leads.length > 0 ? leads[0] : null;

    if (isOptOut) {
      console.log(`[SMS Inbound Opt-Out]: Received opt-out keyword from ${senderPhone}`);
      await SuppressionStore.add({
        phone: senderPhone,
        channel: 'all',
        reason: `SMS opt-out keyword: ${messageBody}`,
        leadId: matchedLead?._id || null,
        source: 'inbound_sms'
      });

      if (matchedLead) {
        await LeadStore.update(matchedLead._id, {
          lastAction: `Opt-Out / DNC via SMS: ${messageBody}`,
          lastActionDate: new Date(),
          status: 'opted-out',
          coldOutreachStopped: true,
          suppression: { phone: true, email: true, sms: true, whatsapp: true, dnc: true },
          hasUnansweredReply: true,
          lastReplyText: messageBody.substring(0, 200),
          lastReplyChannel: 'sms',
          lastReplyAt: new Date(),
          'emailSequence.status': 'stopped',
          'emailSequence.stopReason': 'dnc_opt_out'
        });

        await ActivityLogStore.create({
          leadId: matchedLead._id,
          userId: matchedLead.userId || 'system',
          action: 'status_change',
          channel: 'sms',
          direction: 'inbound',
          outcome: 'opted-out',
          notes: `Contact opted out via SMS keyword: "${messageBody}". Permanent DNC active.`,
          messageSid: MessageSid || ''
        });
      }
    } else if (matchedLead) {
      await LeadStore.update(matchedLead._id, {
        lastAction: `Inbound SMS: ${messageBody.substring(0, 100)}`,
        lastActionDate: new Date(),
        hasUnansweredReply: true,
        lastReplyText: messageBody.substring(0, 200),
        lastReplyChannel: 'sms',
        lastReplyAt: new Date(),
        'emailSequence.status': 'stopped',
        'emailSequence.stopReason': 'inbound-sms'
      });

      await ActivityLogStore.create({
        leadId: matchedLead._id,
        userId: matchedLead.userId || 'system',
        action: 'sms',
        channel: 'sms',
        direction: 'inbound',
        outcome: 'inbound-reply',
        notes: messageBody.substring(0, 200),
        messageSid: MessageSid || ''
      });
    }

    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  } catch (err) {
    console.error('[Inbound SMS Webhook] Error:', err.message);
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}

export async function GET(req) {
  return POST(req);
}
