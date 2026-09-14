import { NextResponse } from 'next/server';
import { requireAuth, isManagerOrAdmin } from '@/lib/middleware/authGuard';
import { LeadStore, MessageStore } from '@/lib/store';
export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;
    const manager = isManagerOrAdmin(user);
    const leads = manager ? await LeadStore.findAll() : await LeadStore.findByUser(user.id);
    const messages = manager ? await MessageStore.findAll() : await MessageStore.findByUserId(user.id);
    const alerts = [];
    const add = (count, type, category, message) => { if (count) alerts.push({ count, type, category, message: count + ' ' + message }); };
    add(leads.filter(lead => String(lead.status).toLowerCase() === 'callback' && new Date(lead.callbackDate) < new Date()).length, 'warning', 'overdue-callbacks', 'overdue callbacks need attention');
    add(leads.filter(lead => String(lead.status).toLowerCase() === 'new').length, 'info', 'untouched-leads', 'untouched leads remain');
    for (const channel of ['sms', 'whatsapp']) {
      add(messages.filter(message => message.channel === channel && ['failed', 'undelivered'].includes(message.status)).length, 'error', 'failed-' + channel, 'failed ' + channel + ' messages');
      add(leads.filter(lead => lead.hasUnansweredReply && lead.lastReplyChannel === channel).length, 'warning', 'unanswered-' + channel, 'unanswered ' + channel + ' replies');
    }
    return NextResponse.json({ success: true, data: alerts });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
