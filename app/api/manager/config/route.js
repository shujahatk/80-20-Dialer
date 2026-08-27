import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { SystemConfigStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Manager privileges required.' },
        { status: 401 }
      );
    }

    const config = await SystemConfigStore.getConfig();
    return NextResponse.json({
      success: true,
      data: config
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
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access. Manager privileges required.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { callRecordingEnabled, allowedHoursStart, allowedHoursEnd, crmWebhookUrl } = body;

    const updateData = {};
    if (callRecordingEnabled !== undefined) updateData.callRecordingEnabled = callRecordingEnabled;
    if (allowedHoursStart !== undefined) updateData.allowedHoursStart = parseInt(allowedHoursStart, 10);
    if (allowedHoursEnd !== undefined) updateData.allowedHoursEnd = parseInt(allowedHoursEnd, 10);
    if (crmWebhookUrl !== undefined) updateData.crmWebhookUrl = crmWebhookUrl;

    const updatedConfig = await SystemConfigStore.updateConfig(updateData);

    return NextResponse.json({
      success: true,
      message: 'System configuration updated successfully.',
      data: updatedConfig
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
