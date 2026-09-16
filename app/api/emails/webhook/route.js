import { NextResponse } from 'next/server';
import { LeadStore, ActivityLogStore } from '@/lib/store';
import { validateResendWebhook } from '@/lib/webhookValidator';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';

async function processEmailEvent(eventData) {
  const { event, email, from, subject, text, data } = eventData;
  const emailAddr = (email || from || data?.to?.[0] || '').toLowerCase().trim();
  const eventType = event || data?.type || '';

  if (!emailAddr) return;

  // Handle DNC suppressions (bounce / unsubscribe)
  if (eventType === 'bounce' || eventType === 'unsubscribe' || eventType === 'email.bounced') {
    const leads = await LeadStore.findPendingByEmail(emailAddr);
    if (leads.length > 0) {
      const lead = leads[0];
      const reason = (eventType.includes('bounce')) ? 'bounced' : 'unsubscribed';
      
      await LeadStore.update(lead._id, {
        suppression: { 
          ...(lead.suppression || {}), 
          email: true 
        },
        coldOutreachStopped: true,
        status: reason === 'bounced' ? 'not-interested' : 'opted-out',
        'emailSequence.status': 'stopped',
        'emailSequence.stopReason': reason
      });

      await ActivityLogStore.create({
        leadId: lead._id,
        userId: lead.userId || 'system',
        action: 'note',
        channel: 'email',
        direction: 'inbound',
        notes: `Outbound email sequence stopped. Lead email is ${reason}. Subject: ${subject || ''}`
      });

      broadcastRealtimeEvent('email.bounced', {
        email: emailAddr,
        leadId: lead._id,
        reason
      });
    }
  }

  // Handle Inbound Replies
  if (eventType === 'inbound-reply' || eventType === 'inbound' || eventType === 'email.replied') {
    const leads = await LeadStore.findPendingByEmail(emailAddr);
    if (leads.length > 0) {
      const lead = leads[0];
      
      await LeadStore.update(lead._id, {
        coldOutreachStopped: true,
        hasUnansweredReply: true,
        lastReplyText: subject || text || 'Inbound email reply',
        lastReplyChannel: 'email',
        lastReplyAt: new Date(),
        lastAction: `Inbound reply received: ${subject || '(no subject)'}`,
        lastActionDate: new Date(),
        'emailSequence.status': 'stopped',
        'emailSequence.stopReason': 'inbound-reply'
      });

      await ActivityLogStore.create({
        leadId: lead._id,
        userId: lead.userId || 'system',
        action: 'email',
        channel: 'email',
        direction: 'inbound',
        outcome: 'inbound-reply',
        notes: `Reply received: ${subject || '(no subject)'}`
      });

      broadcastRealtimeEvent('email.replied', {
        email: emailAddr,
        leadId: lead._id,
        subject: subject || ''
      });
    }
  }

  // Handle standard delivery events
  if (eventType === 'email.delivered' || eventType === 'delivered') {
    const emailId = eventData.id || data?.id;
    let userId = null;
    let leadId = null;

    if (emailId) {
      try {
        const { MessageStore } = await import('@/lib/store');
        const updatedMsg = await MessageStore.findOneAndUpdate({ messageSid: emailId }, { status: 'delivered' });
        if (updatedMsg) {
          userId = updatedMsg.userId;
          leadId = updatedMsg.leadId;
        }
      } catch (e) {}
    }

    broadcastRealtimeEvent('email.delivered', {
      email: emailAddr,
      id: emailId,
      userId,
      leadId
    });
  }
}

export async function POST(req) {
  try {
    const rawText = await req.text();

    if (!validateResendWebhook(req, rawText)) {
      console.warn('[Resend Webhook Security]: Unauthorized or invalid signature rejected.');
      return new Response('Unauthorized Webhook Signature', { status: 401 });
    }

    const body = rawText ? JSON.parse(rawText) : {};

    if (Array.isArray(body)) {
      for (const eventObj of body) {
        await processEmailEvent(eventObj);
      }
    } else {
      await processEmailEvent(body);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Email Webhook Error]:', err.message);
    return new Response('OK', { status: 200 });
  }
}
