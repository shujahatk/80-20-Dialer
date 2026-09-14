import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/middleware/authGuard.js';
import { UserStore } from '@/lib/store.js';
import { validatePasswordStrength } from '@/lib/auth/passwordValidator.js';
import { logAuditEvent } from '@/lib/auditLogger.js';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, message: 'Both currentPassword and newPassword are required.' },
        { status: 400 }
      );
    }

    // Retrieve fresh user record with stored password hash using multi-key lookup
    let fullUser = await UserStore.findByIdWithPassword(user._id || user.id);
    
    if (!fullUser || !fullUser.password) {
      if (user.email) {
        fullUser = await UserStore.findOne({ email: user.email });
      }
    }

    if (!fullUser || !fullUser.password) {
      const allUsers = await UserStore.findAllUsers();
      const match = allUsers.find(u => 
        (u._id && (u._id === user._id || u._id === user.id)) ||
        (u.id && (u.id === user._id || u.id === user.id)) ||
        (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase())
      );
      if (match) {
        fullUser = await UserStore.findByIdWithPassword(match._id || match.id) || await UserStore.findOne({ email: match.email });
      }
    }

    if (!fullUser || !fullUser.password) {
      return NextResponse.json(
        { success: false, message: 'User record not found.' },
        { status: 404 }
      );
    }

    // Verify current password matches stored hash
    const isMatch = await bcrypt.compare(currentPassword, fullUser.password);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, message: 'Current password does not match.' },
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

    // Prevent reusing the exact same password
    const isSameAsCurrent = await bcrypt.compare(newPassword, fullUser.password);
    if (isSameAsCurrent) {
      return NextResponse.json(
        { success: false, message: 'New password must be different from current password.' },
        { status: 400 }
      );
    }

    // Hash new password and update
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    const targetUserId = fullUser._id || fullUser.id || user._id || user.id;

    await UserStore.update(targetUserId, {
      password: hashedPassword,
      tokenVersion: (fullUser.tokenVersion || 1) + 1,
      password_changed_at: new Date().toISOString()
    });

    await logAuditEvent({
      userId: targetUserId,
      action: 'PASSWORD_CHANGED',
      entityType: 'auth',
      notes: `User ${fullUser.email || user.email} changed their password successfully.`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (err) {
    console.error('[Change Password API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error changing password.' },
      { status: 500 }
    );
  }
}
