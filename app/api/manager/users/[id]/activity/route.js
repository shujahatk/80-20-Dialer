import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient } from '@/lib/supabase';

function extractString(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if (typeof val.name === 'string') return val.name;
    if (typeof val.company === 'string') return val.company;
    if (typeof val.title === 'string') return val.title;
    if (typeof val.label === 'string') return val.label;
    if (typeof val.value === 'string') return val.value;
    return fallback;
  }
  return String(val);
}

function formatHoursMinutes(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export async function GET(req, { params }) {
  try {
    const auth = await requireManager(req);
    if (auth.errorResponse) return auth.errorResponse;

    const resolvedParams = await params;
    const userId = resolvedParams?.id;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'User ID is required.' },
        { status: 400 }
      );
    }

    const db = getSupabaseClient();

    // 1. Fetch User Profile
    const { data: userRecord, error: userErr } = await db
      .from('users')
      .select('id, name, email, role, approved, last_active, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (userErr || !userRecord) {
      return NextResponse.json(
        { success: false, message: 'User not found.' },
        { status: 404 }
      );
    }

    // 2. Fetch User Calls, Messages, and Activity Logs in Parallel
    const [callsRes, messagesRes, activityRes, bookedLeadsRes] = await Promise.all([
      db.from('calls').select('id, duration, status, created_at').eq('user_id', userId),
      db.from('messages').select('id, channel, status, created_at').eq('user_id', userId),
      db.from('activity_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      db.from('leads').select('id, status').eq('assigned_to', userId).in('status', ['meeting-booked', 'interested', 'meeting_booked', 'booked'])
    ]);

    const calls = callsRes.data || [];
    const messages = messagesRes.data || [];
    const recentActivityLogs = activityRes.data || [];
    const bookedLeads = bookedLeadsRes.data || [];

    // Call Aggregations
    const callsMade = calls.length;
    let answered = 0;
    let noAnswer = 0;
    let failed = 0;
    let totalTalkTimeSeconds = 0;

    for (const c of calls) {
      const dur = Number(c.duration) || 0;
      totalTalkTimeSeconds += dur;

      const st = String(c.status || '').toLowerCase();
      if (dur > 0 || ['completed', 'answered', 'in-progress'].includes(st)) {
        answered += 1;
      } else if (['no-answer', 'busy', 'canceled'].includes(st)) {
        noAnswer += 1;
      } else if (st === 'failed') {
        failed += 1;
      }
    }

    // Message Aggregations
    let emailsSent = 0;
    let emailDelivered = 0;
    let emailReplies = 0;
    let smsSent = 0;
    let smsDelivered = 0;

    for (const m of messages) {
      const st = String(m.status || '').toLowerCase();
      if (m.channel === 'email') {
        emailsSent += 1;
        if (st === 'delivered' || st === 'sent') emailDelivered += 1;
        if (st === 'replied' || st === 'inbound-reply') emailReplies += 1;
      } else if (m.channel === 'sms' || m.channel === 'whatsapp') {
        smsSent += 1;
        if (st === 'delivered' || st === 'sent') smsDelivered += 1;
      }
    }

    // Lead Lead IDs from recent logs for lead name projection
    const leadIds = [...new Set(recentActivityLogs.map(l => l.lead_id).filter(Boolean))];
    const leadsRes = leadIds.length > 0
      ? await db.from('leads').select('id, name, company, phone, email').in('id', leadIds)
      : { data: [] };
    const leadsMap = new Map((leadsRes.data || []).map(l => [String(l.id), l]));

    const recentActivity = recentActivityLogs.map(log => {
      const l = leadsMap.get(String(log.lead_id));
      const dur = Number(log.duration) || 0;
      let actionLabel = log.action === 'call' ? 'Called' : log.action === 'email' ? 'Email' : log.action === 'sms' ? 'SMS' : 'Updated';
      let resultLabel = dur > 0 ? `Connected (${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')})` : extractString(log.outcome || log.status, 'Done');

      return {
        id: String(log.id || Math.random()),
        time: log.created_at ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        timestamp: log.created_at,
        leadName: extractString(l?.name) || 'Contact',
        company: extractString(l?.company) || 'Individual',
        action: actionLabel,
        channel: extractString(log.channel),
        result: resultLabel,
        notes: extractString(log.notes)
      };
    });

    const stats = {
      calls: {
        total: callsMade,
        answered,
        noAnswer,
        failed,
        totalTalkTimeSeconds,
        talkTimeFormatted: formatHoursMinutes(totalTalkTimeSeconds)
      },
      emails: {
        sent: emailsSent,
        delivered: emailDelivered,
        replies: emailReplies
      },
      sms: {
        sent: smsSent,
        delivered: smsDelivered
      },
      meetingsBooked: bookedLeads.length
    };

    return NextResponse.json({
      success: true,
      data: {
        user: userRecord,
        stats,
        recentActivity
      }
    });
  } catch (err) {
    console.error('[User Activity Breakdown API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch user activity details.' },
      { status: 500 }
    );
  }
}
