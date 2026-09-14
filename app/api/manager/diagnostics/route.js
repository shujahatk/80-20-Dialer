import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSystemHealth } from '@/lib/systemHealth';
export async function GET(req) {
  try {
    const { errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;
    const health = await getSystemHealth();
    return NextResponse.json({ success: true, ...health });
  } catch { return NextResponse.json({ success: false, message: 'Diagnostics unavailable.' }, { status: 503 }); }
}
