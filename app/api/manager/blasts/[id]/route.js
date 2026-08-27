import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { BlastCampaignStore, MessageStore } from '@/lib/store';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    await connectDB();

    const campaign = await BlastCampaignStore.findById(id);
    if (!campaign) {
      return NextResponse.json(
        { success: false, message: 'Blast campaign not found.' },
        { status: 404 }
      );
    }

    // Auth check: salesperson can only see their own campaigns
    if (user.role === 'salesperson' && campaign.createdBy.toString() !== user._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. This is not your campaign.' },
        { status: 403 }
      );
    }

    // Get message stats for this campaign
    const messages = await MessageStore.findByCampaignId(id);

    const stats = {
      total: campaign.stats?.total || 0,
      sent: campaign.stats?.sent || 0,
      failed: campaign.stats?.failed || 0,
      skipped: campaign.stats?.skipped || 0,
    };

    // Override with actual message-level counts if available
    if (messages.length > 0) {
      const msgStats = messages.reduce((acc, msg) => {
        acc[msg.status] = (acc[msg.status] || 0) + 1;
        return acc;
      }, {});
      // Only override if we have actual message data
      if (msgStats.sent !== undefined) stats.sent = msgStats.sent;
      if (msgStats.failed !== undefined) stats.failed = msgStats.failed;
      if (msgStats.skipped !== undefined) stats.skipped = msgStats.skipped;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...campaign,
        stats,
        messageCount: messages.length,
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    await connectDB();

    const campaign = await BlastCampaignStore.findById(id);
    if (!campaign) {
      return NextResponse.json(
        { success: false, message: 'Blast campaign not found.' },
        { status: 404 }
      );
    }

    // Auth check: salesperson can only cancel their own campaigns
    if (user.role === 'salesperson' && campaign.createdBy.toString() !== user._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. This is not your campaign.' },
        { status: 403 }
      );
    }

    // Cancel the campaign
    await BlastCampaignStore.update(id, {
      status: 'cancelled',
    });

    return NextResponse.json({
      success: true,
      message: 'Blast campaign cancelled successfully.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}