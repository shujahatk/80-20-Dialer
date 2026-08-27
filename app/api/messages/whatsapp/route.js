import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { MessageStore, LeadStore, ActivityLogStore, UserStore, WhatsAppTemplateStore } from '@/lib/store';
import { sendWhatsAppMessage } from '@/lib/twilioService';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { applyMergeFields } from '@/lib/templateEngine';

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
    const { to, body: textBody, leadId, templateId, closerId } = body;

    const validation = validatePhoneNumber(to);
    if (!validation.isValid) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    let messageBody = (textBody || '').trim();
    let lead = null;
    let templateName = '';

    if (leadId) {
      lead = await LeadStore.findById(leadId);
      if (!lead) {
        return NextResponse.json(
          { success: false, message: 'Lead not found.' },
          { status: 404 }
        );
      }
      if (lead.suppression?.whatsapp) {
        return NextResponse.json(
          { success: false, message: 'WhatsApp is suppressed for this lead (DNC / Opt-Out).' },
          { status: 400 }
        );
      }
    }

    const senderUser = await UserStore.findById(user._id);
    let closerUser = null;
    if (closerId) {
      closerUser = await UserStore.findById(closerId);
    } else if (lead?.booking?.closer) {
      // Find user by name for calendar link mapping
      const allUsers = await UserStore.findAllUsers();
      closerUser = allUsers.find(u => u.name === lead.booking.closer);
    }

    // Resolve template if templateId is provided
    if (templateId) {
      const template = await WhatsAppTemplateStore.findById(templateId);
      if (!template) {
        return NextResponse.json(
          { success: false, message: 'WhatsApp Template not found.' },
          { status: 404 }
        );
      }
      templateName = template.name;
      messageBody = applyMergeFields(messageBody || template.body, lead, senderUser, closerUser);
    } else if (messageBody) {
      // Standard template replacement
      messageBody = applyMergeFields(messageBody, lead, senderUser, closerUser);
    }

    if (!messageBody || messageBody.trim() === '') {
      return NextResponse.json(
        { success: false, message: 'Message body cannot be empty (or templateId required).' },
        { status: 400 }
      );
    }

    const recipientPhone = validation.formattedPhone;
    const hostUrl = process.env.PUBLIC_URL || `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`;
    const statusCallbackUrl = `${hostUrl}/api/messages/webhook/status`;

    const result = await sendWhatsAppMessage(recipientPhone, messageBody, statusCallbackUrl);

    const messageRecord = await MessageStore.create({
      userId: user._id,
      leadId: leadId || null,
      messageSid: result.messageSid,
      from: result.from,
      to: result.to,
      body: result.body,
      status: result.status,
      channel: 'whatsapp',
      direction: 'outbound'
    });

    if (leadId) {
      await LeadStore.update(leadId, {
        lastAction: `WhatsApp sent${templateName ? ` (${templateName})` : ''}: ${messageBody.substring(0, 80)}`,
        lastActionDate: new Date()
      });

      await ActivityLogStore.create({
        leadId,
        userId: user._id,
        action: 'sms',
        channel: 'whatsapp',
        direction: 'outbound',
        outcome: 'sent',
        notes: templateName ? `[${templateName}] ${messageBody.substring(0, 200)}` : messageBody.substring(0, 200),
        messageSid: result.messageSid
      });
    }

    return NextResponse.json({
      success: true,
      message: 'WhatsApp message sent successfully.',
      data: messageRecord
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
