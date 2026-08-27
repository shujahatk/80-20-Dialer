import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LoginSessionStore } from '@/lib/store';

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const session = await LoginSessionStore.toggleBreak(user._id);

    return NextResponse.json({
      success: true,
      message: session.isOnBreak ? 'Break started.' : 'Break ended.',
      data: {
        isOnBreak: session.isOnBreak,
        breakTimeSeconds: session.breakTimeSeconds
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
