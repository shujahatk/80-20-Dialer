
if (process.env.ALLOW_LEGACY_INTEGRATION_TESTS !== '1' || !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Legacy integration scripts mutate records and may send messages. Use an isolated test Supabase project with TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, and ALLOW_LEGACY_INTEGRATION_TESTS=1. npm test runs isolated regression tests.');
}
process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
import { generateAccessToken } from '../lib/auth.js';
import { UserStore, LeadStore, BlastCampaignStore, AiUsageStore } from '../lib/store.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { processCsvUpload, MAX_CSV_FILE_SIZE, MAX_CSV_COLUMNS } from '../lib/csv/importLeads.js';
import { recoverStaleReservations } from '../workers/blastWorker.js';
import { GET as healthHandler } from '../app/api/health/route.js';
import { GET as diagnosticsHandler } from '../app/api/manager/diagnostics/route.js';
import { POST as lockHandler } from '../app/api/leads/lock/route.js';
import { POST as aiBatchHandler } from '../app/api/ai/personalize/batch/route.js';
import { POST as blastCreateHandler } from '../app/api/workstation/blasts/route.js';

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

function mockNextRequest(url, method = 'GET', body = null, token = null) {
  const headers = new Map();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body) headers.set('content-type', 'application/json');

  return {
    url,
    method,
    headers: {
      get: (h) => headers.get(h.toLowerCase()) || null
    },
    json: async () => body || {}
  };
}

