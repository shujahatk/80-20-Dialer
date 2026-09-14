import { generateAccessToken } from '../lib/auth.js';
import { UserStore, LeadStore, BlastCampaignStore, AiUsageStore } from '../lib/store.js';
import { SuppressionStore } from '../lib/suppression/suppressionStore.js';
import { processCsvUpload, MAX_CSV_FILE_SIZE, MAX_CSV_COLUMNS } from '../lib/csv/importLeads.js';

const BASE_URL = 'http://localhost:3000';

const categories = {
  'Frontend UI & Page Rendering': { total: 0, passed: 0, score: 0 },
  'Authentication & RBAC Security': { total: 0, passed: 0, score: 0 },
  'Lead Lifecycle & Trash Management': { total: 0, passed: 0, score: 0 },
  'Universal CSV Importer': { total: 0, passed: 0, score: 0 },
  'Permanent Suppression & DNC': { total: 0, passed: 0, score: 0 },
  'Workstation Atomic Locking': { total: 0, passed: 0, score: 0 },
  'Blast Campaigns & Idempotency': { total: 0, passed: 0, score: 0 },
  'AI Personalization Guardrails': { total: 0, passed: 0, score: 0 },
  'Observability & Diagnostics': { total: 0, passed: 0, score: 0 }
};

