import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { UserStore } from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const users = await UserStore.findAllUsers();
    return NextResponse.json({
      success: true,
      data: users
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { name, email, password, role = 'salesperson' } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, message: 'Name, email, and password are required.' },
        { status: 400 }
      );
    }

    // 3-Tier Role Hierarchy Safeguards
    if (!['owner', 'manager', 'salesperson'].includes(role)) {
      return NextResponse.json(
        { success: false, message: 'Invalid role. Allowed roles: owner, manager, salesperson.' },
        { status: 400 }
      );
    }

    if (user.role === 'manager' && ['owner', 'manager'].includes(role)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Managers can only create salesperson accounts.' },
        { status: 403 }
      );
    }

    const existing = await UserStore.findOne({ email: email.toLowerCase() });
    if (existing) {
      return NextResponse.json(
        { success: false, message: 'User with this email already exists.' },
        { status: 400 }
      );
    }

    const newUser = await UserStore.create({
      name,
      email: email.toLowerCase(),
      password,
      role,
      approved: true
    });

    await logAuditEvent({
      userId: user._id,
      action: 'note',
      notes: `Created new user account '${newUser.email}' with role '${role}'.`,
      req
    });

    return NextResponse.json({
      success: true,
      message: 'User created successfully.',
      data: newUser
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function PUT(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { userId, action, role } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required.' },
        { status: 400 }
      );
    }

    // Prevent user from modifying their own role or status
    if (userId.toString() === user._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You cannot modify your own role or authorization status.' },
        { status: 403 }
      );
    }

    const targetUser = await UserStore.findById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: 'Target user account not found.' },
        { status: 404 }
      );
    }

    // Protect Owner accounts from modification by Managers
    if (targetUser.role === 'owner' && user.role !== 'owner') {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Owner accounts can only be modified by the Owner.' },
        { status: 403 }
      );
    }

    let updated;
    if (action === 'approve') {
      updated = await UserStore.approveUser(userId);
      await logAuditEvent({
        userId: user._id,
        action: 'note',
        notes: `Approved user account '${targetUser.email}'.`,
        req
      });
    } else if (action === 'role' && role) {
      if (!['owner', 'manager', 'salesperson'].includes(role)) {
        return NextResponse.json(
          { success: false, message: 'Invalid role target.' },
          { status: 400 }
        );
      }

      // Role Hierarchy Validation for Role Promotion
      if (user.role !== 'owner') {
        return NextResponse.json(
          { success: false, message: 'Forbidden. Only System Owner can alter user roles.' },
          { status: 403 }
        );
      }

      updated = await UserStore.updateRole(userId, role);
      await logAuditEvent({
        userId: user._id,
        action: 'note',
        notes: `Changed user '${targetUser.email}' role from '${targetUser.role}' to '${role}'.`,
        req
      });
    } else if (action === 'reset_password' || action === 'password') {
      const { newPassword } = body;
      if (!newPassword || newPassword.length < 6) {
        return NextResponse.json(
          { success: false, message: 'New password must be at least 6 characters.' },
          { status: 400 }
        );
      }
      const bcrypt = (await import('bcryptjs')).default;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      updated = await UserStore.update(userId, {
        password: hashedPassword,
        password_changed_at: new Date().toISOString()
      });
      await logAuditEvent({
        userId: user._id,
        action: 'PASSWORD_RESET',
        notes: `Manager/Admin reset password for user '${targetUser.email}'.`,
        req
      });
    } else {
      return NextResponse.json(
        { success: false, message: 'Invalid action request.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'User modified successfully.',
      data: updated
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required.' },
        { status: 400 }
      );
    }

    if (userId.toString() === user._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You cannot delete your own account.' },
        { status: 403 }
      );
    }

    const targetUser = await UserStore.findById(userId);
    if (targetUser && targetUser.role === 'owner' && user.role !== 'owner') {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Owner accounts cannot be deleted by non-owners.' },
        { status: 403 }
      );
    }

    const deleted = await UserStore.rejectUser(userId);

    await logAuditEvent({
      userId: user._id,
      action: 'note',
      notes: `Rejected and deleted user account (ID: ${userId}).`,
      req
    });

    return NextResponse.json({
      success: true,
      message: deleted ? 'User rejected and removed.' : 'User not found.'
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
