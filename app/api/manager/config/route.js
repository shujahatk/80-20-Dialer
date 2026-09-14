import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { SystemConfigStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Authentication required.' },
        { status: 401 }
      );
    }
    if (!['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Manager privileges required.' },
        { status: 403 }
      );
    }

    const { formatHourAmPm, checkOperationalHours } = await import('@/lib/operationalHours.js');
    const config = await SystemConfigStore.getConfig();
    const operationalStatus = await checkOperationalHours();

    return NextResponse.json({
      success: true,
      data: {
        ...config,
        allowedHoursStartFormatted: formatHourAmPm(config.allowedHoursStart ?? 0),
        allowedHoursEndFormatted: formatHourAmPm(config.allowedHoursEnd ?? 24),
        operationalStatus
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
        { success: false, message: 'Unauthorized. Authentication required.' },
        { status: 401 }
      );
    }
    if (!['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. Manager privileges required.' },
        { status: 403 }
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
    const { formatHourAmPm, checkOperationalHours } = await import('@/lib/operationalHours.js');
    const operationalStatus = await checkOperationalHours();

    return NextResponse.json({
      success: true,
      message: 'System operational hours & configuration updated successfully.',
      data: {
        ...updatedConfig,
        allowedHoursStartFormatted: formatHourAmPm(updatedConfig.allowedHoursStart ?? 0),
        allowedHoursEndFormatted: formatHourAmPm(updatedConfig.allowedHoursEnd ?? 24),
        operationalStatus
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
