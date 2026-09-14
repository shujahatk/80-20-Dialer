import { NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth/tokenManager';
import { extractCookie } from '@/lib/auth';
import { setAuthCookies } from '@/lib/auth/cookies';
export async function POST(req) {
  try {
    const origin = req.headers.get('origin');
    const expectedOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(req.url).origin;
    if (origin && origin !== expectedOrigin) return NextResponse.json({ success: false, message: 'Invalid request origin.' }, { status: 403 });
    const header = req.headers.get('authorization');
    const body = await req.json().catch(() => ({}));
    const token = header?.startsWith('Bearer ') ? header.slice(7) : extractCookie(req, 'refreshToken') || body.refreshToken;
    if (!token) return setAuthCookies(NextResponse.json({ success: false, message: 'Refresh token required.' }, { status: 401 }), null);
    const result = await rotateRefreshToken(token);
    if (!result.success) return setAuthCookies(NextResponse.json({ success: false, message: result.message }, { status: result.status || 401 }), null);
    return setAuthCookies(NextResponse.json({ success: true, data: result.data }), result.data);
  } catch (error) {
    console.error('[Session refresh]', error.message);
    return NextResponse.json({ success: false, message: 'Session refresh unavailable. Try again shortly.' }, { status: 503 });
  }
}
