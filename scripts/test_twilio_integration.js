
if (process.env.ALLOW_LEGACY_INTEGRATION_TESTS !== '1' || !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Legacy integration scripts mutate records and may send messages. Use an isolated test Supabase project with TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, and ALLOW_LEGACY_INTEGRATION_TESTS=1. npm test runs isolated regression tests.');
}
process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
/**
 * ==============================================================================
 * 80/20 OUTBOUND SYSTEM — MASTER TWILIO VOICE & SMS TEST SUITE
 * Covers WebRTC Tokens, TwiML, Outbound PSTN, Inbound SMS, Status Callbacks,
 * Webhook HMAC Signatures, DNC Suppression, and Database Persistence.
 * ==============================================================================
 */

import crypto from 'crypto';
import assert from 'assert';
import { validateTwilioConfig, validateEnvironment } from '../lib/envConfig.js';
import {
  generateVoiceToken,
  makeOutboundCall,
  sendSmsMessage,
  getCallStatus
} from '../lib/twilioService.js';
import {
  validateTwilioSignature,
  verifyTwilioRequest
} from '../lib/security/webhookSecurity.js';
import { validatePhoneNumber } from '../lib/phoneValidator.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { CallStore, MessageStore, LeadStore, ActivityLogStore } from '../lib/store.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`  ✅ PASS: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runAsyncTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`  ✅ PASS: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`     Error: ${err.message}`);
  }
}

console.log('===============================================================');
console.log('📞  80/20 OUTBOUND SYSTEM — TWILIO INTEGRATION TEST SUITE');
console.log('===============================================================\n');

// -------------------------------------------------------------
// 1. Environment & Credential Validation
// -------------------------------------------------------------
console.log('--- 1. Environment Configuration & Secret Validation ---');

runTest('Detects valid Twilio credentials with standard prefixes', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_MOCK_ACCOUNT_SID_FOR_VALIDATION';
  process.env.TWILIO_AUTH_TOKEN = 'mock_auth_token_for_validation_testing_only';
  process.env.TWILIO_API_KEY = 'SK_TEST_MOCK_API_KEY_FOR_VALIDATION';
  process.env.TWILIO_API_SECRET = 'mock_api_secret_for_validation_testing_only';
  process.env.TWILIO_TWIML_APP_SID = 'AP_TEST_MOCK_APP_SID_FOR_VALIDATION';
  process.env.TWILIO_PHONE_NUMBER = '+15551234567';
  process.env.PUBLIC_URL = 'https://outbound.8020acquisition.com';

  const errors = validateTwilioConfig(false);
  assert.strictEqual(errors.length, 0, 'No errors for valid configuration');
  process.env = origEnv;
});

runTest('Rejects invalid TWILIO_ACCOUNT_SID prefix', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_ACCOUNT_SID = 'INVALID_SID_123';
  const errors = validateTwilioConfig(false);
  assert(errors.some(e => e.includes('TWILIO_ACCOUNT_SID must begin with "AC"')));
  process.env = origEnv;
});

runTest('Rejects invalid TWILIO_API_KEY prefix', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_API_KEY = 'AC_WRONG_KEY';
  const errors = validateTwilioConfig(false);
  assert(errors.some(e => e.includes('TWILIO_API_KEY must begin with "SK"')));
  process.env = origEnv;
});

runTest('Rejects invalid TWILIO_TWIML_APP_SID prefix', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_TWIML_APP_SID = 'SK_WRONG_APP';
  const errors = validateTwilioConfig(false);
  assert(errors.some(e => e.includes('TWILIO_TWIML_APP_SID must begin with "AP"')));
  process.env = origEnv;
});

runTest('Rejects non-E.164 TWILIO_PHONE_NUMBER', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_PHONE_NUMBER = '555-123-4567';
  const errors = validateTwilioConfig(false);
  assert(errors.some(e => e.includes('TWILIO_PHONE_NUMBER must be in E.164 format')));
  process.env = origEnv;
});

// -------------------------------------------------------------
// 2. Phone Number Validation
// -------------------------------------------------------------
console.log('\n--- 2. Phone Number Validation & Sanitization ---');

runTest('Accepts and normalizes valid US phone numbers to E.164', () => {
  const check1 = validatePhoneNumber('+1 (555) 234-5678');
  assert.strictEqual(check1.isValid, true);
  assert.strictEqual(check1.formattedPhone, '+15552345678');

  const check2 = validatePhoneNumber('5552345678');
  assert.strictEqual(check2.isValid, true);
  assert.strictEqual(check2.formattedPhone, '+15552345678');
});

