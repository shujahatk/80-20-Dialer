import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { MessageStore, LeadStore, ActivityLogStore, SendingInboxStore } from '@/lib/store';
import { sendSmsMessage } from '@/lib/twilioService';
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
    const { to, body: textBody, leadId } = body;

    const validation = validatePhoneNumber(to);
    if (!validation.isValid) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    if (!textBody || typeof textBody !== 'string' || textBody.trim() === '') {
      return NextResponse.json(
        { success: false, message: 'Message body cannot be empty.' },
        { status: 400 }
      );
    }

    const recipientPhone = validation.formattedPhone;
    const smsContent = textBody.trim();

    if (leadId) {
      const lead = await LeadStore.findById(leadId);
      if (lead && lead.suppression?.sms) {
        return NextResponse.json(
          { success: false, message: 'SMS outreach is suppressed for this lead (DNC / Opt-Out).' },
          { status: 400 }
        );
      }
    }

    const hostUrl = process.env.PUBLIC_URL || `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`;
    const statusCallbackUrl = `${hostUrl}/api/messages/webhook/status`;

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

    // Increment backward compatibility counter
    await SendingInboxStore.incrementInboxUsage(user._id);

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

    return NextResponse.json({
      success: true,
      message: 'SMS sent successfully.',
      data: messageRecord
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

    const messages = await MessageStore.findByUserId(user._id);
    return NextResponse.json({
      success: true,
      count: messages.length,
      data: messages
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
