import { NextResponse } from 'next/server';
import { requireAuth, isManagerOrAdmin } from '@/lib/middleware/authGuard';
import { BlastCampaignStore } from '@/lib/store';
import { createCampaign } from '@/lib/blasts/createCampaign';
import { logAuditEvent } from '@/lib/auditLogger';
export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req, ['owner', 'manager', 'admin', 'salesperson']);
    if (errorResponse) return errorResponse;
    const campaigns = (await BlastCampaignStore.findAll()).filter(campaign => isManagerOrAdmin(user) || campaign.createdBy === user.id);
    return NextResponse.json({ success: true, data: campaigns });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req, ['owner', 'manager', 'admin', 'salesperson']);
    if (errorResponse) return errorResponse;
    const campaign = await createCampaign(user, await req.json());
    await logAuditEvent({ userId: user.id, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: campaign.id, notes: campaign.name, req });
    return NextResponse.json({ success: true, data: campaign }, { status: 201 });
  } catch (error) { return NextResponse.json({ success: false, error: { message: error.message } }, { status: error.status || 500 }); }
}
