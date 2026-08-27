import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { UserStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const onlineUsers = await UserStore.findOnlineUsers();
    return NextResponse.json({
      success: true,
      count: onlineUsers.length,
      data: onlineUsers
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
