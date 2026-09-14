import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { LeadStore, UserStore } from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';
export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;
    const { leadIds, targetUserId } = await req.json();
    if (!Array.isArray(leadIds) || !leadIds.length || !targetUserId) return NextResponse.json({ success: false, message: 'Recipient lead IDs and target user are required.' }, { status: 400 });
    const pool = ['pool', 'unassigned'].includes(targetUserId);
    const target = pool ? null : await UserStore.findById(targetUserId);
    if (!pool && (!target || !target.approved || !target.active)) return NextResponse.json({ success: false, message: 'Target user unavailable.' }, { status: 400 });
    let updatedCount = 0;
    for (const id of new Set(leadIds)) {
      if (!await LeadStore.findById(id)) continue;
      if (await LeadStore.update(id, { assigned_to: target?.id || null, status: pool ? 'new' : 'assigned',
        locked_by: null, locked_at: null, lock_heartbeat_at: null })) updatedCount++;
    }
    await logAuditEvent({ userId: user.id, action: 'LEADS_ASSIGNED', notes: 'Allocated ' + updatedCount + ' leads', req });
    return NextResponse.json({ success: true, message: 'Allocated ' + updatedCount + ' leads.',
      data: { updatedCount, targetUserId: target?.id || null, status: pool ? 'new' : 'assigned' } });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
