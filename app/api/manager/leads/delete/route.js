import { NextResponse } from 'next/server.js';
import { requireManager } from '../../../../../lib/middleware/authGuard.js';
import { LeadStore } from '../../../../../lib/store.js';
import { logAuditEvent } from '../../../../../lib/auditLogger.js';

// POST /api/manager/leads/delete - Bulk delete leads (Manager/Admin/Owner only)
export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const { leadIds, permanent = false } = body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'leadIds array is required for bulk deletion.' },
        { status: 400 }
      );
    }

    const validLeadIds = leadIds
      .map(id => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''))
      .filter(Boolean);

    if (validLeadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No valid lead IDs provided.' },
        { status: 400 }
      );
    }

    if (permanent) {
      const isOwnerOrAdmin = ['owner', 'admin'].includes(user.role);
      if (!isOwnerOrAdmin) {
        return NextResponse.json(
          { success: false, message: 'Forbidden. Permanent bulk lead purge requires Admin or Owner role.' },
          { status: 403 }
        );
      }

      const purgedCount = await LeadStore.purgeBulk(validLeadIds);

      await logAuditEvent({
        userId: user._id || user.id,
        action: 'bulk_purge_leads_permanent',
        entityType: 'lead',
        notes: `Bulk permanently purged ${purgedCount} leads. IDs: ${validLeadIds.slice(0, 10).join(', ')}${validLeadIds.length > 10 ? '...' : ''}`,
        req
      });

      return NextResponse.json({
        success: true,
        message: `Successfully permanently purged ${purgedCount} lead(s).`,
        data: {
          purgedCount,
          leadIds: validLeadIds,
          permanent: true
        }
      });
    }

    // Default: Soft Delete Bulk
    const deletedCount = await LeadStore.softDeleteBulk(validLeadIds, user._id || user.id, 'Bulk soft deleted by manager');

    await logAuditEvent({
      userId: user._id || user.id,
      action: 'bulk_soft_delete_leads',
      entityType: 'lead',
      notes: `Bulk soft-deleted ${deletedCount} leads to Trash. IDs: ${validLeadIds.slice(0, 10).join(', ')}${validLeadIds.length > 10 ? '...' : ''}`,
      req
    });

    return NextResponse.json({
      success: true,
      message: `Successfully moved ${deletedCount} lead(s) to Trash.`,
      data: {
        deletedCount,
        leadIds: validLeadIds,
        softDeleted: true
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred during bulk lead deletion.' },
      { status: 500 }
    );
  }
}

