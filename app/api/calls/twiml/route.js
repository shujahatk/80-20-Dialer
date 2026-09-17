import twilio from 'twilio';
import { validateTwilioWebhook } from '@/lib/webhookValidator.js';
import { validatePhoneNumber } from '@/lib/phoneValidator.js';
import { SuppressionStore } from '@/lib/suppression/suppressionStore.js';
import { checkOperationalHours } from '@/lib/operationalHours.js';
import { LeadStore } from '@/lib/store.js';

export async function POST(req) {
  try {
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();

    const searchParams = req.nextUrl?.searchParams || new URL(req.url, 'http://localhost').searchParams;
    let to = searchParams.get('to') || searchParams.get('To') || searchParams.get('destination');
    let leadId = searchParams.get('leadId') || searchParams.get('lead_id');
    let parsedParams = {};

    // Parse incoming formData / URL encoded body from Twilio if present
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      for (const [k, v] of formData.entries()) {
        parsedParams[k] = v;
      }
      if (!to) to = parsedParams.To || parsedParams.to || parsedParams.destination;
      if (!leadId) leadId = parsedParams.leadId || parsedParams.lead_id;
    }

    if (to) parsedParams.To = to;
    if (leadId) parsedParams.leadId = leadId;

    const hasValidSignature = validateTwilioWebhook(req, parsedParams);
    const isOurAccount = parsedParams.AccountSid && parsedParams.AccountSid === process.env.TWILIO_ACCOUNT_SID;

    if (!hasValidSignature && !isOurAccount) {
      console.warn('[TwiML Security Warning]: Invalid Twilio Signature.');
      return new Response('Unauthorized Webhook Request', { status: 401 });
    }

    const callerId = process.env.TWILIO_PHONE_NUMBER;
    const hostUrl = process.env.PUBLIC_URL || `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`;
    const statusCallbackUrl = `${hostUrl.replace(/\/$/, '')}/api/calls/status`;

    // Case 1: Outbound call to a PSTN phone number (from browser softphone or REST API)
    if (to && to !== callerId && !to.startsWith('client:')) {
      const phoneCheck = validatePhoneNumber(to);
      if (!phoneCheck.isValid) {
        response.say('Invalid destination phone number provided. Ending call.');
        response.hangup();
        return new Response(response.toString(), {
          headers: { 'Content-Type': 'text/xml' }
        });
      }

      const formattedTo = phoneCheck.formattedPhone;

      // 1. Server-side DNC check
      const dncCheck = await SuppressionStore.isSuppressed({ phone: formattedTo, channel: 'call' });
      if (dncCheck.suppressed) {
        console.warn(`[TwiML DNC Blocked]: Attempted call to suppressed number ${formattedTo}`);
        response.say('The requested destination number is on the Do Not Call suppression list. Call terminated.');
        response.hangup();
        return new Response(response.toString(), {
          headers: { 'Content-Type': 'text/xml' }
        });
      }

      // 2. Operational Hours check if lead timezone available
      let leadTimezone = null;
      if (leadId) {
        const lead = await LeadStore.findById(leadId);
        if (lead?.geography?.timezone) {
          leadTimezone = lead.geography.timezone;
        }
      }
      const hoursCheck = await checkOperationalHours(leadTimezone);
      if (!hoursCheck.allowed) {
        console.warn(`[TwiML Hours Blocked]: Call outside allowed calling hours for ${formattedTo}`);
        response.say('Calling is currently unavailable outside allowed operational calling hours.');
        response.hangup();
        return new Response(response.toString(), {
          headers: { 'Content-Type': 'text/xml' }
        });
      }

      response.say('Connecting your outbound call.');
      const dial = response.dial({
        callerId,
        answerOnBridge: true,
        record: 'record-from-answer',
        recordingStatusCallback: statusCallbackUrl,
        recordingStatusCallbackEvent: ['completed'],
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
      });
      dial.number({
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: 'POST'
      }, formattedTo);
    } else {
      // Case 2: Inbound call to Twilio number -> Route to connected browser workstation client (admin)
      response.say('Thank you for calling. Connecting you to an available representative.');
      const dial = response.dial({
        timeout: 30,
        answerOnBridge: true,
        record: 'record-from-answer',
        recordingStatusCallback: statusCallbackUrl,
        recordingStatusCallbackEvent: ['completed']
      });
      dial.client('admin');
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
