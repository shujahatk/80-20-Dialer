import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { BlastCampaignStore, LeadStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    await connectDB();

    // Manager/owner/admin can see all; salesperson sees only their own campaigns
    const userId = user.role === 'salesperson' ? user._id : null;

    const campaigns = await BlastCampaignStore.findAll();
    const filteredCampaigns = userId 
      ? campaigns.filter(c => c.createdBy?.toString() === userId.toString())
      : campaigns;

    return NextResponse.json({
      success: true,
      data: filteredCampaigns
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    await connectDB();
    const body = await req.json();

    const { name, type, templateSubject, templateBody, leadIds, status, useAiPersonalization } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, message: 'Campaign name is required.' },
        { status: 400 }
      );
    }

    if (!type || !['email', 'sms'].includes(type)) {
      return NextResponse.json(
        { success: false, message: 'Campaign type must be either email or sms.' },
        { status: 400 }
      );
    }

    // Validate templates
    if (type === 'email') {
      if (!templateSubject || !templateSubject.trim()) {
        return NextResponse.json(
          { success: false, message: 'Subject is required for email blast campaigns.' },
          { status: 400 }
        );
      }
      if (!templateBody || !templateBody.trim()) {
        return NextResponse.json(
          { success: false, message: 'Body template is required for email blast campaigns.' },
          { status: 400 }
        );
      }
    } else if (type === 'sms') {
      if (!templateBody || !templateBody.trim()) {
        return NextResponse.json(
          { success: false, message: 'Message body template is required for SMS blast campaigns.' },
          { status: 400 }
        );
      }
    }

    // Validate leadIds lead count (1 to 1000)
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'At least one lead must be selected for the blast.' },
        { status: 400 }
      );
    }

    if (leadIds.length > 1000) {
      return NextResponse.json(
        { success: false, message: 'Cannot select more than 1000 leads for a campaign.' },
        { status: 400 }
      );
    }

    // Validate leadIds exist and are unique
    const uniqueLeadIds = [...new Set(leadIds)];
    if (uniqueLeadIds.length !== leadIds.length) {
      return NextResponse.json(
        { success: false, message: 'Duplicate lead IDs are not allowed.' },
        { status: 400 }
      );
    }

    for (const leadId of leadIds) {
      const lead = await LeadStore.findById(leadId);
      if (!lead) {
        return NextResponse.json(
          { success: false, message: `One or more lead IDs are invalid: ${leadId}` },
          { status: 400 }
        );
      }
    }

    // Validate status
    const allowedStatuses = ['draft', 'queued', 'processing', 'completed', 'cancelled'];
    const campaignStatus = (status && allowedStatuses.includes(status)) ? status : 'draft';

    const campaign = await BlastCampaignStore.create({
      name: name.trim(),
      type,
      createdBy: user._id,
      templateSubject: type === 'email' ? templateSubject.trim() : '',
      templateBody: templateBody.trim(),
      useAiPersonalization: useAiPersonalization !== false,
      leadIds: uniqueLeadIds,
      status: campaignStatus,
      stats: {
        total: uniqueLeadIds.length,
        sent: 0,
        failed: 0,
        skipped: 0
      }
    });

    return NextResponse.json({
      success: true,
      data: campaign
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}