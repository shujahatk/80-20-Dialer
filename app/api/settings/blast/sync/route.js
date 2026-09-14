import { NextResponse } from 'next/server';
import { syncResendSmtpToListmonk, checkListmonkHealth } from '@/lib/services/listmonkService';
import { requireManager } from '@/lib/middleware/authGuard';

export async function POST(req) {
  const auth = await requireManager(req);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const syncResult = await syncResendSmtpToListmonk();
    const health = await checkListmonkHealth();

    return NextResponse.json({
      success: syncResult.success,
      message: syncResult.message || syncResult.error,
      syncResult,
      health,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
