import twilio from 'twilio';

export async function POST(req) {
  try {
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();

    const searchParams = req.nextUrl.searchParams;
    let to = searchParams.get('to');

    // Parse incoming formData from Twilio callback if present
    if (!to) {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        to = formData.get('To');
      }
    }

    const callerId = process.env.TWILIO_PHONE_NUMBER;

    response.say('Connecting your outbound call. Please stand by.');

    if (to) {
      const dial = response.dial({ callerId });
      dial.number(to);
    } else {
      response.say('No destination phone number provided. Ending call.');
    }

    return new Response(response.toString(), {
      headers: {
        'Content-Type': 'text/xml'
      }
    });
  } catch (err) {
    console.error('[TwiML Webhook] Error:', err.message);
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();
    response.say('An error occurred while placing your call.');
    return new Response(response.toString(), {
      status: 500,
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}

export async function GET(req) {
  return POST(req);
}
