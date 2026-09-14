import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { LeadStore } from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';


// POST /api/manager/leads/[id]/restore - Restore a soft-deleted lead from Trash
export async function POST(req, { params }) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return NextResponse.json(
        { success: false, message: 'Valid lead ID is required.' },
        { status: 400 }
      );
    }

    const leadId = id.trim();
    const restored = await LeadStore.restore(leadId);

    if (!restored) {
      return NextResponse.json(
        { success: false, message: 'Lead could not be restored or was not found.' },
        { status: 404 }
      );
    }

    const lead = await LeadStore.findById(leadId);

    await logAuditEvent({
      userId: user._id || user.id,
      action: 'restore_lead',
      entityType: 'lead',
      entityId: leadId,
      leadId: leadId,
      notes: `Restored lead '${lead?.contact?.name || lead?.name || leadId}' from Trash.`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'Lead restored successfully.',
      data: lead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred during lead restore.' },
      { status: 500 }
    );
  }
}
