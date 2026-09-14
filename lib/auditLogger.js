import { getSupabaseClient, queryResult } from './supabase.js';
export async function logAuditEvent({ userId, action, entityType = 'system', entityId = null, leadId = null, channel = '', notes = '', oldValue = null, newValue = null, req = null }) {
  await queryResult(getSupabaseClient().from('audit_logs').insert({
    user_id: userId || null, action, entity_type: entityType, entity_id: entityId ? String(entityId) : null,
    lead_id: leadId || null, channel, notes, old_value: oldValue, new_value: newValue,
    ip_address: req?.headers?.get('x-forwarded-for') || 'server', user_agent: req?.headers?.get('user-agent') || 'server'
  }));
}
