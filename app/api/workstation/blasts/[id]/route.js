import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource } from '@/lib/middleware/authGuard';
import { connectDB } from '@/lib/db';
import BlastCampaign from '@/models/BlastCampaign';
import Message from '@/models/Message';
import { logAuditEvent } from '@/lib/auditLogger';

export async function GET(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();

    const campaign = await BlastCampaign.findById(id).lean();
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found.' } },
        { status: 404 }
      );
    }

    if (!canAccessResource(user, campaign.createdBy)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to view this campaign.' } },
        { status: 403 }
      );
    }

    // Fetch recent message logs for live telemetry detail
    const logs = await Message.find({ blastCampaignId: id }).sort({ createdAt: -1 }).limit(50).lean();

    return NextResponse.json({
      success: true,
      data: {
        campaign,
        recentLogs: logs
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to fetch campaign telemetry.' } },
      { status: 500 }
    );
  }
}

export async function PUT(req, { params }) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();

    const campaign = await BlastCampaign.findById(id);
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found.' } },
        { status: 404 }
      );
    }

    if (!canAccessResource(user, campaign.createdBy)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to modify this campaign.' } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { action } = body; // 'pause' | 'resume' | 'cancel'

    if (!['pause', 'resume', 'cancel'].includes(action)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Action must be pause, resume, or cancel.' } },
        { status: 400 }
      );
    }

    let newStatus = campaign.status;

    if (action === 'pause') {
      if (['processing', 'queued', 'running'].includes(campaign.status)) {
        newStatus = 'paused';
      }
    } else if (action === 'resume') {
      if (campaign.status === 'paused') {
        newStatus = 'queued';
      }
    } else if (action === 'cancel') {
      newStatus = 'cancelled';
    }

    campaign.status = newStatus;
    if (newStatus === 'cancelled') {
      campaign.completedAt = new Date();
    }

    await campaign.save();

    await logAuditEvent({
      userId: user._id,
      action: 'note',
      notes: `Updated Blast Campaign '${campaign.name}' status to ${newStatus} via action '${action}'.`
    });

    return NextResponse.json({
      success: true,
      data: campaign
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to update campaign state.' } },
      { status: 500 }
    );
  }
}
