import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { BlastCampaignStore } from '@/lib/store';
import { createCampaign } from '@/lib/blasts/createCampaign';
import { logAuditEvent } from '@/lib/auditLogger';
export async function GET(req) {
  try {
    const { errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;
    return NextResponse.json({ success: true, data: await BlastCampaignStore.findAll() });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;
    const campaign = await createCampaign(user, await req.json());
    await logAuditEvent({ userId: user.id, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: campaign.id, notes: campaign.name, req });
    return NextResponse.json({ success: true, message: 'Campaign queued for background delivery.',
      data: { ...campaign, campaignId: campaign.id, sentCount: 0, failedCount: 0, skippedCount: campaign.excludedCount } }, { status: 201 });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }); }
}
