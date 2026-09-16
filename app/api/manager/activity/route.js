import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient } from '@/lib/supabase';

function calculateDateBounds(dateRange, startDateParam, endDateParam) {
  const now = new Date();
  let start = null;
  let end = null;

  if (dateRange === 'today') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
  } else if (dateRange === 'yesterday') {
    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    start = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate())).toISOString();
    end = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 23, 59, 59, 999)).toISOString();
  } else if (dateRange === '7d') {
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    start = d7.toISOString();
  } else if (dateRange === '30d') {
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    start = d30.toISOString();
  } else if (dateRange === 'custom') {
    if (startDateParam) start = new Date(startDateParam).toISOString();
    if (endDateParam) {
      const e = new Date(endDateParam);
      if (endDateParam.length <= 10) e.setUTCHours(23, 59, 59, 999);
      end = e.toISOString();
    }
  }

  return { start, end };
}

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

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatAction(action, channel, outcome) {
  const ch = extractString(channel).toLowerCase();
  const act = extractString(action).toLowerCase();
  const out = extractString(outcome).toLowerCase();

  if (act === 'call' || ch === 'call' || ch === 'phone') return 'Outbound Call';
  if (act === 'email' || ch === 'email') return 'Email Sent';
  if (act === 'sms' || ch === 'sms') return 'SMS Sent';
  if (act === 'whatsapp' || ch === 'whatsapp') return 'WhatsApp Sent';
  if (act === 'status_changed' || act === 'stage' || act === 'stage_changed') return 'Stage Changed';
  if (out === 'meeting_booked' || out === 'meeting-booked') return 'Meeting Booked';
  return act ? act.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Activity';
}

function formatStatus(status, outcome, duration) {
  const s = extractString(status || outcome).toLowerCase();
  if (s === 'completed' || s === 'answered' || s === 'in-progress') {
    return duration > 0 ? 'Connected' : 'Completed';
  }
  if (s === 'no-answer' || s === 'no_answer') return 'No Answer';
  if (s === 'busy') return 'Line Busy';
  if (s === 'failed') return 'Failed';
  if (s === 'delivered') return 'Delivered';
  if (s === 'inbound-reply' || s === 'replied') return 'Replied';
  if (s === 'meeting_booked' || s === 'meeting-booked' || s === 'interested') return 'Interested';
  return s ? s.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Logged';
}

