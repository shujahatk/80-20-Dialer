import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource, normalizeRole, ROLES } from '@/lib/middleware/authGuard';
import { LeadStore, ActivityLogStore } from '@/lib/store';
import { PIPELINE_STAGES, VALID_STAGE_IDS, normalizePipelineStage } from '@/lib/pipelineConfig';

export async function PATCH(req) {
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
    const body = await req.json();
    const leadId = body.leadId || body.id;
    const rawStage = body.newStage || body.stage || body.status;
    const note = body.note || body.notes;

    if (!leadId) {
      return NextResponse.json(
        { success: false, message: 'leadId is required.' },
        { status: 400 }
      );
    }

    if (!rawStage) {
      return NextResponse.json(
        { success: false, message: 'newStage or status is required.' },
        { status: 400 }
      );
    }

    const canonicalStage = normalizePipelineStage(rawStage);

    if (!VALID_STAGE_IDS.includes(canonicalStage)) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Invalid stage: '${rawStage}'. Allowed stages: ${VALID_STAGE_IDS.join(', ')}` 
        },
        { status: 400 }
      );
    }

    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // IDOR Check: Ensure user has permission
    const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;
    if (!canAccessResource(user, leadOwner)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to transition this lead stage.' },
        { status: 403 }
      );
    }

    const oldStage = normalizePipelineStage(lead.stage || lead.status || 'NEW');
    
    // Updater only can only update status/stage (no custom note editing)
    const effectiveNote = userRole === ROLES.UPDATER_ONLY 
      ? `Stage updated to ${canonicalStage}` 
      : (note || `Stage changed from ${oldStage} to ${canonicalStage}`);

    const updatedLead = await LeadStore.updateStage(leadId, canonicalStage, effectiveNote);

    // Record immutable audit entry in ActivityLog
    try {
      await ActivityLogStore.create({
        leadId,
        userId: user._id || user.id,
        action: 'STATUS_CHANGED',
        channel: 'system',
        direction: 'system',
        summary: `Status changed from ${oldStage} to ${canonicalStage}`,
        previousStatus: oldStage,
        newStatus: canonicalStage,
        notes: effectiveNote
      });
    } catch (actErr) {
      console.warn('[ActivityLog record notice]:', actErr.message);
    }

    // Execute Automated Background Stage Triggers (e.g. Listmonk suppression / sequence halts)
    try {
      const { handleStageChangeTrigger } = await import('@/lib/triggers/stageTriggers.js');
      handleStageChangeTrigger(updatedLead, oldStage, canonicalStage).catch(console.error);
    } catch (triggerErr) {
      console.warn('Stage trigger warning:', triggerErr);
    }

    return NextResponse.json({
      success: true,
      message: `Lead stage transitioned to '${canonicalStage}'.`,
      data: updatedLead
    });
  } catch (err) {
    console.error('[Lead Stage PATCH API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error transitioning lead stage.' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  return PATCH(req);
}