function recordTest(category, condition, testName, details = '') {
  categories[category].total++;
  if (condition) {
    categories[category].passed++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${details ? '— ' + details : ''}`);
  }
}

async function testFrontendPages() {
  console.log('\n===============================================================');
  console.log('🌐 1. TESTING FRONTEND PAGES & ROUTES');
  console.log('===============================================================');

  const pages = [
    { path: '/', label: 'Landing / Root Route' },
    { path: '/login', label: 'User Login Page' },
    { path: '/register', label: 'User Registration Page' },
    { path: '/auth/reset-password', label: 'Password Reset Page' },
    { path: '/dashboard', label: 'Manager Overview Dashboard' },
    { path: '/dashboard/leads', label: 'Leads Management & Filter View' },
    { path: '/dashboard/pipeline', label: 'Kanban Sales Pipeline' },
    { path: '/dashboard/analytics', label: 'Analytics & Performance Charts' },
    { path: '/dashboard/profile', label: 'User Profile & Security Settings' },
    { path: '/workstation', label: 'Outbound Dialing Workstation' },
    { path: '/workstation/blast-email', label: 'Blast Email Outreach Interface' },
    { path: '/manager/blasts', label: 'Campaign Dispatch & Queue Manager' }
  ];

  for (const page of pages) {
    try {
      const res = await fetch(`${BASE_URL}${page.path}`, { method: 'GET' });
      const html = await res.text();
      const isSuccess = res.status === 200 && html.length > 200 && !html.includes('Application error');
      recordTest(
        'Frontend UI & Page Rendering',
        isSuccess,
        `${page.label} (${page.path}) renders successfully with HTTP 200`,
        `Status: ${res.status}, Length: ${html.length}`
      );
    } catch (err) {
      recordTest('Frontend UI & Page Rendering', false, `${page.label} (${page.path})`, err.message);
    }
  }
}

async function testBackendAndFeatures() {
  console.log('\n===============================================================');
  console.log('🔐 2. TESTING AUTHENTICATION & RBAC SECURITY');
  console.log('===============================================================');

  // 1. Create Test Users
  const timestamp = Date.now();
  const testAdmin = await UserStore.create({
    _id: `admin_${timestamp}`,
    name: 'Master Admin',
    email: `admin_${timestamp}@8020test.com`,
    role: 'admin',
    approved: true,
    active: true
  });

  const testManager = await UserStore.create({
    _id: `mgr_${timestamp}`,
    name: 'Sales Manager',
    email: `mgr_${timestamp}@8020test.com`,
    role: 'manager',
    approved: true,
    active: true
  });

  const testRep1 = await UserStore.create({
    _id: `rep1_${timestamp}`,
    name: 'Sales Rep 1',
    email: `rep1_${timestamp}@8020test.com`,
    role: 'salesperson',
    approved: true,
    active: true
  });

  const testRep2 = await UserStore.create({
    _id: `rep2_${timestamp}`,
    name: 'Sales Rep 2',
    email: `rep2_${timestamp}@8020test.com`,
    role: 'salesperson',
    approved: true,
    active: true
  });

  const adminToken = generateAccessToken(testAdmin);
  const mgrToken = generateAccessToken(testManager);
  const rep1Token = generateAccessToken(testRep1);
  const rep2Token = generateAccessToken(testRep2);

  // Auth tests
  recordTest('Authentication & RBAC Security', Boolean(adminToken && mgrToken && rep1Token), 'JWT generation produces valid signed tokens');

  // RBAC test: Rep blocked from manager endpoints
  const mgrRes = await fetch(`${BASE_URL}/api/manager/config`, {
    headers: { Authorization: `Bearer ${rep1Token}` }
  });
  recordTest('Authentication & RBAC Security', mgrRes.status === 403, 'Salesperson is blocked from /api/manager/config with 403 Forbidden');

  // RBAC test: Admin permitted
  const adminRes = await fetch(`${BASE_URL}/api/manager/config`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  recordTest('Authentication & RBAC Security', adminRes.status === 200, 'Admin is permitted access to manager configuration');

  console.log('\n===============================================================');
  console.log('📋 3. TESTING LEAD LIFECYCLE & TRASH MANAGEMENT');
  console.log('===============================================================');

  // Create lead
  const testLead = await LeadStore.create({
    _id: `lead_life_${timestamp}`,
    name: 'Lifecycle Lead',
    email: `life_${timestamp}@target.com`,
    phone: '+15550001111',
    company: 'Lifecycle Corp',
    assigned_to: testRep1._id,
    status: 'new'
  });

  recordTest('Lead Lifecycle & Trash Management', Boolean(testLead && testLead._id), 'Lead created and stored in single source of truth');

  // IDOR check: Rep 2 cannot access Rep 1's lead
  const idorRes = await fetch(`${BASE_URL}/api/leads/${testLead._id}`, {
    headers: { Authorization: `Bearer ${rep2Token}` }
  });
  recordTest('Lead Lifecycle & Trash Management', idorRes.status === 403, 'IDOR Protection: Rep 2 denied access to Rep 1 assigned lead');

  // Stage update
  const stageRes = await fetch(`${BASE_URL}/api/leads/stage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: testLead._id, newStage: 'CONTACTED', note: 'Outreach call placed' })
  });
  const stageData = await stageRes.json();
  recordTest('Lead Lifecycle & Trash Management', stageRes.status === 200 && stageData.success, 'Stage progression updates pipeline stage');

  // Soft Delete to Trash
  const targetLeadId = testLead._id || testLead.id;
  const delRes = await fetch(`${BASE_URL}/api/manager/leads/${targetLeadId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const delData = await delRes.json();
  recordTest('Lead Lifecycle & Trash Management', delRes.status === 200 && (delData.data?.softDeleted === true || delData.data?.deleted === true), 'Soft-delete moves lead to Trash instead of destructive purge');

  // Verify excluded from normal queries
  const allActive = await LeadStore.findAll();
  const foundInActive = allActive.some(l => (l._id === targetLeadId || l.id === targetLeadId));
  recordTest('Lead Lifecycle & Trash Management', !foundInActive, 'Soft-deleted lead automatically excluded from normal lead queries');

  // Verify visible in Trash query
  const trashRes = await fetch(`${BASE_URL}/api/manager/leads?filter=trash`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const trashData = await trashRes.json();
  const foundInTrash = trashData.data?.some(l => (l._id === testLead._id || l.id === testLead._id || l._id === testLead.id || l.id === testLead.id));
  recordTest('Lead Lifecycle & Trash Management', Boolean(foundInTrash), 'Soft-deleted lead is visible in manager Trash view');

  // Restore lead from Trash
  const restoreRes = await fetch(`${BASE_URL}/api/manager/leads/${targetLeadId}/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const restoreData = await restoreRes.json();
  recordTest('Lead Lifecycle & Trash Management', restoreRes.status === 200 && restoreData.success, 'Manager can restore soft-deleted lead from Trash');

  // Restricted permanent purge
  const repPurgeAttempt = await fetch(`${BASE_URL}/api/manager/leads/${targetLeadId}?permanent=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rep1Token}` }
  });
  recordTest('Lead Lifecycle & Trash Management', repPurgeAttempt.status === 403, 'Salesperson permanently purge attempt is strictly blocked (403)');

  const adminPurge = await fetch(`${BASE_URL}/api/manager/leads/${targetLeadId}?permanent=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  recordTest('Lead Lifecycle & Trash Management', adminPurge.status === 200, 'Admin permanent purge successfully removes lead row');

  console.log('\n===============================================================');
  console.log('📥 4. TESTING UNIVERSAL CSV IMPORTER');
  console.log('===============================================================');

  // Test CSV upload with custom formatting & aliases
  const phone1 = `+1555${String(timestamp).slice(-7)}`;
  const phone2 = `+1556${String(timestamp).slice(-7)}`;
  const customCsv = `Full Name,Business Email,Mobile Phone,Company Name,Job Title
Alice Anderson,alice_${timestamp}@importer.com,${phone1},Alpha Innovations,Director
Bob Baker,bob_${timestamp}@importer.com,${phone2},Baker Group,CEO`;

  const importRes = await processCsvUpload({ csvBufferOrString: customCsv, assignToUserId: testRep1._id });
  recordTest('Universal CSV Importer', importRes.success && importRes.summary.imported === 2, 'Flexible CSV importer maps aliases and imports valid rows');

  // Test formula injection protection
  const formulaPhone = `+1557${String(timestamp).slice(-7)}`;
  const formulaCsv = `Name,Email,Phone,Company\n=cmd|calc!A0,formula_${timestamp}@test.com,${formulaPhone},Safe Corp`;
  const formulaRes = await processCsvUpload({ csvBufferOrString: formulaCsv, assignToUserId: 'pool' });
  const importedFormula = await LeadStore.findPendingByEmail(`formula_${timestamp}@test.com`);
  recordTest(
    'Universal CSV Importer',
    importedFormula.length > 0 && importedFormula[0].name.startsWith("'="),
    'Spreadsheet formula injection is neutralized with apostrophe prefix'
  );

  // Test resource limits: oversized payload
  const hugeBuffer = Buffer.alloc(MAX_CSV_FILE_SIZE + 1024);
  const oversizedRes = await processCsvUpload({ csvBufferOrString: hugeBuffer });
  recordTest('Universal CSV Importer', oversizedRes.success === false, 'Oversized CSV file (>15 MB) is safely rejected');

  console.log('\n===============================================================');
  console.log('🚫 5. TESTING PERMANENT SUPPRESSION & DNC');
  console.log('===============================================================');

  const dncEmail = `optout_${timestamp}@blocked.com`;
  const dncPhone = `+1558${String(timestamp).slice(-7)}`;

  const supAdd = await SuppressionStore.add({
    email: dncEmail,
    phone: dncPhone,
    channel: 'all',
    reason: 'Customer Unsubscribed',
    source: 'portal'
  });
  recordTest('Permanent Suppression & DNC', supAdd.success === true, 'Permanent suppression record stored in dedicated DNC table');

  const isSuppCheck = await SuppressionStore.isSuppressed({ email: dncEmail });
  recordTest('Permanent Suppression & DNC', isSuppCheck.suppressed === true, 'Suppression verified server-side via SuppressionStore.isSuppressed');

  // Re-importing DNC contact must automatically flag suppression
  const dncCsv = `Name,Email,Phone,Company\nDNC Return,${dncEmail},${dncPhone},Blocked Corp`;
  await processCsvUpload({ csvBufferOrString: dncCsv, assignToUserId: 'pool' });
  const reImportedDnc = await LeadStore.findPendingByEmail(dncEmail);
  recordTest(
    'Permanent Suppression & DNC',
    reImportedDnc.length > 0 && reImportedDnc[0].suppression?.dnc === true && reImportedDnc[0].coldOutreachStopped === true,
    'Re-imported DNC contact automatically retains suppressed state & stops outreach'
  );

  console.log('\n===============================================================');
  console.log('🔒 6. TESTING WORKSTATION ATOMIC LOCKING');
  console.log('===============================================================');

  const lockLead = await LeadStore.create({
    _id: `lock_lead_${timestamp}`,
    name: 'Locking Target',
    email: `lock_${timestamp}@test.com`,
    assigned_to: testRep1._id,
    status: 'new'
  });

  const targetLockId = lockLead._id || lockLead.id;

  // Rep 1 acquires atomic lock
  const lock1Res = await fetch(`${BASE_URL}/api/leads/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: targetLockId, action: 'lock' })
  });
  recordTest('Workstation Atomic Locking', lock1Res.status === 200, 'Salesperson acquires atomic workstation lead lock');

  // Rep 2 tries concurrent access -> Blocked with 403 or 423
  const lock2Res = await fetch(`${BASE_URL}/api/leads/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep2Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: targetLockId, action: 'lock' })
  });
  recordTest('Workstation Atomic Locking', [403, 409, 423].includes(lock2Res.status), 'Concurrent Rep 2 collision is blocked (403 Forbidden / 423 Locked)');

  // Rep 1 renews heartbeat
  const hbRes = await fetch(`${BASE_URL}/api/leads/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: lockLead._id, action: 'heartbeat' })
  });
  recordTest('Workstation Atomic Locking', hbRes.status === 200, 'Active workstation lock heartbeat renewed periodically');

  // Rep 1 releases lock
  const unlockRes = await fetch(`${BASE_URL}/api/leads/unlock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: lockLead._id })
  });
  recordTest('Workstation Atomic Locking', unlockRes.status === 200, 'Workstation lock released upon disposition / lead switch');

  console.log('\n===============================================================');
  console.log('🚀 7. TESTING BLAST CAMPAIGNS & IDEMPOTENCY');
  console.log('===============================================================');

  // Salesperson cannot blast unassigned / other rep leads
  const unauthBlastRes = await fetch(`${BASE_URL}/api/workstation/blasts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep2Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Unauthorized Blast',
      templateSubject: 'Hello',
      templateBody: 'Message',
      leadIds: [lockLead._id] // assigned to rep 1
    })
  });
  recordTest('Blast Campaigns & Idempotency', unauthBlastRes.status === 400, 'Salesperson campaign creation enforces recipient ownership scope');

  // Salesperson can blast own leads
  const authBlastRes = await fetch(`${BASE_URL}/api/workstation/blasts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Authorized Rep Blast',
      templateSubject: 'Hello {{firstName}}',
      templateBody: 'Body for {{company}}',
      leadIds: [lockLead._id]
    })
  });
  recordTest('Blast Campaigns & Idempotency', authBlastRes.status === 200, 'Salesperson creates blast campaign targeting authorized leads');

  console.log('\n===============================================================');
  console.log('🤖 8. TESTING AI PERSONALIZATION GUARDRAILS');
  console.log('===============================================================');

  // Reject oversized batch > 50
  const hugeAiBatch = Array.from({ length: 55 }, (_, i) => `lead_fake_${i}`);
  const aiBatchRes = await fetch(`${BASE_URL}/api/ai/personalize/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rep1Token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds: hugeAiBatch })
  });
  recordTest('AI Personalization Guardrails', aiBatchRes.status === 400, 'AI batch personalization enforces MAX_AI_BATCH_SIZE (50)');

  // Token usage logging
  await AiUsageStore.logUsage({
    userId: testRep1._id,
    campaignId: 'camp_test_telemetry',
    leadId: lockLead._id,
    model: 'claude-3-5-sonnet',
    inputTokens: 120,
    outputTokens: 45,
    status: 'success'
  });
  const aiLogs = await AiUsageStore.getUsageByUser(testRep1._id);
  recordTest('AI Personalization Guardrails', Array.isArray(aiLogs) && aiLogs.length > 0, 'AI token consumption and cost tracked per user');

  console.log('\n===============================================================');
  console.log('📊 9. TESTING OBSERVABILITY & DIAGNOSTICS');
  console.log('===============================================================');

  // Minimal public health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  recordTest(
    'Observability & Diagnostics',
    healthRes.status === 200 && healthData.status === 'ok' && !healthData.services,
    'Public /api/health endpoint returns minimal { status: "ok" } without exposing internals'
  );

  // Protected diagnostics
  const diagRes = await fetch(`${BASE_URL}/api/manager/diagnostics`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const diagData = await diagRes.json();
  recordTest(
    'Observability & Diagnostics',
    diagRes.status === 200 && diagData.success && Boolean(diagData.services),
    'Manager diagnostics endpoint returns complete infrastructure telemetry'
  );
}