async function runComprehensiveHardeningSuite() {
  console.log('\n===============================================================');
  console.log('🛡️  80/20 OUTBOUND SYSTEM — COMPREHENSIVE HARDENING SUITE (V2)');
  console.log('===============================================================\n');

  // Setup Test Users
  const adminUser = await UserStore.create({
    _id: 'hardened-admin-' + Date.now(),
    name: 'Hardened Admin',
    email: 'hardened-admin@8020.com',
    role: 'admin',
    approved: true,
    active: true
  });

  const rep1 = await UserStore.create({
    _id: 'hardened-rep1-' + Date.now(),
    name: 'Hardened Rep 1',
    email: 'hardened-rep1@8020.com',
    role: 'salesperson',
    approved: true,
    active: true
  });

  const rep2 = await UserStore.create({
    _id: 'hardened-rep2-' + Date.now(),
    name: 'Hardened Rep 2',
    email: 'hardened-rep2@8020.com',
    role: 'salesperson',
    approved: true,
    active: true
  });

  const adminToken = generateAccessToken(adminUser);
  const rep1Token = generateAccessToken(rep1);
  const rep2Token = generateAccessToken(rep2);

  console.log('--- 1. SUPPRESSION & DNC LIFECYCLE TESTS ---');

  // Clean up any test leads from previous runs
  const existingTestLeads = await LeadStore.findPendingByEmail('permanent-optout@client.com');
  for (const l of existingTestLeads) {
    await LeadStore.purgePermanent(l._id || l.id);
  }

  // Add suppression
  const supRes = await SuppressionStore.add({
    email: 'permanent-optout@client.com',
    phone: '+15559876543',
    channel: 'all',
    reason: 'Explicit DNC Request',
    source: 'client_unsubscribe'
  });

  assert(supRes.success === true, 'Suppression record created permanently in SuppressionStore');

  // Create lead with matching email
  const leadDnc = await LeadStore.create({
    _id: 'lead-dnc-target-' + Date.now(),
    name: 'DNC Target',
    email: 'permanent-optout@client.com',
    phone: '+15559876543',
    status: 'new'
  });

  // Check suppression is active before delete
  const isSupp1 = await SuppressionStore.isSuppressed({ email: 'permanent-optout@client.com' });
  assert(isSupp1.suppressed === true, 'Contact identified as suppressed prior to lead deletion');

  // Soft delete lead
  await LeadStore.softDelete(leadDnc._id || leadDnc.id);

  // Suppression MUST survive lead deletion
  const isSupp2 = await SuppressionStore.isSuppressed({ email: 'permanent-optout@client.com' });
  assert(isSupp2.suppressed === true, 'Suppression record survives lead deletion');

  // Permanent purge of lead row
  await LeadStore.purgePermanent(leadDnc._id || leadDnc.id);
  const isSupp3 = await SuppressionStore.isSuppressed({ email: 'permanent-optout@client.com' });
  assert(isSupp3.suppressed === true, 'Suppression record survives permanent lead row purge');

  // Re-importing DNC contact via CSV must retain suppression status
  const reImportCsv = `Full Name,Email,Phone,Company
DNC Target Returned,permanent-optout@client.com,+15559876543,Return Corp`;
  const reImportRes = await processCsvUpload({ csvBufferOrString: reImportCsv, assignToUserId: 'pool' });
  assert(reImportRes.success === true && reImportRes.summary.imported === 1, 'Re-imported CSV lead processed');

  const reImportedLeads = await LeadStore.findPendingByEmail('permanent-optout@client.com');
  const dncReImported = reImportedLeads[0];
  assert(
    dncReImported && dncReImported.suppression?.dnc === true && dncReImported.coldOutreachStopped === true,
    'Re-imported contact automatically flagged with permanent DNC suppression'
  );

  console.log('\n--- 2. BLAST CAMPAIGN AUTHORIZATION & SCOPING TESTS ---');

  // Create leads assigned to Rep 1 and Rep 2
  const leadRep1 = await LeadStore.create({
    _id: 'lead-rep1-campaign-' + Date.now(),
    name: 'Rep1 Lead',
    email: 'rep1-contact@test.com',
    assigned_to: rep1._id,
    status: 'new'
  });

  const leadRep2 = await LeadStore.create({
    _id: 'lead-rep2-campaign-' + Date.now(),
    name: 'Rep2 Lead',
    email: 'rep2-contact@test.com',
    assigned_to: rep2._id,
    status: 'new'
  });

  // Rep 1 attempts to blast Rep 2's lead -> MUST be rejected (0 eligible leads)
  const reqRep1UnauthorizedBlast = mockNextRequest(
    'http://localhost:3000/api/workstation/blasts',
    'POST',
    {
      name: 'Unauthorized Rep Blast',
      templateSubject: 'Hello',
      templateBody: 'Message body',
      leadIds: [leadRep2._id]
    },
    rep1Token
  );
  const resRep1Unauthorized = await blastCreateHandler(reqRep1UnauthorizedBlast);
  const dataRep1Unauthorized = await resRep1Unauthorized.json();
  assert(
    resRep1Unauthorized.status === 400 && dataRep1Unauthorized.error?.code === 'NO_ELIGIBLE_LEADS',
    'Salesperson cannot blast leads assigned to another salesperson (Scope Blocked)'
  );

  // Rep 1 blasting own assigned lead -> MUST succeed
  const reqRep1AuthorizedBlast = mockNextRequest(
    'http://localhost:3000/api/workstation/blasts',
    'POST',
    {
      name: 'Authorized Rep Blast',
      templateSubject: 'Hello {{firstName}}',
      templateBody: 'Message body for {{company}}',
      leadIds: [leadRep1._id]
    },
    rep1Token
  );
  const resRep1Authorized = await blastCreateHandler(reqRep1AuthorizedBlast);
  const dataRep1Authorized = await resRep1Authorized.json();
  assert(
    resRep1Authorized.status === 200 && dataRep1Authorized.success === true,
    'Salesperson can blast own assigned leads'
  );

  // Rep 1 attempting to exceed 500 batch limit -> MUST be rejected
  const oversizedRepBatch = Array.from({ length: 501 }, (_, i) => `fake-lead-${i}`);
  const reqOversizedBlast = mockNextRequest(
    'http://localhost:3000/api/workstation/blasts',
    'POST',
    {
      name: 'Oversized Blast',
      templateSubject: 'Hello',
      templateBody: 'Body',
      leadIds: oversizedRepBatch
    },
    rep1Token
  );
  const resOversized = await blastCreateHandler(reqOversizedBlast);
  const dataOversized = await resOversized.json();
  assert(
    resOversized.status === 400 && dataOversized.error?.code === 'LIMIT_EXCEEDED',
    'Salesperson blast batch limit (500) enforced'
  );

  console.log('\n--- 3. AI PERSONALIZATION GUARDRAILS & LIMITS ---');

  // AI Batch Limit > 50 leads must be rejected
  const oversizedAiBatch = Array.from({ length: 51 }, (_, i) => `fake-lead-${i}`);
  const reqAiBatch = mockNextRequest(
    'http://localhost:3000/api/ai/personalize/batch',
    'POST',
    { leadIds: oversizedAiBatch },
    rep1Token
  );
  const resAiBatch = await aiBatchHandler(reqAiBatch);
  const dataAiBatch = await resAiBatch.json();
  assert(
    resAiBatch.status === 400 && dataAiBatch.code === 'BATCH_LIMIT_EXCEEDED',
    'AI batch personalization enforces MAX_AI_BATCH_SIZE (50)'
  );

  console.log('\n--- 4. ATOMIC WORKSTATION LOCKING & HEARTBEAT ---');

  const lockLead = await LeadStore.create({
    _id: 'concurrency-lock-lead-' + Date.now(),
    name: 'Lock Candidate',
    email: 'lock-test@domain.com',
    assigned_to: rep1._id,
    status: 'new'
  });

  // Rep 1 acquires atomic lock
  const reqLockRep1 = mockNextRequest(
    'http://localhost:3000/api/leads/lock',
    'POST',
    { leadId: lockLead._id, action: 'lock' },
    rep1Token
  );
  const resLockRep1 = await lockHandler(reqLockRep1);
  const dataLockRep1 = await resLockRep1.json();
  assert(resLockRep1.status === 200 && dataLockRep1.success === true, 'Rep 1 successfully acquires atomic lead lock');

  // Rep 2 tries to acquire lock on the same lead -> MUST receive 423 Locked / Conflict
  const reqLockRep2 = mockNextRequest(
    'http://localhost:3000/api/leads/lock',
    'POST',
    { leadId: lockLead._id, action: 'lock' },
    rep2Token
  );
  const resLockRep2 = await lockHandler(reqLockRep2);
  const dataLockRep2 = await resLockRep2.json();
  assert(
    (resLockRep2.status === 423 || resLockRep2.status === 403 || resLockRep2.status === 409) && dataLockRep2.success === false,
    'Concurrent Rep 2 blocked from locking lead currently worked by Rep 1 (Collision Prevented)'
  );

  // Rep 1 renews heartbeat
  const reqHeartbeat = mockNextRequest(
    'http://localhost:3000/api/leads/lock',
    'POST',
    { leadId: lockLead._id, action: 'heartbeat' },
    rep1Token
  );
  const resHeartbeat = await lockHandler(reqHeartbeat);
  const dataHeartbeat = await resHeartbeat.json();
  assert(resHeartbeat.status === 200 && dataHeartbeat.success === true, 'Lock heartbeat successfully renewed');

  console.log('\n--- 5. CAMPAIGN IDEMPOTENCY & WORKER CRASH RECOVERY ---');

  // Simulate stale campaign recipient reservation after crash
  const staleCampaign = await BlastCampaignStore.create({
    name: 'Crash Recovery Test Campaign',
    status: 'processing',
    recipients: [
      {
        id: 'rcpt_stale_1',
        campaign_id: 'camp_stale_1',
        lead_id: lockLead._id,
        status: 'processing',
        idempotency_key: `camp_stale_1_${lockLead._id}_v1`,
        reserved_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago
        attempt_count: 1
      }
    ]
  });

  // Run crash recovery
  await recoverStaleReservations(staleCampaign);
  const recoveredCampaign = await BlastCampaignStore.findById(staleCampaign._id || staleCampaign.id);
  const recoveredRcpt = recoveredCampaign.recipients[0];
  assert(
    recoveredRcpt.status === 'pending' && recoveredRcpt.attempt_count === 2,
    'Crash recovery detects stale reservations (>10m) and resets to pending for safe reconciliation'
  );

  console.log('\n--- 6. CSV RESOURCE LIMITS & PROTECTION ---');

  // File size limit (MAX_CSV_FILE_SIZE = 15MB)
  const oversizedBuffer = Buffer.alloc(MAX_CSV_FILE_SIZE + 1024);
  const resOversizedCsv = await processCsvUpload({ csvBufferOrString: oversizedBuffer });
  assert(
    resOversizedCsv.success === false && resOversizedCsv.message.includes('exceeds maximum supported size'),
    'Oversized CSV file (>15 MB) rejected cleanly'
  );

  // Column limit (MAX_CSV_COLUMNS = 100)
  const headers101 = Array.from({ length: MAX_CSV_COLUMNS + 5 }, (_, i) => `col_${i}`).join(',') + '\n' +
    Array.from({ length: MAX_CSV_COLUMNS + 5 }, () => 'val').join(',');
  const resOversizedCols = await processCsvUpload({ csvBufferOrString: headers101 });
  assert(
    resOversizedCols.success === false && resOversizedCols.message.includes('exceeding the maximum allowed limit'),
    'CSV with excessive columns (>100) rejected safely'
  );

  console.log('\n--- 7. PUBLIC HEALTH & MINIMAL DISCLOSURE TESTS ---');

  // Public health endpoint MUST NOT disclose infrastructure internals
  const resHealth = await healthHandler();
  const dataHealth = await resHealth.json();
  assert(
    resHealth.status === 200 && dataHealth.status === 'ok' && !dataHealth.services && !dataHealth.uptimeSeconds,
    'Public /api/health endpoint returns minimal { status: "ok" } without exposing internal services'
  );

  // Protected diagnostics requires manager authorization
  const reqDiagUnauth = mockNextRequest('http://localhost:3000/api/manager/diagnostics', 'GET', null, null);
  const resDiagUnauth = await diagnosticsHandler(reqDiagUnauth);
  assert(resDiagUnauth.status === 401, 'Unauthenticated access to /api/manager/diagnostics returns 401');

  const reqDiagRep = mockNextRequest('http://localhost:3000/api/manager/diagnostics', 'GET', null, rep1Token);
  const resDiagRep = await diagnosticsHandler(reqDiagRep);
  assert(resDiagRep.status === 403, 'Salesperson access to /api/manager/diagnostics returns 403 Forbidden');

  const reqDiagAdmin = mockNextRequest('http://localhost:3000/api/manager/diagnostics', 'GET', null, adminToken);
  const resDiagAdmin = await diagnosticsHandler(reqDiagAdmin);
  const dataDiagAdmin = await resDiagAdmin.json();
  assert(
    resDiagAdmin.status === 200 && dataDiagAdmin.success === true && Boolean(dataDiagAdmin.services),
    'Admin access to /api/manager/diagnostics returns complete service diagnostics'
  );

  console.log('\n===============================================================');
  console.log(`📊 COMPREHENSIVE HARDENING TEST SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runComprehensiveHardeningSuite().catch(err => {
  console.error('Fatal hardening test error:', err);
  process.exit(1);
});
