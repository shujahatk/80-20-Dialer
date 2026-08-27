import { NextResponse } from 'next/server';
import { LeadStore, ActivityLogStore } from '@/lib/store';

async function processEmailEvent(eventData) {
  const { event, email, from, subject, text } = eventData;
  const emailAddr = (email || from || '').toLowerCase().trim();

  if (!emailAddr) return;

  // Handle DNC suppressions (bounce / unsubscribe)
  if (event === 'bounce' || event === 'unsubscribe') {
    const leads = await LeadStore.findPendingByEmail(emailAddr);
    if (leads.length > 0) {
      const lead = leads[0];
      const reason = event === 'bounce' ? 'bounced' : 'unsubscribed';
      
      await LeadStore.update(lead._id, {
        suppression: { 
          ...(lead.suppression || {}), 
          email: true 
        },
        coldOutreachStopped: true,
        status: event === 'bounce' ? 'not-interested' : 'opted-out',
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
    }
  }

  // Handle Inbound Replies
  if (event === 'inbound-reply' || event === 'inbound') {
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
    }
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    // SendGrid events are usually batch arrays
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
    return new Response('OK', { status: 200 }); // Always return 200 OK to SendGrid to prevent webhook retries
  }
}
