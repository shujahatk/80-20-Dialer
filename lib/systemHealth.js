import { checkDatabaseHealth } from './db.js';
import { getSupabaseClient, queryResult } from './supabase.js';
import { getJwtSecret } from './auth/jwt.js';
export async function getSystemHealth() {
  const services = { database: 'unavailable', worker: 'unavailable', authentication: process.env.JWT_SECRET ? 'configured' : 'missing',
    email: process.env.RESEND_API_KEY ? 'configured' : 'missing',
    telephony: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? 'configured' : 'missing',
    ai: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? 'configured' : 'missing' };
  try { getJwtSecret(); } catch { services.authentication = 'invalid'; }
  let dbError = null;
  try {
    await checkDatabaseHealth();
    services.database = 'connected';
    const workers = await queryResult(getSupabaseClient().from('worker_health').select('id')
      .gte('heartbeat_at', new Date(Date.now() - 60000).toISOString()).limit(1));
    services.worker = workers.length ? 'running' : 'stopped';
    // Query the queue table as well: a missing migration is a readiness failure.
    await queryResult(getSupabaseClient().from('outbound_blast_campaigns').select('id').limit(1));
  } catch (err) {
    services.database = 'unavailable';
    dbError = err.message;
  }
  const healthy = services.database === 'connected' && services.worker === 'running' && services.authentication === 'configured' && services.email === 'configured';
  return {
    status: healthy ? 'ok' : 'degraded',
    services,
    databaseError: dbError,
    supabaseConfig: {
      url: process.env.SUPABASE_URL ? 'SUPABASE_URL_SET' : (process.env.NEXT_PUBLIC_SUPABASE_URL ? 'NEXT_PUBLIC_SUPABASE_URL_SET' : 'MISSING'),
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING'
    },
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };
}
