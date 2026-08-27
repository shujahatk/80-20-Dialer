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

    // Twilio prefix is 'whatsapp:+92300...'
    const senderPhone = From.replace('whatsapp:', '');
    const messageBody = Body.trim();

    const optOutKeywords = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout', 'dnc', 'quit', 'halt'];
    const isOptOut = optOutKeywords.some(k => messageBody.toLowerCase() === k || messageBody.toLowerCase().startsWith(k + ' '));

    await MessageStore.create({
      userId: null,
      messageSid: MessageSid || `wa-inbound-${Date.now()}`,
      from: senderPhone,
      to: (To || '').replace('whatsapp:', ''),
      body: messageBody,
      status: 'received',
      channel: 'whatsapp',
      direction: 'inbound'
    });

    const leads = await LeadStore.findPendingByPhone(senderPhone);
    if (leads.length > 0) {
      const lead = leads[0];
      const updateData = {
        lastAction: `Inbound WhatsApp: ${messageBody.substring(0, 100)}`,
        lastActionDate: new Date(),
        hasUnansweredReply: !isOptOut,
        lastReplyText: messageBody.substring(0, 200),
        lastReplyChannel: 'whatsapp',
        lastReplyAt: new Date(),
        'emailSequence.status': 'stopped',
        'emailSequence.stopReason': 'inbound-whatsapp'
      };

      if (isOptOut) {
        updateData.suppression = { 
          whatsapp: true, 
          phone: true, 
          email: true, 
          sms: true 
        };
        updateData.status = 'opted-out';
        updateData.coldOutreachStopped = true;
      }

      await LeadStore.update(lead._id, updateData);

      await ActivityLogStore.create({
        leadId: lead._id,
        userId: lead.userId || 'system',
        action: 'sms',
        channel: 'whatsapp',
        direction: 'inbound',
        outcome: isOptOut ? 'opt-out' : 'inbound-reply',
        notes: isOptOut ? `Opt-out requested via WhatsApp: "${messageBody}"` : messageBody.substring(0, 200),
        messageSid: MessageSid || ''
      });
    }

    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  } catch (err) {
    console.error('[Inbound WhatsApp Webhook] Error:', err.message);
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}
