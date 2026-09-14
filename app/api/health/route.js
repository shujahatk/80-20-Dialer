import { NextResponse } from 'next/server';
import { getSystemHealth } from '@/lib/systemHealth';
export async function GET() {
  const health = await getSystemHealth();
  return NextResponse.json(health, { status: health.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
