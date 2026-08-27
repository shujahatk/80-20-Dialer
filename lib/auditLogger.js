import ActivityLog from '@/models/ActivityLog';
import { connectDB } from '@/lib/db';

/**
 * Creates an audit log entry for security and operations tracking.
 */
export async function logAuditEvent({ userId, leadId = null, action, channel = '', notes = '', outcome = '' }) {
  try {
    await connectDB();
    await ActivityLog.create({
      userId,
      leadId,
      action: action || 'note',
      channel,
      notes,
      outcome,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('[Audit Logger] Failed to record audit log:', err.message);
  }
}
