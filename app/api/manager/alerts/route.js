import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore, SendingInboxStore, UserStore } from '@/lib/store';
import { isMongoConnected } from '@/lib/db';
import Lead from '@/models/Lead';
import Message from '@/models/Message';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const userId = user.role === 'salesperson' ? user._id : null;
    const alerts = [];

    if (isMongoConnected()) {
      const query = userId ? { userId } : {};

      const overdueCallbacks = await Lead.find({ ...query, status: 'callback', callbackDate: { $lt: new Date() } }).countDocuments();
      const untouched = await Lead.find({ ...query, status: 'new' }).countDocuments();

      if (overdueCallbacks > 0) {
        alerts.push({ type: 'warning', category: 'overdue-callbacks', message: `${overdueCallbacks} overdue callback(s) need attention`, count: overdueCallbacks });
      }
      if (untouched > 0) {
        alerts.push({ type: 'info', category: 'untouched-leads', message: `${untouched} untouched lead(s) remaining in queue`, count: untouched });
      }

      const failedMessages = await Message.find({ ...query, channel: 'whatsapp', status: { $in: ['failed', 'undelivered'] } }).countDocuments();
      if (failedMessages > 0) {
        alerts.push({ type: 'error', category: 'failed-whatsapp', message: `${failedMessages} failed/undelivered WhatsApp message(s)`, count: failedMessages });
      }

      const failedSms = await Message.find({ ...query, channel: 'sms', status: { $in: ['failed', 'undelivered'] } }).countDocuments();
      if (failedSms > 0) {
        alerts.push({ type: 'error', category: 'failed-sms', message: `${failedSms} failed/undelivered SMS message(s)`, count: failedSms });
      }

      const unansweredWaReplies = await Lead.find({ ...query, hasUnansweredReply: true, lastReplyChannel: 'whatsapp' }).countDocuments();
      if (unansweredWaReplies > 0) {
        alerts.push({ type: 'warning', category: 'unanswered-whatsapp', message: `${unansweredWaReplies} unanswered WhatsApp reply(ies) needing follow-up`, count: unansweredWaReplies });
      }

      const unansweredSmsReplies = await Lead.find({ ...query, hasUnansweredReply: true, lastReplyChannel: 'sms' }).countDocuments();
      if (unansweredSmsReplies > 0) {
        alerts.push({ type: 'warning', category: 'inbound-sms-followup', message: `${unansweredSmsReplies} unanswered SMS reply(ies) needing follow-up`, count: unansweredSmsReplies });
      }

      if (!userId) {
        const users = await UserStore.findAllUsers();
        const salespeople = users.filter(u => u.role === 'salesperson');
        for (const sp of salespeople) {
          const inbox = await SendingInboxStore.getToday(sp._id);
          if (inbox.status === 'throttled') {
            alerts.push({ type: 'error', category: 'unhealthy-inbox', message: `Salesperson ${sp.name} inbox is throttled (daily limit reached)`, count: 1, userId: sp._id });
          }
          
          const metrics = await LeadStore.getManagerMetrics(sp._id);
          const target = sp.dailyLeadTarget || 50;
          if (metrics.contacted < target * 0.5 && new Date().getHours() >= 14) {
            alerts.push({ type: 'warning', category: 'missed-target', message: `Salesperson ${sp.name} is below 50% of daily dial target`, count: 1, userId: sp._id });
          }
        }
      } else {
        const inbox = await SendingInboxStore.getToday(userId);
        if (inbox.status === 'throttled') {
          alerts.push({ type: 'error', category: 'unhealthy-inbox', message: 'Your daily email sending limit has been hit; inbox throttled', count: 1 });
        }
        const metrics = await LeadStore.getManagerMetrics(userId);
        const target = user.dailyLeadTarget || 50;
        if (metrics.contacted < target * 0.5 && new Date().getHours() >= 14) {
          alerts.push({ type: 'warning', category: 'missed-target', message: 'You are currently below 50% of your daily outbound target', count: 1 });
        }
      }
    } else {
      const queue = await LeadStore.findDailyQueue(userId || user._id);
      if (queue.overdue?.length > 0) {
        alerts.push({ type: 'warning', category: 'overdue-callbacks', message: `${queue.overdue.length} overdue callback(s) need attention`, count: queue.overdue.length });
      }
      const waReplies = (queue.replies || []).filter(r => r.lastReplyChannel === 'whatsapp');
      if (waReplies.length > 0) {
        alerts.push({ type: 'warning', category: 'unanswered-whatsapp', message: `${waReplies.length} unanswered WhatsApp reply(ies)`, count: waReplies.length });
      }
    }

    return NextResponse.json({
      success: true,
      data: alerts
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
