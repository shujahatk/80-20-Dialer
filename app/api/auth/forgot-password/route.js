import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { UserStore } from '@/lib/store';
import { sendEmail } from '@/lib/emailService';
import { logAuditEvent } from '@/lib/auditLogger';
export async function POST(req) {
  try {
    const { email } = await req.json();
    if (typeof email !== 'string' || !email.trim()) return NextResponse.json({ success: false, message: 'Email is required.' }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ success: false, message: 'Password reset email is unavailable.' }, { status: 503 });
    const user = await UserStore.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const base = process.env.APP_URL || process.env.PUBLIC_URL;
      if (!base) throw new Error('APP_URL or PUBLIC_URL is required for password reset links.');
      const resetUrl = new URL('/auth/reset-password', base);
      resetUrl.searchParams.set('token', token);
      await UserStore.update(user.id, { reset_password_token: token, reset_password_expires_at: new Date(Date.now() + 900000).toISOString() });
      await sendEmail({ to: user.email, subject: 'Password Reset Request',
        text: 'Reset your password using this link within 15 minutes: ' + resetUrl.href });
      await logAuditEvent({ userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'auth', req });
    }
    return NextResponse.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
  } catch {
    return NextResponse.json({ success: false, message: 'Password reset is unavailable. Try again shortly.' }, { status: 503 });
  }
}
