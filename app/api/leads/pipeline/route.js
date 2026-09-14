import { NextResponse } from 'next/server';
import { requireAuth, normalizeRole, ROLES } from '@/lib/middleware/authGuard';
import { LeadStore, UserStore } from '@/lib/store';
import { PIPELINE_STAGES, VALID_STAGE_IDS, normalizePipelineStage } from '@/lib/pipelineConfig';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req, [
      ROLES.ADMIN,
      ROLES.USER,
      ROLES.UPDATER_ONLY,
      'owner',
      'manager',
      'salesperson',
      'updater_only'
    ]);
    if (errorResponse) return errorResponse;

    const userRole = normalizeRole(user.role);
    const { searchParams } = new URL(req.url);
    const repFilter = searchParams.get('repId');
    const searchQuery = searchParams.get('search')?.toLowerCase()?.trim();

    let targetUserId = null;

    if (userRole === ROLES.ADMIN) {
      if (repFilter && repFilter !== 'all') {
        targetUserId = repFilter;
      }
    } else if (userRole === ROLES.USER) {
      // Standard users default to their assigned pipeline
      targetUserId = user._id || user.id;
    }

    const leads = await LeadStore.findPipelineLeads(targetUserId);

    // Apply search query filtering if provided
    const filteredLeads = searchQuery
      ? leads.filter(l => {
          const name = (l.name || l.fullName || l.contact?.name || '').toLowerCase();
          const email = (l.email || l.contact?.email || '').toLowerCase();
          const phone = (l.phone || l.contact?.phone || '').toLowerCase();
          const company = (typeof l.company === 'string' ? l.company : (l.company?.name || '')).toLowerCase();
          return name.includes(searchQuery) || email.includes(searchQuery) || phone.includes(searchQuery) || company.includes(searchQuery);
        })
      : leads;

    // Build stage buckets & telemetry counts
    const columns = {};
    const stageCounts = {};

    PIPELINE_STAGES.forEach(stage => {
      columns[stage.id] = [];
      stageCounts[stage.id] = 0;
    });

    // Compute Caller Disposition & Output Classifications
    let meetingBookedCount = 0;
    let voicemailCount = 0;
    let noAnswerCount = 0;
    let callbackCount = 0;
    let qualifiedCount = 0;
    let closedWonCount = 0;
    let notInterestedCount = 0;
    let totalDialsCount = 0;

    filteredLeads.forEach(lead => {
      const canonicalStage = normalizePipelineStage(lead.stage || lead.status);
      const stageKey = VALID_STAGE_IDS.includes(canonicalStage) ? canonicalStage : 'NEW';

      // 3-Role Field Masking: updater_only gets minimal identifiers only
      let leadPayload = null;
      if (userRole === ROLES.UPDATER_ONLY) {
        leadPayload = {
          _id: lead._id || lead.id,
          id: lead._id || lead.id,
          name: lead.name || lead.fullName || lead.contact?.name || 'N/A',
          fullName: lead.fullName || lead.name || lead.contact?.name || 'N/A',
          email: lead.email || lead.contact?.email || '',
          company: typeof lead.company === 'string' ? lead.company : (lead.company?.name || '—'),
          stage: stageKey,
          status: stageKey,
          hasUnansweredReply: Boolean(lead.hasUnansweredReply),
          lastReplySnippet: lead.lastReplySnippet || '',
          stage_updated_at: lead.stage_updated_at || lead.updated_at || lead.created_at
        };
      } else {
        leadPayload = {
          ...lead,
          _id: lead._id || lead.id,
          id: lead._id || lead.id,
          stage: stageKey,
          status: lead.status || stageKey,
          name: lead.name || lead.fullName || lead.contact?.name || 'N/A',
          fullName: lead.fullName || lead.name || lead.contact?.name || 'N/A',
          email: lead.email || lead.contact?.email || '',
          phone: lead.phone || lead.contact?.phone || '',
          company: typeof lead.company === 'string' ? lead.company : (lead.company?.name || 'N/A'),
          hasUnansweredReply: Boolean(lead.hasUnansweredReply),
          lastReplySnippet: lead.lastReplySnippet || '',
          contact: {
            name: lead.name || lead.fullName || lead.contact?.name || 'N/A',
            email: lead.email || lead.contact?.email || '',
            phone: lead.phone || lead.contact?.phone || '',
            position: lead.position || lead.jobTitle || lead.title || lead.contact?.position || ''
          }
        };
      }

      if (!columns[stageKey]) columns[stageKey] = [];
      columns[stageKey].push(leadPayload);
      stageCounts[stageKey] = (stageCounts[stageKey] || 0) + 1;

      // Classifications
      const outcome = String(lead.outcome || lead.last_outcome || lead.status || '').toLowerCase();
      const stg = String(stageKey).toLowerCase();
      const note = String(lead.last_activity_note || lead.notes || '').toLowerCase();

      totalDialsCount += (lead.call_attempts || 0);

      if (stg === 'interested' || outcome === 'meeting_booked' || note.includes('meeting')) {
        meetingBookedCount++;
      } else if (outcome === 'voicemail' || note.includes('voicemail')) {
        voicemailCount++;
      } else if (stg === 'no_response' || outcome === 'no_answer' || note.includes('no answer')) {
        noAnswerCount++;
      } else if (stg === 'follow_up' || outcome === 'callback' || note.includes('callback')) {
        callbackCount++;
      } else if (stg === 'qualified') {
        qualifiedCount++;
      } else if (stg === 'customer' || stg === 'won') {
        closedWonCount++;
      } else if (stg === 'not_interested' || stg === 'do_not_contact' || outcome === 'not_interested' || note.includes('not interested')) {
        notInterestedCount++;
      }
    });

    // Conversion Funnel Metrics
    const conversionFunnel = [
      { stage: 'NEW', label: 'New Ingested', count: stageCounts['NEW'] || 0 },
      { stage: 'CONTACTED', label: 'Contacted', count: stageCounts['CONTACTED'] || 0 },
      { stage: 'ENGAGED', label: 'Engaged / Replied', count: stageCounts['ENGAGED'] || 0 },
      { stage: 'INTERESTED', label: 'Interested / Demo', count: stageCounts['INTERESTED'] || 0 },
      { stage: 'QUALIFIED', label: 'Qualified', count: stageCounts['QUALIFIED'] || 0 },
      { stage: 'CUSTOMER', label: 'Customer (Won)', count: stageCounts['CUSTOMER'] || 0 }
    ];

    // Fetch team sales reps for manager filter dropdown (admin only)
    let salesReps = [];
    if (userRole === ROLES.ADMIN) {
      const allUsers = await UserStore.findAllUsers();
      salesReps = allUsers.filter(u => u.approved);
    }

    return NextResponse.json({
      success: true,
      data: {
        stages: PIPELINE_STAGES,
        columns,
        stageCounts,
        totalLeads: filteredLeads.length,
        userRole,
        outcomeClassification: {
          meetingBooked: meetingBookedCount,
          voicemail: voicemailCount,
          noAnswer: noAnswerCount,
          callbackScheduled: callbackCount,
          qualified: qualifiedCount,
          closedWon: closedWonCount,
          notInterested: notInterestedCount,
          totalDials: totalDialsCount
        },
        conversionFunnel,
        salesReps
      }
    });
  } catch (err) {
    console.error('[Pipeline GET API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error fetching pipeline leads.' },
      { status: 500 }
    );
  }
}
