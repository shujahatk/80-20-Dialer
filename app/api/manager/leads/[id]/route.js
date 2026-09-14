import { NextResponse } from 'next/server.js';
import { requireManager } from '../../../../../lib/middleware/authGuard.js';
import { LeadStore } from '../../../../../lib/store.js';
import { logAuditEvent } from '../../../../../lib/auditLogger.js';

// GET /api/manager/leads/[id] - Fetch single lead for manager review
export async function GET(req, { params }) {
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

    const lead = await LeadStore.findById(id.trim());
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: lead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

// DELETE /api/manager/leads/[id] - Soft delete by default; Permanent purge restricted to Admin/Owner
export async function DELETE(req, { params }) {
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
    // Search both active and soft-deleted leads
    let existingLead = await LeadStore.findById(leadId);
    if (!existingLead) {
      const deletedLeads = await LeadStore.findDeleted();
      existingLead = deletedLeads.find(l => (l._id === leadId || l.id === leadId));
    }

    if (!existingLead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    const leadName = existingLead.contact?.name || existingLead.name || 'N/A';
    const leadEmail = existingLead.contact?.email || existingLead.email || '';
    const leadPhone = existingLead.contact?.phone || existingLead.phone || '';

    const url = new URL(req.url);
    const isPermanent = url.searchParams.get('permanent') === 'true' || url.searchParams.get('purge') === 'true';

    if (isPermanent) {
      // Permanent purge is strictly restricted to Admin and Owner
      const isOwnerOrAdmin = ['owner', 'admin'].includes(user.role);
      if (!isOwnerOrAdmin) {
        return NextResponse.json(
          { success: false, message: 'Forbidden. Permanent lead purge requires Admin or Owner role.' },
          { status: 403 }
        );
      }

      await LeadStore.purgePermanent(leadId);

      await logAuditEvent({
        userId: user._id || user.id,
        action: 'purge_lead_permanent',
        entityType: 'lead',
        entityId: leadId,
        leadId: leadId,
        notes: `Permanently purged lead '${leadName}' (${leadEmail || leadPhone || leadId}) from database.`,
        req
      });

      return NextResponse.json({
        success: true,
        message: `Lead '${leadName}' was permanently purged.`,
        data: { leadId, purged: true }
      });
    }

    // Default: Safe Soft Delete
    await LeadStore.softDelete(leadId, user._id || user.id, 'Soft deleted by manager');

    await logAuditEvent({
      userId: user._id || user.id,
      action: 'soft_delete_lead',
      entityType: 'lead',
      entityId: leadId,
      leadId: leadId,
      notes: `Soft deleted lead '${leadName}' (${leadEmail || leadPhone || leadId}).`,
      req
    });

    return NextResponse.json({
      success: true,
      message: `Lead '${leadName}' moved to Trash.`,
      data: {
        leadId,
        deleted: true,
        softDeleted: true
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred during lead deletion.' },
      { status: 500 }
    );
  }
}

