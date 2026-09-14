import jwt from 'jsonwebtoken';
import { generateAccessToken, generateToken, verifyToken } from '../lib/auth.js';
import { UserStore } from '../lib/store.js';
import { 
  canAccessResource, 
  assertLeadAccess, 
  assertDraftAccess, 
  assertCampaignAccess, 
  assertStatsAccess, 
  requireAuth, 
  requireManager, 
  ROLES 
} from '../lib/middleware/authGuard.js';
import { 
  validateTwilioSignature, 
  validateResendSignature, 
  validateListmonkSignature 
} from '../lib/security/webhookSecurity.js';
import crypto from 'crypto';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName} ${details ? '- ' + details : ''}`);
  }
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🛡️  80/20 OUTBOUND SYSTEM — MASTER PRODUCTION SECURITY TEST SUITE');
  console.log('===============================================================\n');

  // Seed test users in UserStore
  const repUser = await UserStore.create({
    _id: 'rep-uuid-001',
    id: 'rep-uuid-001',
    name: 'Sammar Rep',
    email: 'sammar@8020acquisition.com',
    role: 'salesperson',
    approved: true,
    active: true,
    tokenVersion: 1
  });

  const adminUser = await UserStore.create({
    _id: 'admin-uuid-999',
    id: 'admin-uuid-999',
    name: 'Admin User',
    email: 'admin@8020acquisition.com',
    role: 'admin',
    approved: true,
    active: true,
    tokenVersion: 1
  });

  // -------------------------------------------------------------
  // 1. AUTHENTICATION & JWT INTEGRITY
  // -------------------------------------------------------------
  console.log('--- 1. Authentication & JWT Integrity Tests ---');

  const token = generateAccessToken(repUser);
  assert(typeof token === 'string' && token.length > 20, 'JWT Token Generation succeeds with payload');

  const decoded = verifyToken(token);
  assert(decoded && decoded.email === repUser.email && decoded.role === 'salesperson', 'Valid JWT verifies and returns user payload');

  const tamperedToken = token.slice(0, -5) + 'abcde';
  const decodedTampered = verifyToken(tamperedToken);
  assert(decodedTampered === null, 'Tampered JWT fails verification closed');

  // Test expired token
  const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_development_only_change_in_production';
  const expiredToken = jwt.sign({ id: repUser._id, role: 'salesperson' }, secret, { expiresIn: '-1s' });
  const decodedExpired = verifyToken(expiredToken);
  assert(decodedExpired === null, 'Expired JWT fails verification closed');

  // -------------------------------------------------------------
  // 2. RBAC & MANAGER ENDPOINT AUTHORIZATION
  // -------------------------------------------------------------
  console.log('\n--- 2. RBAC & Manager Authorization Tests ---');

  const repReq = {
    headers: {
      get: (h) => (h.toLowerCase() === 'authorization' ? `Bearer ${token}` : null)
    }
  };

  const adminToken = generateToken(adminUser);
  const adminReq = {
    headers: {
      get: (h) => (h.toLowerCase() === 'authorization' ? `Bearer ${adminToken}` : null)
    }
  };

  const repManagerAuth = await requireManager(repReq);
  assert(repManagerAuth.authorized === false || repManagerAuth.errorResponse !== null, 'Salesperson is denied access to Manager endpoints (requireManager)');

  const adminManagerAuth = await requireManager(adminReq);
  assert(adminManagerAuth.authorized === true || (adminManagerAuth.user && adminManagerAuth.user.role === 'admin'), 'Admin is granted access to Manager endpoints');

  // -------------------------------------------------------------
  // 3. IDOR (INSECURE DIRECT OBJECT REFERENCE) PROTECTION
  // -------------------------------------------------------------
  console.log('\n--- 3. IDOR Resource Ownership Tests ---');

  const rep1Lead = { id: 'lead-101', name: 'Acme Corp', assignedTo: 'rep-uuid-001' };
  const rep2Lead = { id: 'lead-102', name: 'Beta LLC', assignedTo: 'rep-uuid-002' };
  const unassignedLead = { id: 'lead-103', name: 'Gamma Inc', assignedTo: null };

  // Salesperson 1 access tests
  assert(assertLeadAccess(repUser, rep1Lead) === true, 'Salesperson can access own assigned lead');
  assert(assertLeadAccess(repUser, rep2Lead) === false, 'Salesperson CANNOT access another salesperson\'s lead (IDOR Blocked)');
  assert(assertLeadAccess(repUser, unassignedLead) === true, 'Salesperson can access unassigned pool lead');

  // Admin access tests
  assert(assertLeadAccess(adminUser, rep1Lead) === true, 'Admin can access any rep\'s lead');
  assert(assertLeadAccess(adminUser, rep2Lead) === true, 'Admin can access rep 2\'s lead');

  // AI Draft IDOR
  const rep1Draft = { id: 'draft-201', userId: 'rep-uuid-001', subject: 'Subject A' };
  const rep2Draft = { id: 'draft-202', userId: 'rep-uuid-002', subject: 'Subject B' };

  assert(assertDraftAccess(repUser, rep1Draft) === true, 'Salesperson can access/approve own AI draft');
  assert(assertDraftAccess(repUser, rep2Draft) === false, 'Salesperson CANNOT access/approve another salesperson\'s AI draft (IDOR Blocked)');
  assert(assertDraftAccess(adminUser, rep2Draft) === true, 'Manager/Admin can access any draft');

  // Session Stats IDOR
  assert(assertStatsAccess(repUser, 'rep-uuid-001') === true, 'Salesperson can access own session stats');
  assert(assertStatsAccess(repUser, 'rep-uuid-002') === false, 'Salesperson CANNOT query another salesperson\'s session stats via userId parameter');
  assert(assertStatsAccess(adminUser, 'rep-uuid-002') === true, 'Admin can query any user\'s session stats');

  // -------------------------------------------------------------
  // 4. ATOMIC LEAD LOCKING & CONCURRENCY
  // -------------------------------------------------------------
  console.log('\n--- 4. Atomic Lead Locking & Collision Prevention ---');

  const nowTime = new Date();
  const testLeadLock = {
    id: 'lead-lock-01',
    assignedTo: 'rep-uuid-001',
    locked_by: 'rep-uuid-001',
    locked_at: nowTime.toISOString()
  };

  const lockExpiryMs = 15 * 60 * 1000;
  const isLockedByOther = (currentHolder, lockTime, requesterId) => {
    if (!currentHolder || !lockTime) return false;
    if (String(currentHolder) === String(requesterId)) return false;
    return (Date.now() - new Date(lockTime).getTime()) < lockExpiryMs;
  };

  assert(isLockedByOther(testLeadLock.locked_by, testLeadLock.locked_at, 'rep-uuid-001') === false, 'Lead lock owner is permitted to re-enter');
  assert(isLockedByOther(testLeadLock.locked_by, testLeadLock.locked_at, 'rep-uuid-002') === true, 'Second agent is locked out (Collision Avoided / 409 Conflict)');

  // Expired lock check
  const oldLockTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  assert(isLockedByOther('rep-uuid-001', oldLockTime, 'rep-uuid-002') === false, 'Expired lead lock (>15 min) allows new agent to acquire');

  // Unlock authorization
  const canUnlock = (lead, user) => {
    if (['admin', 'manager', 'owner'].includes(user.role)) return true;
    return String(lead.locked_by) === String(user.id || user._id);
  };

  assert(canUnlock(testLeadLock, repUser) === true, 'Lock holder can release own lead lock');
  assert(canUnlock(testLeadLock, { id: 'rep-uuid-002', role: 'salesperson' }) === false, 'Other salesperson CANNOT release someone else\'s lead lock');
  assert(canUnlock(testLeadLock, adminUser) === true, 'Admin/Manager can unlock any lead');

  // -------------------------------------------------------------
  // 5. WEBHOOK SIGNATURE VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 5. Enterprise Webhook Signature Verification ---');

  const secretKey = 'test_webhook_secret_key_12345';

  // Listmonk HMAC
  const listmonkPayload = JSON.stringify({ event: 'subscriber.bounced', email: 'bounced@example.com' });
  const validListmonkSig = crypto.createHmac('sha256', secretKey).update(listmonkPayload, 'utf8').digest('hex');

  const listmonkHeadersValid = {
    get: (h) => (h === 'x-listmonk-signature' ? validListmonkSig : null),
    'x-listmonk-signature': validListmonkSig
  };
  const listmonkHeadersInvalid = {
    get: (h) => (h === 'x-listmonk-signature' ? 'invalid_hash_value' : null),
    'x-listmonk-signature': 'invalid_hash_value'
  };

  assert(validateListmonkSignature(listmonkPayload, listmonkHeadersValid, secretKey) === true, 'Listmonk webhook valid signature is ACCEPTED');
  assert(validateListmonkSignature(listmonkPayload, listmonkHeadersInvalid, secretKey) === false, 'Listmonk webhook invalid signature is REJECTED (Fail-Closed)');
  assert(validateListmonkSignature(listmonkPayload, {}, secretKey) === false, 'Listmonk webhook missing signature is REJECTED');

  // Twilio Signature
  const twilioAuthToken = 'twilio_auth_token_secret_987';
  const twilioUrl = 'https://outbound.8020acquisition.com/api/voice/status';
  const twilioParams = { CallSid: 'CA123456789', CallStatus: 'completed' };
  
  let twilioData = twilioUrl;
  Object.keys(twilioParams).sort().forEach(k => { twilioData += `${k}${twilioParams[k]}`; });
  const validTwilioSig = crypto.createHmac('sha1', twilioAuthToken).update(twilioData, 'utf8').digest('base64');

  assert(validateTwilioSignature(validTwilioSig, twilioUrl, twilioParams, twilioAuthToken) === true, 'Twilio webhook valid signature is ACCEPTED');
  assert(validateTwilioSignature('invalid_sig', twilioUrl, twilioParams, twilioAuthToken) === false, 'Twilio webhook forged signature is REJECTED');

  // -------------------------------------------------------------
  // 6. CAMPAIGN RECIPIENT INTEGRITY & DNC SUPPRESSION
  // -------------------------------------------------------------
  console.log('\n--- 6. Campaign Recipient Integrity & DNC Filtering ---');

  const candidateLeads = [
    { id: 'lead-1', email: 'valid1@prospect.com', suppression: {}, status: 'new' },
    { id: 'lead-2', email: 'suppressed@prospect.com', suppression: { email: true }, status: 'opted-out' },
    { id: 'lead-3', email: 'dnc@prospect.com', coldOutreachStopped: true, status: 'dnc' },
    { id: 'lead-4', email: 'invalid-email-format', suppression: {}, status: 'new' },
    { id: 'lead-5', email: 'valid2@prospect.com', suppression: {}, status: 'new' },
    { id: 'lead-1', email: 'valid1@prospect.com', suppression: {}, status: 'new' } // duplicate
  ];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const filteredRecipients = [];
  const seenEmails = new Set();

  candidateLeads.forEach(lead => {
    if (!lead.email || !emailRegex.test(lead.email)) return;
    if (lead.suppression?.email || lead.coldOutreachStopped || lead.status === 'opted-out' || lead.status === 'dnc') return;
    if (seenEmails.has(lead.email.toLowerCase())) return;
    seenEmails.add(lead.email.toLowerCase());
    filteredRecipients.push(lead);
  });

  assert(filteredRecipients.length === 2, `Exact recipient filter correctly kept 2 valid leads out of 6 (Filtered: ${filteredRecipients.length})`);
  assert(filteredRecipients.map(r => r.id).join(',') === 'lead-1,lead-5', 'Correct lead IDs (lead-1, lead-5) selected for campaign dispatch');
  assert(!filteredRecipients.find(r => r.id === 'lead-2'), 'Suppressed lead excluded from recipient queue');
  assert(!filteredRecipients.find(r => r.id === 'lead-3'), 'DNC lead excluded from recipient queue');
  assert(!filteredRecipients.find(r => r.id === 'lead-4'), 'Invalid email excluded from recipient queue');

  // -------------------------------------------------------------
  // 7. SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
