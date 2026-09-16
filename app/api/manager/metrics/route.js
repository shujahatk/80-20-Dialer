import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { LeadStore, UserStore, CallStore, MessageStore, ActivityLogStore, BlastCampaignStore } from '@/lib/store';

export async function GET(req) {
  try {
    const auth = await requireManager(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const db = getSupabaseClient();

    // Execute targeted database count / aggregation queries in parallel
    const [
      leadsCountRes,
      meetingsCountRes,
      activeAgentsRes,
      callsTodayRes,
      connectedCallsRes,
      emailsSentRes,
      smsSentRes,
      whatsappSentRes,
      campaignsRes
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      db.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).in('status', ['meeting-booked', 'interested', 'meeting_booked', 'booked']),
      db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'salesperson').is('approved', true).gte('last_active', fiveMinutesAgo),
      db.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', startOfTodayUtc),
      db.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', startOfTodayUtc).or('duration.gt.0,status.in.(completed,answered,in-progress)'),
      db.from('messages').select('*', { count: 'exact', head: true }).eq('channel', 'email').gte('created_at', startOfTodayUtc),
      db.from('messages').select('*', { count: 'exact', head: true }).eq('channel', 'sms').gte('created_at', startOfTodayUtc),
      db.from('messages').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp').gte('created_at', startOfTodayUtc),
      db.from('blast_campaigns').select('*', { count: 'exact', head: true }).in('status', ['processing', 'running'])
    ]);

    const totalLeads = leadsCountRes?.count ?? 0;
    const meetingsBooked = meetingsCountRes?.count ?? 0;
    const activeAgents = activeAgentsRes?.count ?? 0;
    const callsToday = callsTodayRes?.count ?? 0;
    const connectedCalls = connectedCallsRes?.count ?? 0;
    const emailsSent = emailsSentRes?.count ?? 0;
    const smsSent = smsSentRes?.count ?? 0;
    const whatsappSent = whatsappSentRes?.count ?? 0;
    const runningCampaigns = campaignsRes?.count ?? 0;

    const totalTouches = callsToday + emailsSent + smsSent + whatsappSent;
    const connectionRate = callsToday > 0 ? `${((connectedCalls / callsToday) * 100).toFixed(1)}%` : '0.0%';
    const replyRate = emailsSent > 0 ? `${((meetingsBooked / emailsSent) * 100).toFixed(1)}%` : '0.0%';

    return NextResponse.json({
      success: true,
      data: {
        totalLeads,
        callsToday,
        connectedCalls,
        connectionRate,
        meetingsBooked,
        emailsSent,
        smsSent,
        whatsappSent,
        totalTouches,
        replyRate,
        activeAgents,
        runningCampaigns
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Server error occurred.' } },
      { status: 500 }
    );
  }
}
