import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard.js';
import { LeadStore, UserStore } from '@/lib/store.js';

const STALE_THRESHOLD_HOURS = 48;
const CADENCE_STAGES = ['call_1', 'call_2', 'call_3', 'call_4'];

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const allLeads = await LeadStore.findPipelineLeads(null);
    const allUsers = await UserStore.findAllUsers();

    const userMap = new Map();
    allUsers.forEach(u => {
      userMap.set(String(u._id || u.id), u);
      if (u.email) userMap.set(u.email, u);
    });

    const now = Date.now();
    const staleThresholdMs = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

    const staleLeads = allLeads.filter(lead => {
      if (!CADENCE_STAGES.includes(lead.stage)) return false;

      const lastActivityTime = new Date(
        lead.stage_updated_at || lead.lastActionDate || lead.updated_at || lead.created_at || now
      ).getTime();

      const hoursInactive = (now - lastActivityTime) / (1000 * 60 * 60);
      return hoursInactive >= STALE_THRESHOLD_HOURS;
    }).map(lead => {
      const repKey = String(lead.assignedTo || lead.assigned_to || '');
      const assignedRep = userMap.get(repKey);
      const lastActivityTime = new Date(
        lead.stage_updated_at || lead.lastActionDate || lead.updated_at || lead.created_at || now
      ).getTime();
      const hoursInactive = Math.floor((now - lastActivityTime) / (1000 * 60 * 60));

      return {
        _id: lead._id || lead.id,
        id: lead._id || lead.id,
        name: lead.contact?.name || lead.name || 'Unknown Prospect',
        email: lead.contact?.email || lead.email || '—',
        phone: lead.contact?.phone || lead.phone || '—',
        company: lead.company?.name || lead.company || '—',
        stage: lead.stage,
        assignedRepId: repKey || null,
        assignedRepName: assignedRep ? assignedRep.name : 'Unassigned',
        assignedRepEmail: assignedRep ? assignedRep.email : '—',
        hoursInactive,
        callAttempts: lead.call_attempts || 0,
        lastActivityNote: lead.last_activity_note || lead.lastAction || 'No recent activity recorded'
      };
    });

    return NextResponse.json({
      success: true,
      count: staleLeads.length,
      thresholdHours: STALE_THRESHOLD_HOURS,
      data: staleLeads
    });
  } catch (err) {
    console.error('[Stale Lead Detector API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error detecting stale leads.' },
      { status: 500 }
    );
  }
}
