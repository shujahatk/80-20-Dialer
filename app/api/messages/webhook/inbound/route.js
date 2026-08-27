import { MessageStore, LeadStore, ActivityLogStore } from '@/lib/store';

export async function POST(req) {
  try {
    let body = {};
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        body[key] = value;
      }
    } else {
      body = await req.json();
    }

    const { From, Body, MessageSid, To } = body;

    if (!From || !Body) {
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' }
      });
    }

    const senderPhone = From;
    const messageBody = Body.trim();

    // Log the inbound message
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
    if (leads.length > 0) {
      const lead = leads[0];
      await LeadStore.update(lead._id, {
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
        leadId: lead._id,
        userId: lead.userId || 'system',
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