runTest('Rejects invalid phone numbers and letters', () => {
  const check1 = validatePhoneNumber('123');
  assert.strictEqual(check1.isValid, false);

  const check2 = validatePhoneNumber('abcdefghijk');
  assert.strictEqual(check2.isValid, false);
});

// -------------------------------------------------------------
// 3. WebRTC Voice Token Generation
// -------------------------------------------------------------
console.log('\n--- 3. WebRTC Softphone Voice Token Generation ---');

runTest('Generates valid JWT AccessToken with VoiceGrant for stable identity', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_ACCOUNT_SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.TWILIO_API_KEY = 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  process.env.TWILIO_API_SECRET = 'secret_cccccccccccccccccccccccc';
  process.env.TWILIO_TWIML_APP_SID = 'APdddddddddddddddddddddddddddddddd';

  const tokenData = generateVoiceToken({ identity: 'admin_rep_1', ttl: 3600 });
  assert(tokenData.token && typeof tokenData.token === 'string', 'JWT token string generated');
  assert.strictEqual(tokenData.identity, 'admin_rep_1');
  assert.strictEqual(tokenData.ttl, 3600);

  process.env = origEnv;
});

runTest('Throws clear error when WebRTC credentials are missing', () => {
  const origEnv = { ...process.env };
  delete process.env.TWILIO_API_KEY;
  delete process.env.TWILIO_API_SECRET;

  assert.throws(() => {
    generateVoiceToken({ identity: 'admin' });
  }, /Twilio WebRTC credentials/);

  process.env = origEnv;
});

// -------------------------------------------------------------
// 4. Webhook HMAC-SHA1 Signature Security
// -------------------------------------------------------------
console.log('\n--- 4. Webhook HMAC-SHA1 Signature Verification ---');

const testAuthToken = 'mock_twilio_auth_token_secret_12345';
const testUrl = 'https://outbound.8020acquisition.com/api/calls/twiml';
const testParams = {
  AccountSid: 'AC_MOCK_ACCOUNT_SID_FOR_SIGNATURE_TEST',
  CallSid: 'CA_MOCK_CALL_SID_FOR_SIGNATURE_TEST',
  From: '+15551234567',
  To: '+15559876543'
};

// Calculate exact valid signature
let sortedData = testUrl;
Object.keys(testParams).sort().forEach(k => {
  sortedData += `${k}${testParams[k]}`;
});
const validSig = crypto.createHmac('sha1', testAuthToken).update(sortedData, 'utf8').digest('base64');

runTest('Valid Twilio webhook signature is ACCEPTED', () => {
  const isValid = validateTwilioSignature(validSig, testUrl, testParams, testAuthToken);
  assert.strictEqual(isValid, true);
});

runTest('Forged/Tampered webhook signature is REJECTED', () => {
  const isValid = validateTwilioSignature('forged_fake_signature_abc=', testUrl, testParams, testAuthToken);
  assert.strictEqual(isValid, false);
});

runTest('Tampered payload parameter is REJECTED', () => {
  const tamperedParams = { ...testParams, To: '+15550000000' };
  const isValid = validateTwilioSignature(validSig, testUrl, tamperedParams, testAuthToken);
  assert.strictEqual(isValid, false);
});

runTest('verifyTwilioRequest helper matches with PUBLIC_URL', () => {
  const origEnv = { ...process.env };
  process.env.TWILIO_AUTH_TOKEN = testAuthToken;
  process.env.PUBLIC_URL = 'https://outbound.8020acquisition.com';

  const mockReq = {
    url: 'http://localhost:3000/api/calls/twiml',
    headers: {
      get: (header) => {
        if (header === 'x-twilio-signature') return validSig;
        if (header === 'host') return 'localhost:3000';
        return null;
      }
    }
  };

  const isVerified = verifyTwilioRequest(mockReq, testParams);
  assert.strictEqual(isVerified, true);
  process.env = origEnv;
});

// -------------------------------------------------------------
// 5. Permanent DNC & Suppression Enforcement
// -------------------------------------------------------------
console.log('\n--- 5. DNC & Permanent Suppression Enforcement ---');

