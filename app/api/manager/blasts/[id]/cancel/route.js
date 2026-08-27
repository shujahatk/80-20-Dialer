import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { BlastCampaignStore } from '@/lib/store';

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

    // Mark campaign as cancelled and clear stats
    await BlastCampaignStore.update(id, {
      status: 'cancelled',
      stats: {
        total: campaign.stats?.total || 0,
        sent: 0,
        failed: 0,
        skipped: 0
      }
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