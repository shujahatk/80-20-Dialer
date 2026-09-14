import { NextResponse } from 'next/server';
import { handleListmonkWebhook } from '@/lib/services/listmonkService';
import { validateListmonkSignature } from '@/lib/security/webhookSecurity';

export async function POST(req) {
  try {
    const rawBody = await req.text();
    
    // Validate signature
    const isValid = validateListmonkSignature(rawBody, req.headers);
    if (!isValid) {
      console.warn('[Listmonk Webhook]: Unauthorized webhook request rejected');
      return NextResponse.json({ success: false, error: 'Unauthorized webhook signature' }, { status: 401 });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }

    const result = await handleListmonkWebhook(payload);

    return NextResponse.json({
      received: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Listmonk Webhook Route Error]:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/listmonk',
    description: 'Receives Listmonk bounces, unsubscribes, and subscriber updates.',
  });
}
