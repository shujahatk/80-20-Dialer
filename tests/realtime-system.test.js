import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastRealtimeEvent, REALTIME_CHANNEL } from '../lib/realtime/eventBus.js';

test('Realtime Event Bus generates well-structured event payloads and dispatches correctly', async () => {
  const payload = {
    callSid: 'CA_test_unit_123',
    leadId: 'lead_unit_456',
    leadName: 'Test Contact',
    leadPhone: '+15551234567',
    userName: 'Sammar Rep',
    status: 'in-progress'
  };

  const result = await broadcastRealtimeEvent('call.connected', payload);

  assert.equal(result.success, true, 'broadcast should succeed');
  assert.equal(result.channel, REALTIME_CHANNEL, 'channel should match 8020_realtime_bus');
  assert.equal(result.event.eventType, 'call.connected', 'eventType matches');
  assert.equal(result.event.payload.callSid, 'CA_test_unit_123', 'callSid matches');
  assert.ok(result.event.timestamp, 'timestamp is generated');
});

test('Realtime Event Bus handles multiple distinct event types', async () => {
  const eventTypes = [
    { type: 'call.started', data: { callSid: 'CA_1', leadName: 'Lead 1' } },
    { type: 'call.ringing', data: { callSid: 'CA_1' } },
    { type: 'call.connected', data: { callSid: 'CA_1' } },
    { type: 'call.completed', data: { callSid: 'CA_1', duration: 42, status: 'completed' } },
    { type: 'sms.sent', data: { to: '+15559876543' } },
    { type: 'email.sent', data: { to: 'test@example.com' } },
    { type: 'email.delivered', data: { to: 'test@example.com' } },
    { type: 'email.replied', data: { from: 'test@example.com' } },
    { type: 'lead.stage_changed', data: { leadId: 'lead_1', stage: 'qualified', previousStage: 'call_1' } },
    { type: 'lead.disposition_changed', data: { leadId: 'lead_1', outcome: 'meeting_booked' } },
    { type: 'meeting.booked', data: { leadId: 'lead_1' } },
    { type: 'user.heartbeat', data: { user: { id: 'usr_1', name: 'Agent' } } }
  ];

  for (const evt of eventTypes) {
    const res = await broadcastRealtimeEvent(evt.type, evt.data);
    assert.equal(res.success, true);
    assert.equal(res.event.eventType, evt.type);
    assert.deepEqual(res.event.payload, evt.data);
  }
});
