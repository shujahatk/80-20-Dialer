import ActivityLog from '../models/ActivityLog.js';
import { connectDB, isMongoConnected } from './db.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';

/**
 * Creates an immutable audit log entry for security, authorization, and operations tracking.
 */
export async function logAuditEvent({
  userId,
  action,
  entityType = 'system',
  entityId = null,
  leadId = null,
  channel = '',
  notes = '',
  oldValue = null,
  newValue = null,
  req = null
}) {
  const timestamp = new Date();
  const ipAddress = req ? (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown') : 'server';
  const userAgent = req ? (req.headers.get('user-agent') || 'unknown') : 'server';

  // 1. Log to Supabase audit_logs table if configured
  if (isSupabaseConfigured()) {
    try {
      await getSupabaseClient().from('audit_logs').insert([{
        user_id: userId ? String(userId) : 'system',
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        lead_id: leadId ? String(leadId) : null,
        channel,
        notes,
        old_value: oldValue ? JSON.stringify(oldValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: timestamp.toISOString()
      }]);
    } catch (err) {
      console.warn('[AuditLogger Supabase Warning]:', err.message);
    }
  }

  // 2. Log to MongoDB ActivityLog model if connected
  try {
    await connectDB();
    if (isMongoConnected()) {
      await ActivityLog.create({
        userId,
        leadId,
        action: action || 'note',
        channel,
        notes: `[${entityType.toUpperCase()}] ${notes}`,
        timestamp
      });
    }
  } catch (err) {
    console.warn('[AuditLogger Mongo Warning]:', err.message);
  }
}
