import { MessageStore, LeadStore, ActivityLogStore } from '@/lib/store';
import { validateTwilioWebhook } from '@/lib/webhookValidator.js';

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
      console.warn('[SMS Status Webhook]: Unauthorized Twilio signature rejected.');
      return new Response('Unauthorized Webhook Signature', { status: 401 });
    }

    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage, To } = body;

    if (!MessageSid) return new Response('OK', { status: 200 });

    const updateData = {};
    if (MessageStatus) updateData.status = MessageStatus;
    if (ErrorCode) updateData.errorCode = String(ErrorCode);
    if (ErrorMessage) updateData.errorMessage = ErrorMessage;

    console.log(`[Twilio SMS Status Callback]: MessageSid: ${MessageSid}, Status: ${MessageStatus || 'unchanged'}`);
    await MessageStore.findOneAndUpdate({ messageSid: MessageSid }, updateData);

    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      const cleanedPhone = To ? To.replace('whatsapp:', '') : '';
      const leads = await LeadStore.findPendingByPhone(cleanedPhone);
      if (leads.length > 0) {
        const lead = leads[0];
        const isWhatsapp = To && To.startsWith('whatsapp:');
        
        await ActivityLogStore.create({
          leadId: lead._id,
          userId: lead.userId || 'system',
          action: 'sms',
          channel: isWhatsapp ? 'whatsapp' : 'sms',
          direction: 'outbound',
          outcome: MessageStatus,
          notes: `${isWhatsapp ? 'WhatsApp' : 'SMS'} delivery failed: ${ErrorMessage || ErrorCode || 'unknown error'}`,
          messageSid: MessageSid
        });
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[SMS Status Webhook] Error:', err.message);
    return new Response('OK', { status: 200 });
  }
}

export async function GET(req) {
  return POST(req);
}
