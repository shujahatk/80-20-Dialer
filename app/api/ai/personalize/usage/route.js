import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard';
import { AiUsageStore } from '@/lib/store';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const isManager = ['admin', 'owner', 'manager'].includes(user.role);
    // Non-managers only see their own usage stats; managers/admins see organization stats
    const filterUserId = isManager ? null : (user._id || user.id);

    const stats = await AiUsageStore.getStats(filterUserId);

    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('[AI Usage Route Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error loading usage stats.' },
      { status: 500 }
    );
  }
}
