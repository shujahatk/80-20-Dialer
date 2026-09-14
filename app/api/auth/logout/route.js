import { NextResponse } from 'next/server';
import { extractCookie } from '@/lib/auth';
import { revokeRefreshToken } from '@/lib/auth/tokenManager';
import { setAuthCookies } from '@/lib/auth/cookies';
export async function POST(req) {
  try {
    await revokeRefreshToken(extractCookie(req, 'refreshToken'));
    return setAuthCookies(NextResponse.json({ success: true, message: 'Logged out successfully.' }), null);
  } catch {
    return NextResponse.json({ success: false, message: 'Logout unavailable. Try again shortly.' }, { status: 503 });
  }
}
