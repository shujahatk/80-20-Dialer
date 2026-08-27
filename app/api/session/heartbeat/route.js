import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LoginSessionStore, UserStore } from '@/lib/store';

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    let session = await LoginSessionStore.findToday(user._id);
    if (!session) {
      session = await LoginSessionStore.create({ userId: user._id, date: today });
    }

    const now = new Date();
    const lastActivity = new Date(session.lastActivityAt || session.loginAt);
    
    // Cap elapsed addition to prevent huge jumps if browser was tab-throttled or sleeping
    let elapsed = Math.floor((now - lastActivity) / 1000);
    if (elapsed < 0) elapsed = 0;
    if (elapsed > 60) elapsed = 10; 

    const activeAddition = session.isOnBreak ? 0 : elapsed;

    const updated = await LoginSessionStore.updateSession(session._id, {
      lastActivityAt: now,
      activeTimeSeconds: (session.activeTimeSeconds || 0) + activeAddition
    });

    await UserStore.updateLastActive(user._id);

    return NextResponse.json({
      success: true,
      isOnBreak: !!updated.isOnBreak,
      activeTimeSeconds: updated.activeTimeSeconds
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
