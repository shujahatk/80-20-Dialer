import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { LeadStore, MessageStore, ActivityLogStore } from '@/lib/store';

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
    const { leadId, subject, body: emailBody, fromName, fromEmail } = body;

    if (!leadId || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, message: 'leadId, subject, and body are required.' },
        { status: 400 }
      );
    }

    // Check lead exists and get email
    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Respect suppression - if lead is opted out of email, skip
    if (lead.suppression?.email) {
      return NextResponse.json(
        { success: false, message: 'This lead has opted out of email communication.', isSuppressed: true },
        { status: 403 }
      );
    }

    // Send email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    let sendResult = { success: false, id: null, error: null };

    if (!apiKey) {
      // Mock send - log to Message anyway
      sendResult = { success: true, mock: true, id: `mock-email-${Date.now()}` };
    } else {
      try {
        const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail || 'onboarding@resend.dev';
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: from,
            to: [lead.contact.email],
            subject: subject,
            html: emailBody,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || `Resend API returned status ${response.status}`);
        }
        sendResult = { success: true, id: data.id };
      } catch (err) {
        console.error('[Resend] Send error:', err.message);
        sendResult = { success: false, error: err.message };
      }
    }

    // Log to Message model
    const messageStatus = sendResult.success ? 'sent' : 'failed';
    const messageSid = sendResult?.id || `failed-email-${Date.now()}`;

    const messageRecord = await MessageStore.create({
      userId: user._id,
      leadId: lead._id,
      messageSid,
      from: fromName ? `${fromName} <${fromEmail || 'onboarding@resend.dev'}>` : fromEmail || 'onboarding@resend.dev',
      to: lead.contact.email,
      body: emailBody,
      status: messageStatus,
      channel: 'email',
      direction: 'outbound',
    });

    if (sendResult.success) {
      await LeadStore.update(leadId, {
        lastAction: `Email Sent: ${subject.substring(0, 80)}`,
        lastActionDate: new Date()
      });

      await ActivityLogStore.create({
        leadId,
        userId: user._id,
        action: 'email',
        channel: 'email',
        direction: 'outbound',
        outcome: 'sent',
        notes: `Subject: ${subject}\n\n${emailBody.substring(0, 200)}`,
        messageSid: sendResult.id || ''
      });

      // Enhanced logging
      console.log(`[Email] Successfully sent email to lead ${lead._id}: messageSid=${messageSid}`);
    } else {
      // Log failure with details
      console.error(`[Email] Failed to send email to lead ${lead._id}: ${sendResult.error || 'Unknown error'}`);

      await ActivityLogStore.create({
        leadId,
        userId: user._id,
        action: 'email',
        channel: 'email',
        direction: 'outbound',
        outcome: 'failed',
        notes: `Subject: ${subject}\n\nError: ${sendResult.error || 'Send failed'}`,
        messageSid: ''
      });
    }

    return NextResponse.json({
      success: sendResult.success,
      messageId: messageRecord._id,
      isSuppressed: false,
      data: { leadId, subject, email: lead.contact.email, sendError: sendResult.error || null }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

