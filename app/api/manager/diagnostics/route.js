import { NextResponse } from 'next/server.js';
import { requireManager } from '../../../../lib/middleware/authGuard.js';
import { isSupabaseConfigured } from '../../../../lib/supabase.js';
import { isMongoConnected, connectDB } from '../../../../lib/db.js';



export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    let dbStatus = 'disconnected';

    if (isSupabaseConfigured()) {
      dbStatus = 'supabase_connected';
    } else {
      const isConnected = await connectDB();
      if (isConnected && isMongoConnected()) {
        dbStatus = 'mongodb_connected';
      }
    }

    const twilioStatus = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? 'configured' : 'not_configured';
    const resendStatus = process.env.RESEND_API_KEY ? 'configured' : 'not_configured';
    const aiStatus = process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured';
    const rateLimiterBackend = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'redis_distributed' : 'local_in_memory';

    const systemHealthy = dbStatus !== 'disconnected';

    return NextResponse.json({
      success: true,
      status: systemHealthy ? 'healthy' : 'degraded',
      services: {
        database: dbStatus,
        telephony: twilioStatus,
        email: resendStatus,
        ai: aiStatus,
        rateLimiter: rateLimiterBackend
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: 'Diagnostics check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
