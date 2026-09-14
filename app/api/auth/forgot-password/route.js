import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { UserStore } from '@/lib/store.js';
import { logAuditEvent } from '@/lib/auditLogger.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email address is required.' },
        { status: 400 }
      );
    }

    const user = await UserStore.findOne({ email: email.toLowerCase().trim() });

    // Always respond with a generic success message to prevent user enumeration attacks
    if (!user) {
      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email address, a password reset link has been sent.'
      });
    }

    // Generate 15-minute secure crypto token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    await UserStore.update(user._id || user.id, {
      reset_password_token: rawToken,
      reset_password_expires_at: resetExpiresAt
    });

    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const resetUrl = `${protocol}://${host}/auth/reset-password?token=${rawToken}`;

    // Dispatch email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: '80/20 Security <outreach@8020acquisition.com>',
            to: [user.email],
            subject: 'Password Reset Request — 80/20 Outbound System',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0c0f17; color: #f1f5f9; border-radius: 12px;">
                <h2 style="color: #38bdf8;">Password Reset Request</h2>
                <p>Hello ${user.name || 'User'},</p>
                <p>We received a request to reset your password for the 80/20 Outbound System. Click the button below to establish a new password. This link is valid for <strong>15 minutes</strong>.</p>
                <div style="margin: 25px 0;">
                  <a href="${resetUrl}" style="background: #06b6d4; color: #020617; font-weight: bold; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">Reset Password</a>
                </div>
                <p style="font-size: 12px; color: #94a3b8;">If you did not request a password reset, you can safely ignore this email.</p>
              </div>
            `
          })
        });
      } catch (err) {
        console.warn('[Resend Password Reset Dispatch Notice]:', err.message);
      }
    } else {
      console.log(`[Dev Notice] Mock Password Reset Token generated for ${user.email}: ${resetUrl}`);
    }

    await logAuditEvent({
      userId: user._id || user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'auth',
      notes: `Password reset token generated for ${user.email}`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email address, a password reset link has been sent.',
      devResetUrl: process.env.NODE_ENV !== 'production' ? resetUrl : undefined
    });
  } catch (err) {
    console.error('[Forgot Password API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error generating password reset.' },
      { status: 500 }
    );
  }
}
