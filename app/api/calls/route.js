import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource } from '@/lib/middleware/authGuard';
import { CallStore, LeadStore } from '@/lib/store';
import { makeOutboundCall } from '@/lib/twilioService';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { checkOperationalHours } from '@/lib/operationalHours';
import { SuppressionStore } from '@/lib/suppression/suppressionStore';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

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

    // 1. DNC Suppression Check
    const dncCheck = await SuppressionStore.isSuppressed({ phone: recipientPhone, channel: 'call' });
    if (dncCheck.suppressed) {
      return NextResponse.json(
        { success: false, message: 'Lead is on DNC/suppression list.' },
        { status: 403 }
      );
    }

    let leadTimezone = null;
    if (leadId) {
      const lead = await LeadStore.findById(leadId);
      if (lead) {
        const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;
        if (!canAccessResource(user, leadOwner)) {
          return NextResponse.json(
            { success: false, message: 'Forbidden. You do not have permission to call this lead.' },
            { status: 403 }
          );
        }
        if (lead.suppression?.phone || lead.suppression?.dnc || lead.coldOutreachStopped || lead.status === 'opted-out' || lead.status === 'dnc') {
          return NextResponse.json(
            { success: false, message: 'Lead is on DNC/suppression list.' },
            { status: 403 }
          );
        }
        if (lead.geography?.timezone) {
          leadTimezone = lead.geography.timezone;
        }
      }
    }

    // 2. Check operational hours constraints
    const hoursCheck = await checkOperationalHours(leadTimezone);
    if (!hoursCheck.allowed) {
      return NextResponse.json(
        { 
          success: false, 
          message: hoursCheck.message,
          operationalHours: hoursCheck
        }, 
        { status: 403 }
      );
    }

    const hostUrl = process.env.PUBLIC_URL || `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`;
    const twimlUrl = `${hostUrl}/api/calls/twiml?to=${encodeURIComponent(recipientPhone)}`;
    const statusUrl = `${hostUrl}/api/calls/status`;

    const callResult = await makeOutboundCall(recipientPhone, twimlUrl, statusUrl);

    const callRecord = await CallStore.create({
      userId: user._id,
      leadId: leadId || null,
      callSid: callResult.callSid,
      from: callResult.from,
      to: callResult.to,
      status: callResult.status,
      direction: 'outbound',
      startTime: new Date()
    });

    // Broadcast live call started event
    broadcastRealtimeEvent('call.started', {
      callSid: callResult.callSid,
      leadId: leadId || null,
      userId: user._id,
      userName: user.name || user.email || 'Sales Rep',
      to: recipientPhone,
      status: 'dialing'
    });

    return NextResponse.json({
      success: true,
      message: 'Call initiated.',
      data: callRecord
    }, { status: 201 });
  } catch (err) {
    console.error('[Outbound Call Error]:', err.message);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred while placing call.' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

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
