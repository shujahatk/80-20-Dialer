import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import twilio from 'twilio';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Please login first.' },
        { status: 401 }
      );
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
      return NextResponse.json(
        {
          success: false,
          message: 'Twilio WebRTC configuration credentials (TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID) are not configured in your system environment.'
        },
        { status: 400 }
      );
    }

    const { AccessToken } = twilio.jwt;
    const { VoiceGrant } = AccessToken;

    const identity = user.email || user._id.toString();

    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity });
    
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true
    });

    token.addGrant(voiceGrant);

    return NextResponse.json({
      success: true,
      token: token.toJwt(),
      identity
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