export async function GET(req) {
  try {
    const auth = await requireManager(req);
    if (auth.errorResponse) return auth.errorResponse;

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 50));
    const userId = url.searchParams.get('userId') || url.searchParams.get('user') || null;
    const channel = url.searchParams.get('channel') || null;
    const status = url.searchParams.get('status') || null;
    const dateRange = url.searchParams.get('dateRange') || url.searchParams.get('range') || '7d';
    const startDateParam = url.searchParams.get('startDate') || null;
    const endDateParam = url.searchParams.get('endDate') || null;
    const search = (url.searchParams.get('search') || '').trim();
    const isExport = url.searchParams.get('export') === 'csv';

    const { start, end } = calculateDateBounds(dateRange, startDateParam, endDateParam);
    const db = getSupabaseClient();

    // 1. Build Base Activity Logs Query
    let query = db
      .from('activity_logs')
      .select('*', { count: 'exact' });

    if (userId && userId !== 'all') {
      query = query.eq('user_id', String(userId));
    }

    if (channel && channel !== 'all') {
      if (channel === 'call' || channel === 'phone') {
        query = query.or('channel.eq.call,channel.eq.phone,action.eq.call');
      } else if (channel === 'email') {
        query = query.or('channel.eq.email,action.eq.email');
      } else if (channel === 'sms') {
        query = query.or('channel.eq.sms,action.eq.sms');
      } else if (channel === 'whatsapp') {
        query = query.or('channel.eq.whatsapp,action.eq.whatsapp');
      } else if (channel === 'stage') {
        query = query.or('action.eq.STATUS_CHANGED,action.eq.stage_changed,action.eq.stage');
      }
    }

    if (status && status !== 'all') {
      const s = status.toLowerCase();
      if (s === 'connected') {
        query = query.or('duration.gt.0,outcome.in.(completed,answered,connected)');
      } else if (s === 'no-answer' || s === 'no_answer') {
        query = query.or('outcome.eq.no-answer,outcome.eq.no_answer,outcome.eq.busy');
      } else if (s === 'delivered') {
        query = query.eq('outcome', 'delivered');
      } else if (s === 'replied') {
        query = query.or('outcome.eq.inbound-reply,outcome.eq.replied');
      } else {
        query = query.ilike('outcome', `%${s}%`);
      }
    }

    if (start) {
      query = query.gte('created_at', start);
    }
    if (end) {
      query = query.lte('created_at', end);
    }

    // Sort newest first
    query = query.order('created_at', { ascending: false });

    // Pagination or full fetch for CSV
    if (!isExport) {
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1);
    } else {
      query = query.limit(2000);
    }

    const { data: rawLogs, count, error } = await query;
    if (error) {
      throw new Error(`Activity query error: ${error.message}`);
    }

    const logs = rawLogs || [];
    const total = count || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // 2. Fetch Associated Users and Leads in Batch for Fast Resolution
    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];
    const leadIds = [...new Set(logs.map(l => l.lead_id).filter(Boolean))];

    const [usersMapRes, leadsMapRes] = await Promise.all([
      userIds.length > 0
        ? db.from('users').select('id, name, email, role').in('id', userIds)
        : Promise.resolve({ data: [] }),
      leadIds.length > 0
        ? db.from('leads').select('id, name, company, phone, email, stage, status').in('id', leadIds)
        : Promise.resolve({ data: [] })
    ]);

    const usersMap = new Map((usersMapRes.data || []).map(u => [String(u.id), u]));
    const leadsMap = new Map((leadsMapRes.data || []).map(l => [String(l.id), l]));

    // 3. Enrich records
    let enriched = logs.map(log => {
      const u = usersMap.get(String(log.user_id));
      const l = leadsMap.get(String(log.lead_id));

      const durationSecs = Number(log.duration) || 0;
      const formattedAct = formatAction(log.action, log.channel, log.outcome);
      const formattedSt = formatStatus(log.status, log.outcome, durationSecs);
      const formattedRes = durationSecs > 0 ? formatDuration(durationSecs) : extractString(log.outcome, '—');

      const uName = extractString(u?.name) || (log.user_id ? 'Salesperson' : 'System');
      const lName = extractString(l?.name) || extractString(log.lead_name) || 'Contact';
      const lCompany = extractString(l?.company) || extractString(log.lead_company) || 'Individual Lead';

      return {
        id: String(log.id || log._id || Math.random()),
        timestamp: log.created_at,
        userId: log.user_id ? String(log.user_id) : null,
        userName: uName,
        userEmail: extractString(u?.email),
        userRole: extractString(u?.role, 'salesperson'),
        leadId: log.lead_id ? String(log.lead_id) : null,
        leadName: lName,
        leadCompany: lCompany,
        leadPhone: extractString(l?.phone || log.phone),
        leadEmail: extractString(l?.email || log.email),
        channel: extractString(log.channel || (log.action === 'call' ? 'call' : log.action === 'email' ? 'email' : 'system')),
        action: formattedAct,
        status: formattedSt,
        result: formattedRes,
        duration: durationSecs,
        notes: extractString(log.notes || log.summary),
        previousStatus: extractString(log.previousStatus || log.previous_status),
        newStatus: extractString(log.newStatus || log.new_status),
        messageSid: log.message_sid,
        callSid: log.call_sid,
        recordingUrl: log.recording_url,
        details: {
          action: log.action,
          channel: log.channel,
          direction: log.direction || 'outbound',
          outcome: log.outcome,
          duration: durationSecs,
          notes: log.notes || '',
          messageSid: log.message_sid,
          callSid: log.call_sid,
          recordingUrl: log.recording_url,
          emailType: log.blast_campaign_id ? 'blast' : 'individual',
          campaignId: log.blast_campaign_id || null
        }
      };
    });

    // 4. In-Memory Search Filter (if search was provided)
    if (search) {
      const q = search.toLowerCase();
      enriched = enriched.filter(item => 
        (item.userName || '').toLowerCase().includes(q) ||
        (item.userEmail || '').toLowerCase().includes(q) ||
        (item.leadName || '').toLowerCase().includes(q) ||
        (item.leadCompany || '').toLowerCase().includes(q) ||
        (item.leadPhone || '').toLowerCase().includes(q) ||
        (item.leadEmail || '').toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q)
      );
    }

    // 5. Handle CSV Export Response
    if (isExport) {
      const headers = ['Timestamp', 'Salesperson', 'User Email', 'Lead Name', 'Company', 'Phone', 'Email', 'Channel', 'Action', 'Status', 'Result', 'Notes'];
      const csvRows = [headers.join(',')];

      for (const row of enriched) {
        const line = [
          `"${new Date(row.timestamp).toLocaleString()}"`,
          `"${(row.userName || '').replace(/"/g, '""')}"`,
          `"${(row.userEmail || '').replace(/"/g, '""')}"`,
          `"${(row.leadName || '').replace(/"/g, '""')}"`,
          `"${(row.leadCompany || '').replace(/"/g, '""')}"`,
          `"${(row.leadPhone || '').replace(/"/g, '""')}"`,
          `"${(row.leadEmail || '').replace(/"/g, '""')}"`,
          `"${(row.channel || '').toUpperCase()}"`,
          `"${(row.action || '').replace(/"/g, '""')}"`,
          `"${(row.status || '').replace(/"/g, '""')}"`,
          `"${(row.result || '').replace(/"/g, '""')}"`,
          `"${(row.notes || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(line.join(','));
      }

      return new Response(csvRows.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="activity_history_${new Date().toISOString().slice(0, 10)}.csv"`
        }
      });
    }

    return NextResponse.json({
      success: true,
      page,
      limit,
      total,
      totalPages,
      count: enriched.length,
      data: enriched
    });
  } catch (err) {
    console.error('[Manager Activity API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch activity history.' },
      { status: 500 }
    );
  }
}
