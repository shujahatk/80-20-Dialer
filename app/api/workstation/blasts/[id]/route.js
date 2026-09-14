import { NextResponse } from 'next/server';
import { requireAuth, isManagerOrAdmin } from '@/lib/middleware/authGuard';
import { BlastCampaignStore, MessageStore } from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';
async function access(req, params) {
  const auth = await requireAuth(req, ['owner', 'manager', 'admin', 'salesperson']);
  if (auth.errorResponse) return { response: auth.errorResponse };
  const { id } = await params;
  const campaign = await BlastCampaignStore.findById(id);
  if (!campaign) return { response: NextResponse.json({ success: false, message: 'Campaign not found.' }, { status: 404 }) };
  if (!isManagerOrAdmin(auth.user) && campaign.createdBy !== auth.user.id) return { response: NextResponse.json({ success: false, message: 'Forbidden.' }, { status: 403 }) };
  return { user: auth.user, campaign, id };
}
export async function GET(req, { params }) {
  try {
    const result = await access(req, params);
    if (result.response) return result.response;
    const logs = await MessageStore.findByCampaignId(result.id);
    return NextResponse.json({ success: true, data: { campaign: result.campaign, recentLogs: logs.slice(0, 50) } });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
export async function PUT(req, { params }) {
  try {
    const result = await access(req, params);
    if (result.response) return result.response;
    const { action } = await req.json();
    const allowed = { pause: ['queued', 'processing'], resume: ['paused'], cancel: ['draft', 'queued', 'processing', 'paused', 'needs_review', 'failed'] };
    if (!allowed[action]) return NextResponse.json({ success: false, message: 'Action must be pause, resume, or cancel.' }, { status: 400 });
    if (!allowed[action].includes(result.campaign.status)) return NextResponse.json({ success: false, message: 'Invalid campaign transition.' }, { status: 409 });
    const status = { pause: 'paused', resume: 'queued', cancel: 'cancelled' }[action];
    const campaign = await BlastCampaignStore.update(result.id, { status });
    await logAuditEvent({ userId: result.user.id, action: 'CAMPAIGN_UPDATED', entityType: 'campaign', entityId: result.id, notes: status, req });
    return NextResponse.json({ success: true, data: campaign });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
export async function DELETE(req, { params }) {
  try {
    const result = await access(req, params);
    if (result.response) return result.response;
    if (result.campaign.status === 'draft') await BlastCampaignStore.delete(result.id);
    else if (!['completed', 'cancelled'].includes(result.campaign.status)) await BlastCampaignStore.update(result.id, { status: 'cancelled' });
    await logAuditEvent({ userId: result.user.id, action: 'CAMPAIGN_REMOVED', entityType: 'campaign', entityId: result.id, req });
    return NextResponse.json({ success: true, message: 'Campaign state safely updated.' });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
