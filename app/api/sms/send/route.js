import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource } from '@/lib/middleware/authGuard';
import { MessageStore, LeadStore, ActivityLogStore, SendingInboxStore } from '@/lib/store';
import { sendSmsMessage } from '@/lib/twilioService';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { checkRateLimit } from '@/lib/rateLimiter';
import { checkOperationalHours } from '@/lib/operationalHours';
import { SuppressionStore } from '@/lib/suppression/suppressionStore';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const rateCheck = checkRateLimit(`sms_${user._id}`, 20, 60000);
    if (!rateCheck.success) return rateCheck.errorResponse;

    const body = await req.json();
    const { to, body: textBody, message, leadId } = body;
    const content = textBody || message;

    const validation = validatePhoneNumber(to);
    if (!validation.isValid) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    const recipientPhone = validation.formattedPhone;
    const smsContent = content ? content.trim() : '';

    if (!smsContent) {
      return NextResponse.json(
        { success: false, message: 'Message body cannot be empty.' },
        { status: 400 }
      );
    }

    // 1. DNC Suppression Check
    const dncCheck = await SuppressionStore.isSuppressed({ phone: recipientPhone, channel: 'sms' });
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
            { success: false, message: 'Forbidden. You do not have permission to message this lead.' },
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
    const statusCallbackUrl = `${hostUrl}/api/sms/status`;

    const smsResult = await sendSmsMessage(recipientPhone, smsContent, statusCallbackUrl);

    const messageRecord = await MessageStore.create({
      userId: user._id,
      leadId: leadId || null,
      messageSid: smsResult.messageSid,
      from: smsResult.from,
      to: smsResult.to,
      body: smsResult.body,
      status: smsResult.status,
      channel: 'sms',
      direction: 'outbound'
    });

    if (leadId) {
      await LeadStore.update(leadId, {
        lastAction: `SMS Sent: ${smsContent.substring(0, 80)}`,
        lastActionDate: new Date()
      });

      await ActivityLogStore.create({
        leadId,
        userId: user._id,
        action: 'sms',
        channel: 'sms',
        direction: 'outbound',
        outcome: 'sent',
        notes: smsContent.substring(0, 200),
        messageSid: smsResult.messageSid
      });
    }

    // Broadcast over Realtime Event Bus
    broadcastRealtimeEvent('sms.sent', {
      messageSid: smsResult.messageSid,
      leadId: leadId || null,
      userId: user._id,
      to: recipientPhone,
      channel: 'sms'
    });

    return NextResponse.json({
      success: true,
      message: 'SMS sent successfully.',
      data: messageRecord
    }, { status: 201 });
  } catch (err) {
    console.error('[Outbound SMS Error]:', err.message);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: err.statusCode || 500 }
    );
  }
}
