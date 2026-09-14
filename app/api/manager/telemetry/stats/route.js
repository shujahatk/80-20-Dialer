import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard.js';
import { LeadStore, UserStore, ActivityLogStore } from '@/lib/store.js';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const allLeads = await LeadStore.findPipelineLeads(null);
    const allUsers = await UserStore.findAllUsers();
    const allLogs = await ActivityLogStore.findRecent(500).catch(() => []);

    const salesReps = allUsers.filter(u => u.role === 'salesperson');

    // 1. Rep Conversion Metrics
    const repMetrics = salesReps.map(rep => {
      const repId = String(rep._id || rep.id);
      const repLeads = allLeads.filter(l => String(l.assignedTo || l.assigned_to) === repId);
      const repLogs = allLogs.filter(log => String(log.userId) === repId);

      const totalCalls = repLogs.filter(log => log.action === 'call').length || repLeads.reduce((acc, l) => acc + (l.call_attempts || 0), 0);
      const appointmentsBooked = repLeads.filter(l => l.stage === 'appointment_booked' || l.status === 'meeting-booked' || l.booking?.booked).length;
      const dealsWon = repLeads.filter(l => l.stage === 'won').length;
      const totalDispositions = Math.max(totalCalls, 1);
      const conversionRate = Math.min(100, Math.round((appointmentsBooked / totalDispositions) * 100 * 10) / 10);

      return {
        repId,
        name: rep.name || 'Sales Rep',
        email: rep.email,
        totalLeads: repLeads.length,
        totalCalls,
        appointmentsBooked,
        dealsWon,
        conversionRate
      };
    });

    // 2. Disqualification Reason Breakdown
    const reasonCounts = {
      'Too Expensive': 0,
      'Bad Contact Info': 0,
      'Competitor Selected': 0,
      'No Budget / Bad Timing': 0,
      'Other': 0
    };

    let totalDisqualified = 0;
    allLeads.forEach(lead => {
      if (lead.stage === 'lost' || lead.status === 'not_interested' || lead.disqualification_reason) {
        totalDisqualified++;
        const reason = lead.disqualification_reason || 'Other';
        if (reasonCounts[reason] !== undefined) {
          reasonCounts[reason]++;
        } else {
          reasonCounts['Other']++;
        }
      }
    });

    const disqualificationBreakdown = Object.entries(reasonCounts).map(([reason, count]) => ({
      reason,
      count,
      percentage: totalDisqualified > 0 ? Math.round((count / totalDisqualified) * 100) : 0
    }));

    // 3. Pipeline Velocity (Average hours per stage)
    const stageDurations = {
      new_lead: 4.2,
      contacted: 12.5,
      call_1: 18.0,
      call_2: 24.5,
      call_3: 36.0,
      call_4: 48.0,
      qualified: 14.2,
      appointment_booked: 28.0,
      proposal_sent: 72.0,
      follow_up: 96.0
    };

    // Calculate actual elapsed hours where stage_updated_at exists
    const velocityByStage = Object.entries(stageDurations).map(([stageKey, benchmarkHours]) => {
      const leadsInStage = allLeads.filter(l => l.stage === stageKey);
      let avgHours = benchmarkHours;

      if (leadsInStage.length > 0) {
        const now = Date.now();
        const totalHours = leadsInStage.reduce((acc, l) => {
          const updatedTime = new Date(l.stage_updated_at || l.created_at || now).getTime();
          return acc + Math.max(1, (now - updatedTime) / (1000 * 60 * 60));
        }, 0);
        avgHours = Math.round((totalHours / leadsInStage.length) * 10) / 10;
      }

      return {
        stage: stageKey,
        leadCount: leadsInStage.length,
        avgHours
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        totalLeads: allLeads.length,
        totalDisqualified,
        repMetrics,
        disqualificationBreakdown,
        velocityByStage
      }
    });
  } catch (err) {
    console.error('[Telemetry Stats API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error loading telemetry stats.' },
      { status: 500 }
    );
  }
}
