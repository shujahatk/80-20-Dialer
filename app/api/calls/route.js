import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { CallStore, LeadStore, SystemConfigStore } from '@/lib/store';
import { makeOutboundCall } from '@/lib/twilioService';
import { validatePhoneNumber } from '@/lib/phoneValidator';

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { to, leadId } = body;

    const validation = validatePhoneNumber(to);
    if (!validation.isValid) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    const recipientPhone = validation.formattedPhone;

    // Check calling hours constraints
    const config = await SystemConfigStore.getConfig();
    const startHour = config.allowedHoursStart ?? 8;
    const endHour = config.allowedHoursEnd ?? 18;
    
    let leadTimezone = 'UTC';
    if (leadId) {
      const lead = await LeadStore.findById(leadId);
      if (lead && lead.geography?.timezone) {
        leadTimezone = lead.geography.timezone;
      }
    }

    // Checking current hour in lead's timezone
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: leadTimezone,
        hour: 'numeric',
        hour12: false
      });
      const nowHour = parseInt(formatter.format(new Date()), 10);
      
      if (nowHour < startHour || nowHour >= endHour) {
        return NextResponse.json(
          { 
            success: false, 
            message: `Outside allowed calling hours (${startHour}:00 - ${endHour}:00). Current hour in lead's timezone (${leadTimezone}) is ${nowHour}:00.` 
          }, 
          { status: 403 }
        );
      }
    } catch (tzErr) {
      console.warn(`Timezone check failed for timezone: ${leadTimezone}, defaulting to allow.`);
    }

    const hostUrl = process.env.PUBLIC_URL || `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`;
    const twimlUrl = `${hostUrl}/api/calls/twiml?to=${encodeURIComponent(recipientPhone)}`;
    const statusUrl = `${hostUrl}/api/calls/status`;

    const callResult = await makeOutboundCall(recipientPhone, twimlUrl, statusUrl);

    const callRecord = await CallStore.create({
      userId: user._id,
      callSid: callResult.callSid,
      from: callResult.from,
      to: callResult.to,
      status: callResult.status,
      startTime: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Call initiated.',
      data: callRecord
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const calls = await CallStore.findByUserId(user._id);
    return NextResponse.json({
      success: true,
      count: calls.length,
      data: calls
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
