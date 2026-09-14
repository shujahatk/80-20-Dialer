import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { assertStatsAccess } from '@/lib/middleware/authGuard';
import { LoginSessionStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('userId');

    // IDOR check: Salespeople cannot query stats of other users
    if (requestedUserId && !assertStatsAccess(user, requestedUserId)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden: You can only access your own session statistics.' } },
        { status: 403 }
      );
    }

    const userId = requestedUserId || user._id || user.id;

    const stats = await LoginSessionStore.getUserStats(userId);
    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
