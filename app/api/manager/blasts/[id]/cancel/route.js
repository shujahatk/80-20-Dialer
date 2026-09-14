import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { isManagerOrAdmin } from '@/lib/middleware/authGuard';
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
    if (!isManagerOrAdmin(user) && campaign.createdBy !== user.id) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. This is not your campaign.' },
        { status: 403 }
      );
    }

    // Mark campaign as cancelled and clear stats
    await BlastCampaignStore.update(id, {
      status: 'cancelled'
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