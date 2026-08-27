import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LoginSessionStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') || user._id;

    const stats = await LoginSessionStore.getUserStats(userId);
    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
