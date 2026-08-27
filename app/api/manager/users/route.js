import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { UserStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Manager privileges required.' },
        { status: 401 }
      );
    }

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

export async function PUT(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { userId, action, role } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required.' },
        { status: 400 }
      );
    }

    let updated;
    if (action === 'approve') {
      updated = await UserStore.approveUser(userId);
    } else if (action === 'role' && role) {
      updated = await UserStore.updateRole(userId, role);
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
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required.' },
        { status: 400 }
      );
    }

    const deleted = await UserStore.rejectUser(userId);
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
