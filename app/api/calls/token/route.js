import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard';
import { checkRateLimit } from '@/lib/rateLimiter';
import { generateVoiceToken } from '@/lib/twilioService';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const rateCheck = checkRateLimit(`twilio_token_${user._id}`, 15, 60000);
    if (!rateCheck.success) return rateCheck.errorResponse;

    const identity = user.email || user._id.toString();

    try {
      const tokenData = generateVoiceToken({ identity, ttl: 3600 });
      return NextResponse.json({
        success: true,
        token: tokenData.token,
        identity: tokenData.identity,
        ttl: tokenData.ttl
      });
    } catch (configErr) {
      return NextResponse.json(
        {
          success: false,
          message: configErr.message || 'Twilio WebRTC configuration credentials are not configured.'
        },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
