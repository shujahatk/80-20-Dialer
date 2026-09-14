import { NextResponse } from 'next/server.js';
import { requireAuth, canAccessResource } from '../../../../lib/middleware/authGuard.js';
import { LeadStore, UserStore } from '../../../../lib/store.js';




export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { leadId, action = 'lock' } = body;

    if (!leadId) {
      return NextResponse.json(
        { success: false, message: 'leadId is required.' },
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

    // Permission check
    const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;
    if (!canAccessResource(user, leadOwner)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to lock this lead.' },
        { status: 403 }
      );
    }

    const uId = String(user._id || user.id);

    // Heartbeat action: Renew active lock
    if (action === 'heartbeat') {
      const currentHolder = lead.locked_by || lead.currentlyBeingWorkedBy;
      if (currentHolder && String(currentHolder) !== uId) {
        return NextResponse.json(
          { success: false, message: 'Cannot renew heartbeat on a lead locked by another agent.' },
          { status: 403 }
        );
      }
      const renewed = await LeadStore.renewLockHeartbeat(leadId, uId);
      return NextResponse.json({
        success: true,
        message: 'Lock heartbeat renewed.',
        data: renewed
      });
    }

    // Atomic Lock Acquisition
    const lockRes = await LeadStore.acquireAtomicLock(leadId, uId);
    if (!lockRes.success) {
      let lockHolderName = 'Another Agent';
      if (lockRes.lockedBy) {
        try {
          const holder = await UserStore.findById(lockRes.lockedBy);
          if (holder && holder.name) lockHolderName = holder.name;
        } catch (e) {}
      }

      return NextResponse.json(
        {
          success: false,
          code: 'LEAD_LOCKED',
          message: lockRes.message || `Collision avoided: This lead is currently being worked by ${lockHolderName}.`,
          lockedBy: lockRes.lockedBy,
          lockHolderName
        },
        { status: lockRes.status || 423 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Atomic lead lock acquired.',
      data: lockRes.lead
    });
  } catch (err) {
    console.error('[Lead Lock API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error acquiring lead lock.' },
      { status: 500 }
    );
  }
}

