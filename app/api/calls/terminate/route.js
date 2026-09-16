import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard';
import { terminateCall } from '@/lib/twilioService';
import { CallStore, ActivityLogStore } from '@/lib/store';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { callSid, leadId } = body;

    if (!callSid) {
      return NextResponse.json(
        { success: false, message: 'callSid is required to terminate call.' },
        { status: 400 }
      );
    }

    // 1. Immediately send REST hangup to Twilio Gateway
    let result = { callSid, status: 'completed' };
    try {
      result = await terminateCall(callSid);
    } catch (twilioErr) {
      console.warn('[Twilio REST Hangup Warning]:', twilioErr.message);
    }

    // 2. Update local call record
    try {
      await CallStore.findOneAndUpdate(
        { callSid },
        { status: 'completed', endTime: new Date().toISOString() }
      );
    } catch (dbErr) {
      console.warn('[CallStore update notice]:', dbErr.message);
    }

    // 3. Broadcast call.completed event across Realtime Bus
    try {
      await broadcastRealtimeEvent('call.completed', {
        callSid,
        leadId: leadId || null,
        userId: user._id || user.id,
        userName: user.name || user.email || 'Sales Rep',
        status: 'completed',
        endedAt: new Date().toISOString()
      });
    } catch (rtErr) {}

    return NextResponse.json({
      success: true,
      message: 'Call terminated successfully.',
      data: result
    });
  } catch (err) {
    console.error('[Call Terminate API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to terminate call.' },
      { status: 500 }
    );
  }
}
