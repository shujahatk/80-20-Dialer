import { NextResponse } from 'next/server.js';
import { requireAuth, canAccessResource } from '../../../../lib/middleware/authGuard.js';
import { LeadStore } from '../../../../lib/store.js';

// GET /api/leads/[id] - Retrieves lead and locks it securely
export async function GET(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id: leadId } = await params;
    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // IDOR Check: Ensure salesperson only accesses leads assigned to them
    const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;
    if (!canAccessResource(user, leadOwner)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to access this lead.' },
        { status: 403 }
      );
    }

    // Atomically acquire workstation lock
    const lockResult = await LeadStore.acquireAtomicLock(leadId, user._id || user.id);
    if (!lockResult.success) {
      return NextResponse.json(
        {
          success: false,
          code: 'LEAD_LOCKED',
          message: lockResult.message || 'This lead is currently being contacted by another agent.',
          lockedBy: lockResult.lockedBy
        },
        { status: lockResult.status || 423 }
      );
    }

    return NextResponse.json({
      success: true,
      data: lockResult.lead || lead
    });

  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

// PUT /api/leads/[id] - Updates general lead fields securely
export async function PUT(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id: leadId } = await params;
    const existingLead = await LeadStore.findById(leadId);
    if (!existingLead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // IDOR Check: Ensure salesperson only updates leads assigned to them
    const leadOwner = existingLead.assignedTo || existingLead.assigned_to || existingLead.userId;
    if (!canAccessResource(user, leadOwner)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to update this lead.' },
        { status: 403 }
      );
    }

    const body = await req.json();

    // Prevent mass assignment of system/protected fields
    const allowedFields = ['contact', 'company', 'geography', 'status', 'notes', 'priority', 'coldOutreachStopped', 'hasUnansweredReply', 'suppression'];
    const updateData = {};

    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }

    // Only managers/admins/owners can change lead assignment via PUT
    if (['owner', 'admin', 'manager'].includes(user.role) && body.assignedTo !== undefined) {
      updateData.assignedTo = body.assignedTo;
      updateData.assigned_to = body.assignedTo;
    }

    const updatedLead = await LeadStore.update(leadId, updateData);

    return NextResponse.json({
      success: true,
      message: 'Lead updated successfully.',
      data: updatedLead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

// DELETE /api/leads/[id] - Secure deletion (Manager/Admin/Owner only)
export async function DELETE(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    // Strict Role Authorization: Salespeople are NEVER allowed to delete leads
    if (!['owner', 'admin', 'manager'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Sales representatives are not permitted to delete leads.' },
        { status: 403 }
      );
    }

    const { id: leadId } = await params;
    if (!leadId || typeof leadId !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Valid lead ID is required.' },
        { status: 400 }
      );
    }

    const existingLead = await LeadStore.findById(leadId);
    if (!existingLead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    const leadName = existingLead.contact?.name || existingLead.name || 'N/A';
    const leadEmail = existingLead.contact?.email || existingLead.email || '';

    await LeadStore.delete(leadId);

    // Audit log
    const { logAuditEvent } = await import('../../../../lib/auditLogger.js');
    await logAuditEvent({
      userId: user._id || user.id,
      action: 'delete_lead',
      entityType: 'lead',
      entityId: leadId,
      leadId: leadId,
      notes: `Permanently deleted lead '${leadName}' (${leadEmail || leadId}).`,
      req
    });

    return NextResponse.json({
      success: true,
      message: `Lead '${leadName}' was permanently deleted.`,
      data: { leadId, deleted: true }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

