import { NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth/tokenManager.js';
import { logAuditEvent } from '@/lib/auditLogger.js';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization');
    let refreshToken = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      refreshToken = authHeader.split(' ')[1];
    } else {
      const body = await req.json().catch(() => ({}));
      refreshToken = body.refreshToken;
    }

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, message: 'Refresh token is required.' },
        { status: 400 }
      );
    }

    const result = await rotateRefreshToken(refreshToken);
    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.status || 401 }
      );
    }

    await logAuditEvent({
      userId: result.data.user._id,
      action: 'TOKEN_ROTATED',
      entityType: 'auth',
      notes: `Sliding session token refreshed for ${result.data.user.email}`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'Session token refreshed successfully.',
      data: result.data
    });
  } catch (err) {
    console.error('[Refresh Token API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error refreshing token.' },
      { status: 500 }
    );
  }
}
