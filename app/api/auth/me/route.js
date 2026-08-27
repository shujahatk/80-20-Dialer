import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { UserStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Please log in.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        approved: user.approved,
        timezone: user.timezone,
        dailyLeadTarget: user.dailyLeadTarget,
        dailyEmailLimit: user.dailyEmailLimit,
        calendarLink: user.calendarLink || '',
        crmWebhookUrl: user.crmWebhookUrl || '',
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function PUT(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { calendarLink, crmWebhookUrl, timezone } = body;
    
    const updateData = {};
    if (calendarLink !== undefined) updateData.calendarLink = calendarLink;
    if (crmWebhookUrl !== undefined) updateData.crmWebhookUrl = crmWebhookUrl;
    if (timezone !== undefined) updateData.timezone = timezone;

    const updatedUser = await UserStore.updateProfile(user._id, updateData);

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully.',
      data: updatedUser
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
