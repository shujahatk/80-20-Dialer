import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { checkListmonkHealth, syncResendSmtpToListmonk } from '@/lib/services/listmonkService';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const listmonkHealth = await checkListmonkHealth();
    
    const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SMTP_PASSWORD;
    const resendConfigured = Boolean(resendApiKey && resendApiKey.startsWith('re_'));
    const smtpHost = process.env.RESEND_SMTP_HOST || 'smtp.resend.com';
    const smtpPort = parseInt(process.env.RESEND_SMTP_PORT || '465', 10);
    const fromEmail = process.env.EMAIL_FROM || process.env.SYSTEM_FROM_EMAIL || 'outreach@8020acquisition.com';

    return NextResponse.json({
      success: true,
      connected: listmonkHealth.connected,
      listmonk: listmonkHealth,
      postgres: {
        host: process.env.LISTMONK_DB_HOST || '127.0.0.1',
        port: process.env.LISTMONK_DB_PORT || 5432,
        database: process.env.LISTMONK_DB_NAME || 'listmonk',
        status: listmonkHealth.connected ? 'Connected' : 'Unknown',
      },
      resend: {
        configured: resendConfigured,
        host: smtpHost,
        port: smtpPort,
        user: process.env.RESEND_SMTP_USER || 'resend',
        fromEmail,
        hasKey: Boolean(resendApiKey),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const syncResult = await syncResendSmtpToListmonk();
    const listmonkHealth = await checkListmonkHealth();
    return NextResponse.json({
      success: syncResult.success,
      message: syncResult.message || syncResult.error,
      syncResult,
      listmonk: listmonkHealth,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