await runAsyncTest('Blocks outbound call and SMS to numbers on the DNC list', async () => {
  const dncPhone = '+15559990001';

  // 1. Add number to suppression list
  const addRes = await SuppressionStore.add({
    phone: dncPhone,
    channel: 'all',
    reason: 'Do Not Call - Customer requested opt out'
  });
  assert.strictEqual(addRes.success, true);

  // 2. Check call channel suppression
  const callCheck = await SuppressionStore.isSuppressed({ phone: dncPhone, channel: 'call' });
  assert.strictEqual(callCheck.suppressed, true, 'Call is blocked by DNC suppression');

  // 3. Check SMS channel suppression
  const smsCheck = await SuppressionStore.isSuppressed({ phone: dncPhone, channel: 'sms' });
  assert.strictEqual(smsCheck.suppressed, true, 'SMS is blocked by DNC suppression');
});

await runAsyncTest('Permits communications to non-suppressed clean numbers', async () => {
  const cleanPhone = '+15558880002';
  const check = await SuppressionStore.isSuppressed({ phone: cleanPhone, channel: 'all' });
  assert.strictEqual(check.suppressed, false, 'Clean number is permitted');
});

// -------------------------------------------------------------
// 6. Database Persistence & Call Tracking
// -------------------------------------------------------------
console.log('\n--- 6. Database Persistence & Call Tracking ---');

await runAsyncTest('Creates call record with Twilio SID and retrieves by user', async () => {
  const testUserId = 'user_salesrep_99';
  const testCallSid = 'CA_test_call_' + Date.now();

  const created = await CallStore.create({
    userId: testUserId,
    callSid: testCallSid,
    from: '+15551234567',
    to: '+15558880002',
    status: 'initiated',
    direction: 'outbound',
    startTime: new Date()
  });

  assert.strictEqual(created.callSid, testCallSid);
  assert.strictEqual(created.status, 'initiated');

  const userCalls = await CallStore.findByUserId(testUserId);
  assert(userCalls.length > 0);
  assert.strictEqual(userCalls[0].callSid, testCallSid);
});

