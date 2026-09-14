import crypto from 'crypto';

/**
 * Enterprise Webhook Signature Verification & Audit Protection Engine
 * Hardens Twilio and Resend webhooks against replay attacks, payload tampering, and spoofing.
 */

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

/**
 * Validates Twilio HMAC-SHA1 Webhook Signature.
 * Sorts parameters alphabetically, concatenates with target URL, and computes HMAC-SHA1.
 */
export function validateTwilioSignature(signature, url, params = {}, authToken = TWILIO_AUTH_TOKEN) {
  if (!authToken) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ [Twilio Security Alert]: TWILIO_AUTH_TOKEN missing in production. Failing closed.');
      return false;
    }
    return true; // Dev fallback only
  }

  if (!signature || typeof signature !== 'string') {
    return false;
  }

  try {
    // Sort keys alphabetically and concatenate key + value to the URL
    let data = url;
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      data += `${key}${params[key]}`;
    }

    const expectedSignature = crypto
      .createHmac('sha1', authToken)
      .update(data, 'utf8')
      .digest('base64');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    console.error('[Twilio Signature Calculation Error]:', err.message);
    return false;
  }
}

/**
 * Helper to extract and verify Twilio incoming Next.js Request
 */
export function verifyTwilioRequest(req, params = {}) {
  const signature = typeof req.headers?.get === 'function' 
    ? req.headers.get('x-twilio-signature') 
    : (req.headers?.['x-twilio-signature'] || null);

  const host = (typeof req.headers?.get === 'function'
    ? (req.headers.get('x-forwarded-host') || req.headers.get('host'))
    : (req.headers?.['x-forwarded-host'] || req.headers?.host)) || 'localhost:3000';

  const proto = (typeof req.headers?.get === 'function'
    ? req.headers.get('x-forwarded-proto')
    : req.headers?.['x-forwarded-proto']) || (host.includes('localhost') ? 'http' : 'https');

  let pathname = '/';
  let search = '';
  try {
    const rawUrl = req.url || '/';
    const urlObj = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(rawUrl, `${proto}://${host}`);
    pathname = urlObj.pathname;
    search = urlObj.search || '';
  } catch (e) {
    // fallback
  }

  const publicBase = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : `${proto}://${host}`;
  const targetUrlWithQuery = `${publicBase}${pathname}${search}`;
  const targetUrlClean = `${publicBase}${pathname}`;
  const directUrlWithQuery = `${proto}://${host}${pathname}${search}`;

  // Try matching against public URL with query, clean public URL, or forwarded proxy URL
  if (validateTwilioSignature(signature, targetUrlWithQuery, params)) return true;
  if (validateTwilioSignature(signature, targetUrlClean, params)) return true;
  if (validateTwilioSignature(signature, directUrlWithQuery, params)) return true;

  return false;
}

/**
 * Validates Resend / Svix HMAC-SHA256 Webhook Signature.
 * Verifies timestamp tolerance (5 minutes) and compares HMAC-SHA256 with timingSafeEqual.
 */
export function validateResendSignature(rawBody, headers, secret = RESEND_WEBHOOK_SECRET) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ [Resend Security Alert]: RESEND_WEBHOOK_SECRET missing in production. Failing closed.');
      return false;
    }
    return true; // Dev fallback only
  }

  // Svix / Resend signature headers
  const svixId = typeof headers.get === 'function' ? headers.get('svix-id') : headers['svix-id'];
  const svixTimestamp = typeof headers.get === 'function' ? headers.get('svix-timestamp') : headers['svix-timestamp'];
  const svixSignature = typeof headers.get === 'function' ? (headers.get('svix-signature') || headers.get('x-resend-signature')) : (headers['svix-signature'] || headers['x-resend-signature']);

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Check timestamp tolerance (5 minutes = 300 seconds) to prevent replay attacks
  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestampSeconds = parseInt(svixTimestamp, 10);
  if (isNaN(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) {
    console.warn(`[Resend Webhook Rejected]: Timestamp skew too high (now: ${nowSeconds}, req: ${timestampSeconds})`);
    return false;
  }

  try {
    // Secret handling (strip 'whsec_' if present)
    const secretKey = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : secret;

    const payloadToSign = `${svixId}.${svixTimestamp}.${typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)}`;
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(payloadToSign, 'utf8')
      .digest('base64');

    // svix-signature may contain multiple signatures separated by space (e.g. 'v1,sig1 v1,sig2')
    const signatures = svixSignature.split(' ');
    for (const versionedSig of signatures) {
      const parts = versionedSig.split(',');
      const sigValue = parts.length > 1 ? parts[1] : parts[0];
      
      const expectedBuffer = Buffer.from(computedHash, 'utf8');
      const sigBuffer = Buffer.from(sigValue, 'utf8');

      if (expectedBuffer.length === sigBuffer.length && crypto.timingSafeEqual(expectedBuffer, sigBuffer)) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[Resend Signature Calculation Error]:', err.message);
    return false;
  }
}

const LISTMONK_WEBHOOK_SECRET = process.env.LISTMONK_WEBHOOK_SECRET;

/**
 * Validates Listmonk Webhook Authenticity.
 * Supports HMAC-SHA256 signature (x-listmonk-signature) or secret token header (x-listmonk-secret / x-webhook-secret / Authorization Bearer).
 */
export function validateListmonkSignature(rawBody, headers, secret = LISTMONK_WEBHOOK_SECRET) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ [Listmonk Security Alert]: LISTMONK_WEBHOOK_SECRET missing in production. Failing closed.');
      return false;
    }
    return true; // Dev fallback only
  }

  const tokenHeader = typeof headers.get === 'function'
    ? (headers.get('x-listmonk-secret') || headers.get('x-webhook-secret') || headers.get('authorization'))
    : (headers['x-listmonk-secret'] || headers['x-webhook-secret'] || headers['authorization']);

  if (tokenHeader) {
    const token = tokenHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === secret) {
      return true;
    }
  }

  const signature = typeof headers.get === 'function'
    ? headers.get('x-listmonk-signature')
    : headers['x-listmonk-signature'];

  if (signature) {
    try {
      const computedHash = crypto
        .createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody), 'utf8')
        .digest('hex');

      const expectedBuffer = Buffer.from(computedHash, 'utf8');
      const sigBuffer = Buffer.from(signature, 'utf8');

      if (expectedBuffer.length === sigBuffer.length && crypto.timingSafeEqual(expectedBuffer, sigBuffer)) {
        return true;
      }
    } catch (err) {
      console.error('[Listmonk Signature Calculation Error]:', err.message);
      return false;
    }
  }

  return false;
}

