import { verifyTwilioRequest, validateResendSignature } from './security/webhookSecurity.js';

export { validateTwilioSignature, verifyTwilioRequest, validateResendSignature } from './security/webhookSecurity.js';

/**
 * Validates incoming Twilio Webhook requests using X-Twilio-Signature.
 * @param {Request} req Next.js / Web Request object
 * @param {Object} params Request body parameters / Form data
 * @returns {boolean} True if signature is valid or if in local development mode without token
 */
export function validateTwilioWebhook(req, params = {}) {
  return verifyTwilioRequest(req, params);
}

/**
 * Validates incoming Resend Webhook signatures using Svix HMAC-SHA256 signature and timestamp tolerance.
 * @param {Request} req Next.js / Web Request object
 * @param {string|Object} rawBody Payload body string or object
 * @returns {boolean} True if valid signature
 */
export function validateResendWebhook(req, rawBody = '') {
  return validateResendSignature(rawBody, req.headers);
}
