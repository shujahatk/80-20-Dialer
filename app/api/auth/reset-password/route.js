import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { UserStore } from '@/lib/store.js';
import { validatePasswordStrength } from '@/lib/auth/passwordValidator.js';
import { logAuditEvent } from '@/lib/auditLogger.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      return NextResponse.json(
        { success: false, message: 'Reset token and newPassword are required.' },
        { status: 400 }
      );
    }

    // Validate new password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, message: validation.error },
        { status: 400 }
      );
    }

    // Find user by reset token
    const user = await UserStore.findByResetToken(token);

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired password reset token.' },
        { status: 400 }
      );
    }

    // Check expiration (15-minute window)
    const now = Date.now();
    const expiresAt = new Date(user.reset_password_expires_at || 0).getTime();
    if (!user.reset_password_expires_at || !Number.isFinite(expiresAt) || now >= expiresAt) {
      return NextResponse.json(
        { success: false, message: 'Password reset token has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // Hash new password and clear token
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await UserStore.update(user._id || user.id, {
      password: hashedPassword,
      tokenVersion: (user.tokenVersion || 1) + 1,
      reset_password_token: null,
      reset_password_expires_at: null,
      password_changed_at: new Date().toISOString()
    });

    await logAuditEvent({
      userId: user._id || user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'auth',
      notes: `User ${user.email} successfully reset their password via email token.`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. You can now sign in with your new credentials.'
    });
  } catch (err) {
    console.error('[Reset Password API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error resetting password.' },
      { status: 500 }
    );
  }
}
