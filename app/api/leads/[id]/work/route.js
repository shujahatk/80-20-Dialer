import { NextResponse } from 'next/server';
import { requireAuth, assertLeadAccess, isManagerOrAdmin } from '@/lib/middleware/authGuard';
import { LeadStore, ActivityLogStore } from '@/lib/store';
import { triggerCrmWebhook } from '@/lib/crmWebhook';

const AUTO_RETRY_DELAYS = {
  'no-answer': 60 * 60 * 1000,   // 1 hour
  'busy': 30 * 60 * 1000,        // 30 mins
  'voicemail': 2 * 60 * 60 * 1000 // 2 hours
};

const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// POST: Log call outcome and disposition, release lock
export async function POST(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id: leadId } = await params;
    const body = await req.json();
    const { outcome, notes, duration, callSid, callbackDate, booking } = body;

    if (!outcome) {
      return NextResponse.json(
        { success: false, message: 'Outcome is required.' },
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

    if (!assertLeadAccess(user, lead)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to work this lead.' },
        { status: 403 }
      );
    }

    // Verify lock ownership if currently locked
    const now = Date.now();
    const lockedTime = lead.locked_at ? new Date(lead.locked_at).getTime() : 0;
    const isLockActive = lead.locked_by && (now - lockedTime < LOCK_DURATION_MS);

    if (isLockActive && String(lead.locked_by) !== String(user._id || user.id) && !isManagerOrAdmin(user)) {
      return NextResponse.json(
        { success: false, message: 'Lock error: This lead is currently being contacted by another agent.' },
        { status: 409 }
      );
    }

    const previousStatus = lead.status;
    const nowDate = new Date();

    // Map outcome to pipeline stage
    let resolvedStage = body.stage;
    if (!resolvedStage) {
      if (outcome === 'meeting-booked') resolvedStage = 'MEETING_BOOKED';
      else if (outcome === 'interested') resolvedStage = 'QUALIFIED';
      else if (['not-interested', 'wrong-number', 'dnc', 'opted-out'].includes(outcome)) resolvedStage = 'CLOSED_WON';
      else if (outcome === 'callback') resolvedStage = 'CONTACTED';
      else if (['no-answer', 'busy', 'voicemail'].includes(outcome)) resolvedStage = 'CONTACTED';
    }

    const updateData = {
      status: outcome,
      lastAction: notes || `Call - ${outcome}`,
      lastActionDate: nowDate,
      hasUnansweredReply: false,
      ...(resolvedStage ? { stage: resolvedStage, stage_updated_at: nowDate.toISOString(), last_activity_note: notes || `Call outcome: ${outcome}` } : {}),
      // Release lock atomically
      locked_by: null,
      locked_at: null,
      currentlyBeingWorked: false,
      currentlyBeingWorkedBy: null,
      currentlyBeingWorkedAt: null
    };

    if (outcome === 'meeting-booked') {
      updateData.booking = {
        booked: true,
        meetingDate: booking?.meetingDate ? new Date(booking.meetingDate) : nowDate,
        meetingTimezone: booking?.meetingTimezone || 'UTC',
        closer: booking?.closer || user.name,
        meetingLink: booking?.meetingLink || ''
      };
    } else if (['not-interested', 'wrong-number', 'dnc', 'opted-out'].includes(outcome)) {
      updateData.coldOutreachStopped = true;
      if (outcome === 'dnc' || outcome === 'opted-out') {
        updateData.suppression = { phone: true, email: true, sms: true, whatsapp: true };
      }
      if (outcome === 'wrong-number') {
        updateData.suppression = { ...(lead.suppression || {}), phone: true };
      }
    }

    const updatedLead = await LeadStore.update(leadId, updateData);

    // Save call timeline log
    await ActivityLogStore.create({
      leadId,
      userId: user._id || user.id,
      action: 'call',
      channel: 'phone',
      direction: 'outbound',
      outcome,
      previousStatus,
      newStatus: outcome,
      notes: notes || '',
      duration: duration || 0,
      messageSid: callSid || ''
    });

    if (outcome === 'meeting-booked') {
      const history = await ActivityLogStore.findByLead(leadId);
      triggerCrmWebhook(updatedLead, history).catch(() => null);
    }

    return NextResponse.json({
      success: true,
      message: 'Call outcome successfully logged and lead released.',
      data: updatedLead
    });
  } catch (err) {
    console.error('[Lead Work POST Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

// PATCH: Atomically claim/lock OR release/unlock a lead
export async function PATCH(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id: leadId } = await params;
    const body = await req.json();
    const { action = 'claim' } = body; // 'claim' | 'release'

    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json({ success: false, message: 'Lead not found.' }, { status: 404 });
    }

    if (!assertLeadAccess(user, lead)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to access this lead.' },
        { status: 403 }
      );
    }

    const userId = String(user._id || user.id);
    const now = Date.now();
    const lockedTime = lead.locked_at ? new Date(lead.locked_at).getTime() : 0;
    const isLocked = lead.locked_by && (now - lockedTime < LOCK_DURATION_MS);

    if (action === 'claim') {
      if (isLocked && String(lead.locked_by) !== userId && !isManagerOrAdmin(user)) {
        return NextResponse.json(
          { success: false, message: 'Conflict: This lead is currently claimed by another agent.', lockedBy: lead.locked_by },
          { status: 409 }
        );
      }

      const updated = await LeadStore.update(leadId, {
        locked_by: userId,
        locked_at: new Date().toISOString(),
        currentlyBeingWorked: true,
        currentlyBeingWorkedBy: userId,
        currentlyBeingWorkedAt: new Date().toISOString()
      });

      return NextResponse.json({ success: true, message: 'Lead claimed successfully.', data: updated });
    }

    if (action === 'release') {
      // Only the lock owner or a manager/admin can release a lock
      if (isLocked && String(lead.locked_by) !== userId && !isManagerOrAdmin(user)) {
        return NextResponse.json(
          { success: false, message: 'Forbidden: You cannot release a lock held by another agent.' },
          { status: 403 }
        );
      }

      const updated = await LeadStore.update(leadId, {
        locked_by: null,
        locked_at: null,
        currentlyBeingWorked: false,
        currentlyBeingWorkedBy: null,
        currentlyBeingWorkedAt: null
      });

      return NextResponse.json({ success: true, message: 'Lead lock released.', data: updated });
    }

    return NextResponse.json({ success: false, message: 'Invalid action specified.' }, { status: 400 });
  } catch (err) {
    console.error('[Lead Work PATCH Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
