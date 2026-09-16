import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { validateTwilioSignature, verifyTwilioRequest, validateResendSignature } from '../lib/security/webhookSecurity.js';
import { validatePhoneNumber } from '../lib/phoneValidator.js';
import { validateTwilioConfig } from '../lib/envConfig.js';
import { generateVoiceToken } from '../lib/twilioService.js';
import { mapCsvHeaders } from '../lib/csv/normalizeHeader.js';
import { parseCsvBuffer } from '../lib/csv/parseCsv.js';

test('Twilio environment config validation catches invalid prefixes and formats', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_MOCK_ACCOUNT_SID_0000000000000';
  process.env.TWILIO_API_KEY = 'SK_TEST_MOCK_API_KEY_0000000000000000';
  process.env.TWILIO_TWIML_APP_SID = 'AP_TEST_MOCK_APP_SID_000000000000000';
  process.env.TWILIO_PHONE_NUMBER = '+15551234567';
  process.env.PUBLIC_URL = 'https://80-20-dialer.vercel.app';

  const errors = validateTwilioConfig(false);
  assert.equal(errors.length, 0, 'No errors for valid Twilio credentials');

  process.env.TWILIO_ACCOUNT_SID = 'XX_INVALID';
  assert.equal(validateTwilioConfig(false).some(e => e.includes('AC')), true);

  process.env.TWILIO_PHONE_NUMBER = 'invalid_phone';
  assert.equal(validateTwilioConfig(false).some(e => e.includes('E.164')), true);

  process.env = origEnv;
});

test('Twilio Voice WebRTC Access Token generates valid JWT with VoiceGrant', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_MOCK_ACCOUNT_SID_0000000000000';
  process.env.TWILIO_API_KEY = 'SK_TEST_MOCK_API_KEY_0000000000000000';
  process.env.TWILIO_API_SECRET = 'mock_secret_abcdef1234567890mock';
  process.env.TWILIO_TWIML_APP_SID = 'AP_TEST_MOCK_APP_SID_000000000000000';

  const tokenData = generateVoiceToken({ identity: 'sales_rep_1', ttl: 3600 });
  assert.equal(tokenData.identity, 'sales_rep_1');
  assert.equal(typeof tokenData.token, 'string');
  assert.equal(tokenData.token.split('.').length, 3); // Valid JWT structure

  process.env = origEnv;
});

test('Twilio HMAC-SHA1 signature verification validates matching signatures and rejects forged ones', () => {
  const authToken = 'secret_auth_token_for_test_12345';
  const url = 'https://80-20-dialer.vercel.app/api/calls/status';
  const params = {
    CallSid: 'CA1234567890',
    CallStatus: 'completed',
    Duration: '45'
  };

  // Compute expected Twilio signature
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += `${key}${params[key]}`;
  }
  const validSignature = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  assert.equal(validateTwilioSignature(validSignature, url, params, authToken), true);
  assert.equal(validateTwilioSignature('forged_signature_1234', url, params, authToken), false);
  assert.equal(validateTwilioSignature(validSignature, url, { ...params, Duration: '46' }, authToken), false);
});

test('verifyTwilioRequest accurately reconstructs proxy headers and URLs', () => {
  const authToken = 'secret_auth_token_for_test_12345';
  process.env.TWILIO_AUTH_TOKEN = authToken;
  process.env.PUBLIC_URL = 'https://80-20-dialer.vercel.app';

  const url = 'https://80-20-dialer.vercel.app/api/calls/twiml?to=%2B15551234567';
  const params = { To: '+15551234567' };

  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += `${key}${params[key]}`;
  }
  const signature = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  const mockReq = {
    url: '/api/calls/twiml?to=%2B15551234567',
    headers: {
      get: (header) => {
        const headers = {
          'x-twilio-signature': signature,
          'x-forwarded-host': '80-20-dialer.vercel.app',
          'x-forwarded-proto': 'https'
        };
        return headers[header.toLowerCase()] || null;
      }
    }
  };

  assert.equal(verifyTwilioRequest(mockReq, params), true);
});

test('Resend / Svix HMAC-SHA256 signature verification validates payload and timestamp freshness', () => {
  const secret = 'whsec_mfZdh93kds02k4msld023kd0sl23kds=';
  const rawBody = JSON.stringify({ type: 'email.delivered', data: { id: 'msg_123' } });
  const svixId = 'msg_id_test_123';
  const svixTimestamp = String(Math.floor(Date.now() / 1000));

  const secretKey = Buffer.from(secret.slice(6), 'base64');
  const payloadToSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const signatureHash = crypto.createHmac('sha256', secretKey).update(payloadToSign, 'utf8').digest('base64');
  const svixSignature = `v1,${signatureHash}`;

  const validHeaders = {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': svixSignature
  };

  assert.equal(validateResendSignature(rawBody, validHeaders, secret), true);

  // Replay attack with expired timestamp (> 300s old)
  const expiredHeaders = {
    ...validHeaders,
    'svix-timestamp': String(Math.floor(Date.now() / 1000) - 400)
  };
  assert.equal(validateResendSignature(rawBody, expiredHeaders, secret), false);
});

test('Phone number validator enforces E.164 and cleans US/International numbers safely', () => {
  assert.equal(validatePhoneNumber('+1 (555) 234-5678').isValid, true);
  assert.equal(validatePhoneNumber('+1 (555) 234-5678').formattedPhone, '+15552345678');
  assert.equal(validatePhoneNumber('555-234-5678').formattedPhone, '+15552345678');
  assert.equal(validatePhoneNumber('123').isValid, false);
  assert.equal(validatePhoneNumber('invalid-text').isValid, false);
});

test('CSV Parser and header mapper handle arbitrary column orderings and extra columns', async () => {
  const csvData1 = 'email,first_name,last_name,phone\njohn@example.com,John,Doe,+15551234567';
  const parsed1 = await parseCsvBuffer(csvData1);
  const mapped1 = mapCsvHeaders(parsed1.headers);
  assert.equal(mapped1.columnMap.email, 'email');
  assert.equal(mapped1.columnMap.phone, 'phone');
  assert.equal(mapped1.columnMap.first_name, 'first_name');

  const csvData2 = 'phone,random_junk_col,company,email,name\n5551234567,xyz,Acme Corp,jane@acme.com,Jane Smith';
  const parsed2 = await parseCsvBuffer(csvData2);
  const mapped2 = mapCsvHeaders(parsed2.headers);
  assert.equal(mapped2.columnMap.phone, 'phone');
  assert.equal(mapped2.columnMap.company, 'company');
  assert.equal(mapped2.columnMap.email, 'email');
  assert.equal(mapped2.columnMap.name, 'name');
});
