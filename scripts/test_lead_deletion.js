import { generateAccessToken } from '../lib/auth.js';
import { UserStore, LeadStore } from '../lib/store.js';
import { DELETE as singleDeleteHandler } from '../app/api/manager/leads/[id]/route.js';
import { POST as bulkDeleteHandler } from '../app/api/manager/leads/delete/route.js';
import { DELETE as generalLeadDeleteHandler } from '../app/api/leads/[id]/route.js';

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

async function runLeadDeletionTests() {
  console.log('\n===============================================================');
  console.log('🗑️  80/20 OUTBOUND SYSTEM — LEAD DELETION SECURITY & FUNCTIONAL TEST SUITE');
  console.log('===============================================================\n');

  // 1. Setup Test Users
  const admin = await UserStore.create({
    _id: 'test-admin-' + Date.now(),
    name: 'Admin Boss',
    email: 'admin-delete-test@8020.com',
    role: 'admin',
    approved: true,
    active: true
  });

  const manager = await UserStore.create({
    _id: 'test-mgr-' + Date.now(),
    name: 'Manager Lead',
    email: 'mgr-delete-test@8020.com',
    role: 'manager',
    approved: true,
    active: true
  });

  const salesRep = await UserStore.create({
    _id: 'test-rep-' + Date.now(),
    name: 'Sales Rep Rep',
    email: 'rep-delete-test@8020.com',
    role: 'salesperson',
    approved: true,
    active: true
  });

  const adminToken = generateAccessToken(admin);
  const managerToken = generateAccessToken(manager);
  const repToken = generateAccessToken(salesRep);

  console.log('--- TEST GROUP 1: SINGLE LEAD DELETION VIA API ---');

  // Create lead for admin deletion
  const lead1 = await LeadStore.create({
    _id: 'lead-test-admin-del',
    name: 'Delete Target Alpha',
    email: 'alpha@target.com',
    phone: '+15551234001',
    company: 'Alpha Corp',
    status: 'new'
  });

  // Test 1: Admin can permanently purge lead via /api/manager/leads/[id]?permanent=true
  const reqAdmin = mockNextRequest('http://localhost:3000/api/manager/leads/lead-test-admin-del?permanent=true', 'DELETE', null, adminToken);
  const resAdmin = await singleDeleteHandler(reqAdmin, { params: Promise.resolve({ id: 'lead-test-admin-del' }) });
  const dataAdmin = await resAdmin.json();

  assert(resAdmin.status === 200 && dataAdmin.success === true, 'Admin can permanently purge lead via /api/manager/leads/[id]');
  assert(await LeadStore.findById('lead-test-admin-del') === null, 'Deleted lead no longer exists in database store');

  // Create lead for manager deletion
  const lead2 = await LeadStore.create({
    _id: 'lead-test-mgr-del',
    name: 'Delete Target Beta',
    email: 'beta@target.com',
    phone: '+15551234002',
    company: 'Beta LLC',
    status: 'new'
  });

  // Test 2: Manager can soft delete single lead to Trash
  const reqMgr = mockNextRequest('http://localhost:3000/api/manager/leads/lead-test-mgr-del', 'DELETE', null, managerToken);
  const resMgr = await singleDeleteHandler(reqMgr, { params: Promise.resolve({ id: 'lead-test-mgr-del' }) });
  const dataMgr = await resMgr.json();

  const allActiveLeads = await LeadStore.findAll();
  const deletedLeads = await LeadStore.findDeleted();
  const foundInActive = allActiveLeads.some(l => (l._id || l.id) === 'lead-test-mgr-del');
  const foundInTrash = deletedLeads.some(l => (l._id || l.id) === 'lead-test-mgr-del');

  assert(resMgr.status === 200 && dataMgr.success === true, 'Manager can soft delete lead via /api/manager/leads/[id]');
  assert(!foundInActive && foundInTrash, 'Manager deleted lead is removed from active queries and visible in Trash');

  // Create lead for salesperson deletion attempt
  const lead3 = await LeadStore.create({
    _id: 'lead-test-rep-forbidden',
    name: 'Protected Lead Gamma',
    email: 'gamma@protected.com',
    phone: '+15551234003',
    company: 'Gamma Inc',
    status: 'new'
  });

  // Test 3: Salesperson CANNOT delete lead (403 Forbidden)
  const reqRep = mockNextRequest('http://localhost:3000/api/manager/leads/lead-test-rep-forbidden', 'DELETE', null, repToken);
  const resRep = await singleDeleteHandler(reqRep, { params: Promise.resolve({ id: 'lead-test-rep-forbidden' }) });
  assert(resRep.status === 403, 'Salesperson is blocked from /api/manager/leads/[id] with 403 Forbidden');

  // Test 4: Salesperson CANNOT delete lead via general /api/leads/[id] either
  const reqRepGeneral = mockNextRequest('http://localhost:3000/api/leads/lead-test-rep-forbidden', 'DELETE', null, repToken);
  const resRepGeneral = await generalLeadDeleteHandler(reqRepGeneral, { params: Promise.resolve({ id: 'lead-test-rep-forbidden' }) });
  assert(resRepGeneral.status === 403, 'Salesperson is blocked from /api/leads/[id] DELETE with 403 Forbidden');
  assert(await LeadStore.findById('lead-test-rep-forbidden') !== null, 'Lead was preserved and not deleted by salesperson');

  // Test 5: Unauthenticated request cannot delete (401 Unauthorized)
  const reqUnauth = mockNextRequest('http://localhost:3000/api/manager/leads/lead-test-rep-forbidden', 'DELETE', null, null);
  const resUnauth = await singleDeleteHandler(reqUnauth, { params: Promise.resolve({ id: 'lead-test-rep-forbidden' }) });
  assert(resUnauth.status === 401, 'Unauthenticated deletion attempt rejected with 401 Unauthorized');

  // Test 6: Deleting non-existent lead returns 404
  const reqNotFound = mockNextRequest('http://localhost:3000/api/manager/leads/non-existent-lead-999', 'DELETE', null, adminToken);
  const resNotFound = await singleDeleteHandler(reqNotFound, { params: Promise.resolve({ id: 'non-existent-lead-999' }) });
  assert(resNotFound.status === 404, 'Deleting non-existent lead returns 404 Not Found');

  console.log('\n--- TEST GROUP 2: BULK LEAD DELETION ---');

  // Create 3 leads for bulk deletion test
  const bulkLead1 = await LeadStore.create({ _id: 'bulk-lead-001', name: 'Bulk Alpha', email: 'bulk1@test.com', status: 'new' });
  const bulkLead2 = await LeadStore.create({ _id: 'bulk-lead-002', name: 'Bulk Beta', email: 'bulk2@test.com', status: 'new' });
  const bulkLead3 = await LeadStore.create({ _id: 'bulk-lead-003', name: 'Bulk Gamma', email: 'bulk3@test.com', status: 'new' });

  // Test 7: Bulk permanent purge via POST /api/manager/leads/delete with admin token
  const reqBulkAdmin = mockNextRequest(
    'http://localhost:3000/api/manager/leads/delete',
    'POST',
    { leadIds: ['bulk-lead-001', 'bulk-lead-002', 'bulk-lead-003'], permanent: true },
    adminToken
  );
  const resBulkAdmin = await bulkDeleteHandler(reqBulkAdmin);
  const dataBulkAdmin = await resBulkAdmin.json();

  assert(resBulkAdmin.status === 200 && dataBulkAdmin.success === true, 'Admin can bulk delete multiple leads via POST /api/manager/leads/delete');
  assert(await LeadStore.findById('bulk-lead-001') === null, 'Bulk lead 1 wiped from database');
  assert(await LeadStore.findById('bulk-lead-002') === null, 'Bulk lead 2 wiped from database');
  assert(await LeadStore.findById('bulk-lead-003') === null, 'Bulk lead 3 wiped from database');


  // Test 8: Salesperson cannot perform bulk deletion
  const reqBulkRep = mockNextRequest(
    'http://localhost:3000/api/manager/leads/delete',
    'POST',
    { leadIds: ['lead-test-rep-forbidden'] },
    repToken
  );
  const resBulkRep = await bulkDeleteHandler(reqBulkRep);
  assert(resBulkRep.status === 403, 'Salesperson cannot access bulk delete endpoint (403 Forbidden)');

  // Test 9: Empty bulk delete request returns 400 Bad Request
  const reqBulkEmpty = mockNextRequest(
    'http://localhost:3000/api/manager/leads/delete',
    'POST',
    { leadIds: [] },
    adminToken
  );
  const resBulkEmpty = await bulkDeleteHandler(reqBulkEmpty);
  assert(resBulkEmpty.status === 400, 'Empty bulk leadIds array returns 400 Bad Request');

  console.log('\n--- TEST GROUP 3: WORKSTATION, QUEUE & DNC SAFETY ---');

  // Create active lead and DNC lead
  const activeLead = await LeadStore.create({
    _id: 'active-queue-lead',
    name: 'Active Lead In Queue',
    email: 'active@queue.com',
    assigned_to: salesRep._id,
    userId: salesRep._id,
    status: 'new',
    priority: 10
  });

  const dncLead = await LeadStore.create({
    _id: 'dnc-suppressed-lead',
    name: 'DNC Prospect',
    email: 'dnc@domain.com',
    status: 'dnc',
    stage: 'DO_NOT_CONTACT',
    suppression: { phone: true, email: true, sms: true, whatsapp: true }
  });

  // Verify daily queue includes active lead before deletion
  const queueBefore = await LeadStore.findDailyQueue(salesRep._id);
  const foundInQueue = queueBefore.newLeads.some(l => (l._id || l.id) === 'active-queue-lead');
  assert(foundInQueue, 'Active lead initially present in salesperson daily queue');

  // Delete active lead via LeadStore.delete
  await LeadStore.delete('active-queue-lead');

  // Verify daily queue does not crash and excludes deleted lead
  const queueAfter = await LeadStore.findDailyQueue(salesRep._id);
  const foundAfter = queueAfter.newLeads.some(l => (l._id || l.id) === 'active-queue-lead');
  assert(!foundAfter, 'Deleted lead immediately disappears from salesperson daily queue');

  // Verify DNC is distinct: DNC lead still exists in database and retains suppression
  const dncRecord = await LeadStore.findById('dnc-suppressed-lead');
  assert(dncRecord !== null && (dncRecord.status === 'dnc' || dncRecord.stage === 'DO_NOT_CONTACT'), 'DNC lead remains preserved in system as separate compliance status');

  console.log('\n===============================================================');
  console.log(`📊 TEST SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLeadDeletionTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
