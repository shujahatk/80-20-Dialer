import twilio from 'twilio';
import { validateTwilioWebhook } from './webhookValidator.js';

/**
 * Mask sensitive phone number for structured logging
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  if (phone.length <= 5) return '***';
  return phone.slice(0, 3) + '***' + phone.slice(-4);
}

/**
 * Validates and initializes the centralized Twilio REST Client
 */
export const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    const error = new Error('Twilio credentials are missing in system configuration. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your environment variables (.env).');
    error.statusCode = 400;
    throw error;
  }

  const client = twilio(accountSid, authToken);
  return { client, fromNumber, accountSid };
};

/**
 * Generates Twilio WebRTC Voice Access Token for browser softphone
 */
export const generateVoiceToken = ({ identity = 'admin', ttl = 3600 } = {}) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    const error = new Error('Twilio WebRTC credentials (TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID) are missing.');
    error.statusCode = 400;
    throw error;
  }

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl });
  
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true
  });

  token.addGrant(voiceGrant);

  return {
    token: token.toJwt(),
    identity,
    ttl
  };
};

/**
 * Initiates an outbound PSTN / Voice call
 */
export const makeOutboundCall = async (to, voiceUrl, statusUrl) => {
  const { client, fromNumber } = getTwilioClient();

  const payload = {
    to: to,
    from: fromNumber,
    record: true
  };

  const isPublicVoiceUrl = voiceUrl && (voiceUrl.startsWith('https://') || (!voiceUrl.includes('localhost') && !voiceUrl.includes('127.0.0.1')));

  if (isPublicVoiceUrl) {
    payload.url = voiceUrl;
  } else {
    // Generate inline TwiML direct payload so Twilio dials without needing an external webhook fetch
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('Connecting your outbound call.');
    const dial = response.dial({
      callerId: fromNumber,
      answerOnBridge: true,
      record: 'record-from-answer'
    });
    dial.number(to);
    payload.twiml = response.toString();
  }

  const isPublicStatusUrl = statusUrl && (statusUrl.startsWith('https://') || (!statusUrl.includes('localhost') && !statusUrl.includes('127.0.0.1')));
  if (isPublicStatusUrl) {
    payload.statusCallback = statusUrl;
    payload.statusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed'];
    payload.recordingStatusCallback = statusUrl;
    payload.recordingStatusCallbackEvent = ['completed', 'absent'];
  }

  console.log(`[Twilio Call Dispatch]: Outbound call to ${maskPhone(to)} from ${maskPhone(fromNumber)}`);
  const call = await client.calls.create(payload);

  return {
    callSid: call.sid,
    from: fromNumber,
    to: to,
    status: call.status || 'queued'
  };
};

/**
 * Immediately terminates / hangs up an active call via Twilio REST API
 */
export const terminateCall = async (callSid) => {
  if (!callSid) throw new Error('callSid is required to terminate call.');
  const { client } = getTwilioClient();
  console.log(`[Twilio Call Terminate]: Terminating call ${callSid}`);
  try {
    const call = await client.calls(callSid).update({ status: 'completed' });
    return {
      callSid: call.sid,
      status: call.status
    };
  } catch (err) {
    // If call is already ended/completed in Twilio, ignore error
    if (err.code === 21220 || err.status === 404 || err.message?.includes('not in-progress')) {
      return { callSid, status: 'completed' };
    }
    throw err;
  }
};

/**
 * Fetches status of an active or past call
 */
export const getCallStatus = async (callSid) => {
  if (!callSid) throw new Error('callSid is required to query call status.');
  const { client } = getTwilioClient();
  const call = await client.calls(callSid).fetch();
  return {
    callSid: call.sid,
    status: call.status,
    duration: call.duration ? parseInt(call.duration, 10) : 0,
    startTime: call.startTime,
    endTime: call.endTime,
    from: call.from,
    to: call.to
  };
};

/**
 * Sends an outbound SMS message
 */
export const sendSmsMessage = async (to, body, statusCallback) => {
  const { client, fromNumber } = getTwilioClient();

  const payload = {
    body: body,
    to: to,
    from: fromNumber
  };
  
  const isPublicStatus = statusCallback && (statusCallback.startsWith('https://') || (!statusCallback.includes('localhost') && !statusCallback.includes('127.0.0.1')));
  if (isPublicStatus) {
    payload.statusCallback = statusCallback;
  }

  console.log(`[Twilio SMS Dispatch]: SMS to ${maskPhone(to)} from ${maskPhone(fromNumber)}`);
  const message = await client.messages.create(payload);

  return {
    messageSid: message.sid,
    from: fromNumber,
    to: to,
    body: body,
    status: message.status || 'queued'
  };
};

// Alias for standard sendSMS naming
export const sendSMS = sendSmsMessage;

/**
 * Sends an outbound WhatsApp message
 */
export const sendWhatsAppMessage = async (to, body, statusCallback) => {
  const { client, fromNumber } = getTwilioClient();

  const payload = {
    body: body,
    to: `whatsapp:${to}`,
    from: `whatsapp:${fromNumber}`
  };
  
  const isPublicStatus = statusCallback && (statusCallback.startsWith('https://') || (!statusCallback.includes('localhost') && !statusCallback.includes('127.0.0.1')));
  if (isPublicStatus) {
    payload.statusCallback = statusCallback;
  }

  console.log(`[Twilio WhatsApp Dispatch]: WhatsApp to ${maskPhone(to)} from ${maskPhone(fromNumber)}`);
  const message = await client.messages.create(payload);

  return {
    messageSid: message.sid,
    from: fromNumber,
    to: to,
    body: body,
    status: message.status || 'queued'
  };
};

export { validateTwilioWebhook };
