import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard.js';
import { LeadStore } from '@/lib/store.js';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { leadId } = body;

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

    const { isManagerOrAdmin } = await import('@/lib/middleware/authGuard.js');
    const uId = String(user._id || user.id);
    const currentLockHolder = lead.locked_by || lead.currentlyBeingWorkedBy;

    // A salesperson can only unlock their own lock; managers/admins can unlock any
    if (currentLockHolder && currentLockHolder.toString() !== uId && !isManagerOrAdmin(user)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You can only release lead locks acquired by yourself.' },
        { status: 403 }
      );
    }

    // Release lock
    const unlockedLead = await LeadStore.update(leadId, {
      locked_by: null,
      locked_at: null,
      currentlyBeingWorked: false,
      currentlyBeingWorkedBy: null,
      currentlyBeingWorkedAt: null
    });

    return NextResponse.json({
      success: true,
      message: 'Lead lock released successfully.',
      data: unlockedLead
    });
  } catch (err) {
    console.error('[Lead Unlock API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error releasing lead lock.' },
      { status: 500 }
    );
  }
}
