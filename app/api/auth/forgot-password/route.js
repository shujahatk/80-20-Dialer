import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { UserStore } from '@/lib/store';
import { sendEmail } from '@/lib/emailService';
import { logAuditEvent } from '@/lib/auditLogger';
import { parseAndSanitizeJson } from '@/lib/security/inputSanitizer';
import { checkAuthRateLimit, recordFailedAuth, clearAuthRateLimit } from '@/lib/middleware/rateLimiter';

export async function POST(req) {
  try {
    const parsed = await parseAndSanitizeJson(req, {
      requiredFields: ['email']
    });
    if (!parsed.success) return parsed.errorResponse;

    const { email } = parsed.data;
    const emailKey = email.toLowerCase().trim();

    // 5 attempts per 15 minutes limit
    const rate = checkAuthRateLimit(req, emailKey, 'forgot_pw', 5);
    if (!rate.allowed) return rate.errorResponse;

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ success: false, message: 'Password reset email service is currently unconfigured.' }, { status: 503 });
    }

    recordFailedAuth(req, emailKey, 'forgot_pw');
    const user = await UserStore.findOne({ email: emailKey });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const base = process.env.APP_URL || process.env.PUBLIC_URL;
      if (!base) throw new Error('APP_URL or PUBLIC_URL is required for password reset links.');
      
      const resetUrl = new URL('/auth/reset-password', base);
      resetUrl.searchParams.set('token', token);

      await UserStore.update(user.id || user._id, {
        reset_password_token: token,
        reset_password_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      });

      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        text: 'Reset your password using this link within 15 minutes: ' + resetUrl.href
      });

      await logAuditEvent({ userId: user.id || user._id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'auth', req });
    }

    return NextResponse.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
  } catch (err) {
    return NextResponse.json({ success: false, message: 'Password reset is unavailable. Try again shortly.' }, { status: 503 });
  }
}
