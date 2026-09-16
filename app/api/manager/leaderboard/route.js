import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient } from '@/lib/supabase';
import { UserStore, CallStore, MessageStore, LeadStore, ActivityLogStore } from '@/lib/store';

export async function GET(req) {
  try {
    const auth = await requireManager(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const db = getSupabaseClient();
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // 1. Fetch sales reps and today's activity in parallel batch queries
    const [usersRes, callsRes, messagesRes, bookedLeadsRes] = await Promise.all([
      db.from('users').select('id, name, email, role, approved, last_active').eq('role', 'salesperson'),
      db.from('calls').select('user_id, duration, status').gte('created_at', startOfTodayUtc),
      db.from('messages').select('user_id, channel, status').gte('created_at', startOfTodayUtc),
      db.from('leads').select('assigned_to, status').is('deleted_at', null).in('status', ['meeting-booked', 'interested', 'meeting_booked', 'booked'])
    ]);

    const salespeople = (usersRes.data || []).filter(u => u.approved !== false);
    const calls = callsRes.data || [];
    const messages = messagesRes.data || [];
    const bookedLeads = bookedLeadsRes.data || [];

    // Group calls by user_id
    const callsByUser = {};
    for (const c of calls) {
      const uid = String(c.user_id);
      if (!callsByUser[uid]) callsByUser[uid] = { total: 0, connected: 0, duration: 0 };
      callsByUser[uid].total += 1;
      if ((c.duration && c.duration > 0) || ['completed', 'answered', 'in-progress'].includes(c.status)) {
        callsByUser[uid].connected += 1;
      }
      callsByUser[uid].duration += (Number(c.duration) || 0);
    }

    // Group messages by user_id
    const messagesByUser = {};
    for (const m of messages) {
      const uid = String(m.user_id);
      if (!messagesByUser[uid]) messagesByUser[uid] = { email: 0, sms: 0, whatsapp: 0 };
      if (m.channel === 'email') messagesByUser[uid].email += 1;
      else if (m.channel === 'sms') messagesByUser[uid].sms += 1;
      else if (m.channel === 'whatsapp') messagesByUser[uid].whatsapp += 1;
    }

    // Group booked leads by assigned_to
    const bookedByUser = {};
    for (const l of bookedLeads) {
      const uid = String(l.assigned_to);
      bookedByUser[uid] = (bookedByUser[uid] || 0) + 1;
    }

    const leaderboard = salespeople.map(sp => {
      const spId = String(sp.id);
      const callData = callsByUser[spId] || { total: 0, connected: 0, duration: 0 };
      const msgData = messagesByUser[spId] || { email: 0, sms: 0, whatsapp: 0 };
      const bookedCount = bookedByUser[spId] || 0;

      const lastActive = sp.last_active;
      const isOnline = Boolean(lastActive && new Date(lastActive) >= new Date(fiveMinutesAgo));
      const replyRate = msgData.email > 0 ? `${((bookedCount / msgData.email) * 100).toFixed(1)}%` : '0.0%';

      return {
        _id: spId,
        id: spId,
        name: sp.name,
        email: sp.email,
        callsToday: callData.total,
        connectedCalls: callData.connected,
        booked: bookedCount,
        emailsSent: msgData.email,
        smsSent: msgData.sms,
        whatsappSent: msgData.whatsapp,
        talkTimeSeconds: callData.duration,
        replyRate,
        isOnline,
        status: isOnline ? 'Available' : 'Offline'
      };
    });

    leaderboard.sort((a, b) => (b.booked - a.booked) || (b.callsToday - a.callsToday) || (b.emailsSent - a.emailsSent));

    return NextResponse.json({
      success: true,
      data: leaderboard
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to generate leaderboard.' } },
      { status: 500 }
    );
  }
}