async function runMasterVerification() {
  await testFrontendPages();
  await testBackendAndFeatures();

  console.log('\n===============================================================');
  console.log('🏆 COMPLETE SYSTEM VERIFICATION SCORECARD');
  console.log('===============================================================\n');

  let overallTotal = 0;
  let overallPassed = 0;

  for (const [catName, stats] of Object.entries(categories)) {
    const score = stats.total > 0 ? (stats.passed / stats.total) * 10 : 10;
    stats.score = Number(score.toFixed(1));
    overallTotal += stats.total;
    overallPassed += stats.passed;

    const badge = stats.passed === stats.total ? '✅ PASSED' : '❌ FAILED';
    console.log(`${catName.padEnd(38)}: ${stats.score}/10  (${stats.passed}/${stats.total} tests)  ${badge}`);
  }

  const overallScore = Number(((overallPassed / overallTotal) * 10).toFixed(1));
  const overallStatus = overallPassed === overallTotal ? 'PASSED (100%)' : 'FAILED';

  console.log('\n---------------------------------------------------------------');
  console.log(`TOTAL EVALUATION SCORE               : ${overallScore}/10  (${overallPassed}/${overallTotal} tests)  ${overallStatus}`);
  console.log('===============================================================\n');

  if (overallPassed === overallTotal) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runMasterVerification().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
