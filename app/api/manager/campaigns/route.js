import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { CampaignStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Manager privileges required.' },
        { status: 401 }
      );
    }

    const campaigns = await CampaignStore.findAll();
    return NextResponse.json({
      success: true,
      data: campaigns
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
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, message: 'Campaign name is required.' },
        { status: 400 }
      );
    }

    const campaign = await CampaignStore.create({
      name,
      description: description || '',
      createdBy: user._id,
      status: 'active'
    });

    return NextResponse.json({
      success: true,
      message: 'Campaign created successfully.',
      data: campaign
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
