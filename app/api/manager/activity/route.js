import { NextResponse } from 'next/server';
import { requireAuth, isManagerOrAdmin } from '@/lib/middleware/authGuard';
import { ActivityLogStore, UserStore } from '@/lib/store';
export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;
    const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 50));
    let logs;
    if (!isManagerOrAdmin(user)) logs = await ActivityLogStore.findByUser(user.id, limit);
    else {
      const users = await UserStore.findAllUsers();
      logs = (await Promise.all(users.map(async owner => (await ActivityLogStore.findByUser(owner.id, limit))
        .map(log => ({ ...log, userId: { _id: owner.id, name: owner.name } }))))).flat()
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
    }
    return NextResponse.json({ success: true, count: logs.length, data: logs });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
