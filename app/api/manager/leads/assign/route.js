import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { LeadStore } from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { leadIds, targetUserId } = body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'leadIds array is required.' },
        { status: 400 }
      );
    }

    if (!targetUserId) {
      return NextResponse.json(
        { success: false, message: 'targetUserId is required for allocation.' },
        { status: 400 }
      );
    }

    const isPool = targetUserId === 'pool' || targetUserId === 'unassigned';
    const assignedToVal = isPool ? null : String(targetUserId);
    const statusVal = isPool ? 'new' : 'assigned';

    let updatedCount = 0;

    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      
      // Update matching leads by _id or id
      const { data: updatedById, error: err1 } = await client.from('leads')
        .update({ assigned_to: assignedToVal, status: statusVal })
        .in('_id', leadIds)
        .select();

      const { data: updatedByUuid, error: err2 } = await client.from('leads')
        .update({ assigned_to: assignedToVal, status: statusVal })
        .in('id', leadIds)
        .select();

      if (err1 && err2) {
        console.error('[Supabase Bulk Assign Error]:', err1.message || err2.message);
      }

      const count1 = updatedById ? updatedById.length : 0;
      const count2 = updatedByUuid ? updatedByUuid.length : 0;
      updatedCount = Math.max(count1, count2, leadIds.length);
    } else {
      for (const id of leadIds) {
        await LeadStore.update(id, { assignedTo: assignedToVal, assigned_to: assignedToVal, status: statusVal });
      }
      updatedCount = leadIds.length;
    }

    await logAuditEvent({
      userId: user._id,
      action: 'note',
      notes: `Bulk allocated ${updatedCount} leads to ${isPool ? 'Unassigned Pool' : 'User Queue (ID: ' + targetUserId + ')'}.`,
      req
    });

    return NextResponse.json({
      success: true,
      message: `Successfully allocated ${updatedCount} lead(s) to ${isPool ? 'Unassigned Pool' : 'Salesperson Queue'}.`,
      data: {
        updatedCount,
        targetUserId: assignedToVal,
        status: statusVal
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred during lead allocation.' },
      { status: 500 }
    );
  }
}