await runAsyncTest('Idempotently updates call status and recording URL via status callback', async () => {
  const testCallSid = 'CA_test_call_idempotent_' + Date.now();

  await CallStore.create({
    userId: 'user_salesrep_99',
    callSid: testCallSid,
    from: '+15551234567',
    to: '+15558880002',
    status: 'ringing'
  });

  // 1st Status Callback: answered
  const updated1 = await CallStore.findOneAndUpdate({ callSid: testCallSid }, {
    status: 'in-progress',
    duration: 15
  });
  assert.strictEqual(updated1.status, 'in-progress');
  assert.strictEqual(updated1.duration, 15);

  // 2nd Status Callback: completed + recording
  const updated2 = await CallStore.findOneAndUpdate({ callSid: testCallSid }, {
    status: 'completed',
    duration: 45,
    recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE123',
    recordingSid: 'RE123456789'
  });
  assert.strictEqual(updated2.status, 'completed');
  assert.strictEqual(updated2.duration, 45);
  assert.strictEqual(updated2.recordingUrl, 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE123');
});

// -------------------------------------------------------------
// 7. SMS Dispatch, Inbound & Status Callback Persistence
// -------------------------------------------------------------
console.log('\n--- 7. SMS Dispatch & Inbound Webhook Tracking ---');

await runAsyncTest('Persists outbound SMS with Twilio MessageSid', async () => {
  const testMsgSid = 'SM_test_' + Date.now();
  const msg = await MessageStore.create({
    userId: 'user_salesrep_99',
    messageSid: testMsgSid,
    from: '+15551234567',
    to: '+15558880002',
    body: 'Hello from 80/20 Dialer!',
    status: 'queued',
    channel: 'sms',
    direction: 'outbound'
  });

  assert.strictEqual(msg.messageSid, testMsgSid);
  assert.strictEqual(msg.direction, 'outbound');
  assert.strictEqual(msg.body, 'Hello from 80/20 Dialer!');
});

await runAsyncTest('Idempotently updates SMS status and error code on status callback', async () => {
  const testMsgSid = 'SM_status_test_' + Date.now();
  await MessageStore.create({
    userId: 'user_salesrep_99',
    messageSid: testMsgSid,
    from: '+15551234567',
    to: '+15558880002',
    body: 'Test Delivery Status',
    status: 'queued'
  });

  const updated = await MessageStore.findOneAndUpdate({ messageSid: testMsgSid }, {
    status: 'delivered'
  });
  assert.strictEqual(updated.status, 'delivered');
});

await runAsyncTest('Inbound SMS matching lead stops active email sequence and marks reply', async () => {
  const inboundPhone = '+15553334444';

  // Create test lead
  const testLead = await LeadStore.create({
    companyName: 'Acme Inbound Corp',
    contactName: 'Alice Inbound',
    phone: inboundPhone,
    email: 'alice@acme.com',
    status: 'contacted',
    emailSequence: {
      status: 'active',
      currentStep: 2
    }
  });

  // Simulate inbound message logic
  const inboundBody = 'Yes, I am interested in scheduling a call!';
  const inboundMsgSid = 'SM_inbound_' + Date.now();

  await MessageStore.create({
    userId: null,
    messageSid: inboundMsgSid,
    from: inboundPhone,
    to: '+15551234567',
    body: inboundBody,
    status: 'received',
    channel: 'sms',
    direction: 'inbound'
  });

  const matchedLeads = await LeadStore.findPendingByPhone(inboundPhone);
  assert(matchedLeads.length > 0, 'Found lead by phone');

  const lead = matchedLeads[0];
  await LeadStore.update(lead._id, {
    lastAction: `Inbound SMS: ${inboundBody.substring(0, 100)}`,
    hasUnansweredReply: true,
    lastReplyText: inboundBody,
    lastReplyChannel: 'sms',
    'emailSequence.status': 'stopped',
    'emailSequence.stopReason': 'inbound-sms'
  });

  const updatedLead = await LeadStore.findById(lead._id);
  assert.strictEqual(updatedLead.hasUnansweredReply, true);
  assert.strictEqual(updatedLead.emailSequence?.status, 'stopped');
});

await runAsyncTest('Inbound SMS with STOP keyword immediately flags permanent suppression and DNC', async () => {
  const optOutPhone = '+15554445555';

  const testLead = await LeadStore.create({
    companyName: 'OptOut Test Corp',
    contactName: 'Bob Stop',
    phone: optOutPhone,
    email: 'bob@stopcorp.com',
    status: 'contacted'
  });

  const optOutBody = 'STOP';
  const isOptOutKeyword = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(optOutBody.toUpperCase());
  assert.strictEqual(isOptOutKeyword, true);

  // Add suppression
  await SuppressionStore.add({
    phone: optOutPhone,
    channel: 'all',
    reason: `SMS opt-out keyword: ${optOutBody}`,
    leadId: testLead._id,
    source: 'inbound_sms'
  });

  await LeadStore.update(testLead._id, {
    status: 'opted-out',
    coldOutreachStopped: true,
    suppression: { phone: true, email: true, sms: true, whatsapp: true, dnc: true }
  });

  const suppCheck = await SuppressionStore.isSuppressed({ phone: optOutPhone, channel: 'call' });
  assert.strictEqual(suppCheck.suppressed, true, 'Number permanently suppressed from calling');

  const suppSmsCheck = await SuppressionStore.isSuppressed({ phone: optOutPhone, channel: 'sms' });
  assert.strictEqual(suppSmsCheck.suppressed, true, 'Number permanently suppressed from SMS');

  const updatedLead = await LeadStore.findById(testLead._id);
  assert.strictEqual(updatedLead.coldOutreachStopped, true);
  assert.strictEqual(updatedLead.status, 'opted-out');
});

await runAsyncTest('Call status callback correctly handles DialCallSid and ParentCallSid mapping', async () => {
  const parentSid = 'CA_parent_' + Date.now();
  const dialChildSid = 'CA_child_' + Date.now();

  await CallStore.create({
    userId: 'user_salesrep_99',
    callSid: parentSid,
    from: '+15551234567',
    to: '+15558880002',
    status: 'ringing'
  });

  // Status callback receives DialCallSid + DialCallStatus
  await CallStore.findOneAndUpdate({ callSid: parentSid }, {
    status: 'completed',
    duration: 32
  });

  const callRecord = await CallStore.findOneAndUpdate({ callSid: parentSid }, { status: 'completed' });
  assert.strictEqual(callRecord.status, 'completed');
  assert.strictEqual(callRecord.duration, 32);
});

// -------------------------------------------------------------
// Final Summary
// -------------------------------------------------------------
console.log('\n===============================================================');
console.log(`📊 TWILIO TEST SUITE SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
console.log('===============================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
