import { NextResponse } from 'next/server';
import { requireAuth, normalizeRole, ROLES } from '@/lib/middleware/authGuard';
import { ActivityLogStore, LeadStore } from '@/lib/store';

export async function GET(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const userRole = normalizeRole(user.role);
    if (userRole === ROLES.UPDATER_ONLY) {
      return NextResponse.json(
        { success: false, message: 'Access denied: updater_only cannot view activity timeline or sensitive prospect details.' },
        { status: 403 }
      );
    }

    const { id: leadId } = await params;
    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    const { assertLeadAccess } = await import('@/lib/middleware/authGuard.js');
    if (!assertLeadAccess(user, lead)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to view this lead timeline.' },
        { status: 403 }
      );
    }

    const activityLogs = await ActivityLogStore.findByLead(leadId);
    
    // Sort chronologically descending (newest first)
    const sorted = (activityLogs || []).sort((a, b) => new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0));

    return NextResponse.json({
      success: true,
      data: sorted
    });
  } catch (err) {
    console.error('[Lead Timeline API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error fetching lead timeline.' },
      { status: 500 }
    );
  }
}
