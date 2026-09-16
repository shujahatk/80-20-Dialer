import fs from 'node:fs';
import path from 'node:path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[match[1]] = val;
      }
    }
  }
} catch (e) {}

import assert from 'node:assert';
import { LeadStore } from '../lib/stores/leads.js';
import { broadcastRealtimeEvent, REALTIME_CHANNEL } from '../lib/realtime/eventBus.js';

async function runRealtimeSystemTests() {
  console.log('=== RUNNING REAL-TIME SYSTEM & PERFORMANCE TESTS ===');

  // Test 1: LeadStore pagination
  console.log('\n[Test 1] Testing LeadStore.findPaginated()...');
  const t0 = Date.now();
  const paginatedResult = await LeadStore.findPaginated({ page: 1, limit: 10 });
  const latency = Date.now() - t0;
  console.log(`✓ LeadStore.findPaginated executed in ${latency}ms`);
  assert(paginatedResult !== null, 'paginatedResult should not be null');
  assert(Array.isArray(paginatedResult.leads), 'leads should be an array');
  assert(typeof paginatedResult.total === 'number', 'total should be a number');
  assert(typeof paginatedResult.page === 'number', 'page should be a number');
  assert(typeof paginatedResult.totalPages === 'number', 'totalPages should be a number');
  console.log(`✓ Result stats: page=${paginatedResult.page}, total=${paginatedResult.total}, limit=${paginatedResult.limit}, returned=${paginatedResult.leads.length}`);

  // Test 2: Realtime Event Bus Broadcast
  console.log('\n[Test 2] Testing broadcastRealtimeEvent()...');
  const eventPayload = {
    callSid: 'CA_test_realtime_123',
    leadId: 'lead_test_456',
    leadName: 'Acme Corp Contact',
    leadPhone: '+15551234567',
    userName: 'Admin User',
    status: 'in-progress'
  };

  const broadcastRes = await broadcastRealtimeEvent('call.connected', eventPayload);
  console.log('✓ broadcastRealtimeEvent completed:', broadcastRes);
  assert(broadcastRes !== null, 'broadcastRes should be defined');
  assert(broadcastRes.channel === REALTIME_CHANNEL, `channel should match ${REALTIME_CHANNEL}`);
  assert(broadcastRes.event.eventType === 'call.connected', 'eventType should match');
  assert(broadcastRes.event.payload.callSid === 'CA_test_realtime_123', 'payload callSid matches');

  // Test 3: Multiple Event Types
  console.log('\n[Test 3] Testing various event types...');
  const eventTypes = [
    { type: 'call.started', data: { callSid: 'CA_1', leadName: 'Lead 1' } },
    { type: 'call.ringing', data: { callSid: 'CA_1' } },
    { type: 'call.connected', data: { callSid: 'CA_1' } },
    { type: 'call.completed', data: { callSid: 'CA_1', duration: 42, status: 'completed' } },
    { type: 'sms.sent', data: { to: '+15559876543' } },
    { type: 'email.sent', data: { to: 'test@example.com' } },
    { type: 'lead.stage_changed', data: { leadId: 'lead_1', stage: 'qualified', previousStage: 'call_1' } },
    { type: 'lead.disposition_changed', data: { leadId: 'lead_1', outcome: 'meeting_booked' } },
    { type: 'meeting.booked', data: { leadId: 'lead_1' } }
  ];

  for (const evt of eventTypes) {
    const res = await broadcastRealtimeEvent(evt.type, evt.data);
    assert(res.success === true, `Broadcast for ${evt.type} should succeed`);
  }
  console.log(`✓ Successfully broadcasted ${eventTypes.length} distinct real-time event types`);

  console.log('\n======================================================');
  console.log('🎉 ALL REAL-TIME SYSTEM & PERFORMANCE TESTS PASSED!');
  console.log('======================================================');
}

runRealtimeSystemTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
