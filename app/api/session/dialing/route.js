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

    const body = await req.json();
    const { seconds } = body;
    
    if (seconds === undefined) {
      return NextResponse.json(
        { success: false, message: 'seconds parameter is required.' },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    let session = await LoginSessionStore.findToday(user._id);
    if (!session) {
      session = await LoginSessionStore.create({ userId: user._id, date: today });
    }

    const updated = await LoginSessionStore.updateSession(session._id, {
      dialingTimeSeconds: (session.dialingTimeSeconds || 0) + parseInt(seconds, 10)
    });

    return NextResponse.json({
      success: true,
      dialingTimeSeconds: updated.dialingTimeSeconds
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
