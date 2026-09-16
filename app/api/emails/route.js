import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { LeadStore, MessageStore, ActivityLogStore } from '@/lib/store';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';

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

    // IDOR check: Salespeople can only email leads assigned to them or unassigned
    const { assertLeadAccess } = await import('@/lib/middleware/authGuard.js');
    if (!assertLeadAccess(user, lead)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to email this lead.' },
        { status: 403 }
      );
    }

    // Respect suppression - if lead or global suppression list has opted out of email, skip
    if (lead.suppression?.email || lead.suppression?.dnc || lead.status === 'opted-out' || lead.coldOutreachStopped) {
      return NextResponse.json(
        { success: false, message: 'This lead has opted out of email communication.', isSuppressed: true },
        { status: 403 }
      );
    }

    const recipientEmail = lead.contact?.email || lead.email;
    if (!recipientEmail) {
      return NextResponse.json(
        { success: false, message: 'This lead does not have a valid email address.' },
        { status: 400 }
      );
    }

    const { SuppressionStore } = await import('@/lib/suppression/suppressionStore.js');
    const dncCheck = await SuppressionStore.isSuppressed({ email: recipientEmail, channel: 'email' });
    if (dncCheck.suppressed) {
      return NextResponse.json(
        { success: false, message: 'Recipient is on the permanent DNC / suppression list.', isSuppressed: true },
        { status: 403 }
      );
    }

    // Check operational hours constraints
    const { checkOperationalHours } = await import('@/lib/operationalHours.js');
    const leadTimezone = lead.geography?.timezone || null;
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

    // Deliverability & Domain Throttle Guardrail (500 sends/domain/day)
    const { checkDomainSendLimit, recordDomainSend, getComplianceHeaders } = await import('@/lib/email/deliverability.js');
    const throttleCheck = checkDomainSendLimit(fromEmail || 'onboarding@resend.dev');
    if (!throttleCheck.allowed) {
      return NextResponse.json(
        { success: false, message: throttleCheck.message, throttled: true, resetInHours: throttleCheck.resetInHours },
        { status: 429 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: 'RESEND_API_KEY is not configured on the server. Email dispatch aborted.' },
        { status: 500 }
      );
    }

    const defaultFrom = process.env.EMAIL_FROM || 'outreach@8020acquisition.com';
    const defaultFromName = process.env.EMAIL_FROM_NAME || '80/20 Acquisition';
    const configuredReplyTo = process.env.REPLY_TO || 'replies@8020acquisition.com';

    // Check custom salesperson sending address (e.g. sammar@8020acquisition.com)
    const allowedDomains = ['8020acquisition.com', '8020aquisition.com', 'resend.dev'];
    const senderCandidate = fromEmail || user?.email || (user?.name ? `${user.name.toLowerCase()}@8020acquisition.com` : defaultFrom);
    const candidateDomain = senderCandidate.includes('@') ? senderCandidate.split('@')[1].toLowerCase() : '';
    const isCustomVerifiedDomain = allowedDomains.some(d => candidateDomain === d || candidateDomain.endsWith(`.${d}`)) ||
      (defaultFrom.includes('@') && candidateDomain === defaultFrom.split('@')[1].toLowerCase());
    
    const effectiveFromEmail = isCustomVerifiedDomain ? senderCandidate.trim().toLowerCase() : defaultFrom;
    const effectiveFromName = fromName ? fromName.trim() : (user?.name ? user.name.trim() : defaultFromName);
    const replyTo = isCustomVerifiedDomain ? effectiveFromEmail : (fromEmail && fromEmail.includes('@') ? fromEmail : configuredReplyTo);

    const complianceHeaders = getComplianceHeaders(recipientEmail);
    let sendResult = { success: false };

    try {
      const from = `${effectiveFromName} <${effectiveFromEmail}>`;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: from,
          to: [recipientEmail],
          reply_to: replyTo,
          subject: subject,
          html: emailBody,
          headers: complianceHeaders
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Resend API returned status ${response.status}`);
      }
      recordDomainSend(effectiveFromEmail, 1);
      sendResult = { success: true, id: data.id };
    } catch (err) {
      console.error('[Resend] Send error:', err.message);
      sendResult = { success: false, error: err.message };
    }

    // Log to Message model
    const messageStatus = sendResult.success ? 'sent' : 'failed';
    const messageSid = sendResult?.id || `failed-email-${Date.now()}`;
    const targetLeadId = lead._id || lead.id;
    const targetUserId = user._id || user.id;

    const messageRecord = await MessageStore.create({
      userId: targetUserId,
      leadId: targetLeadId,
      messageSid,
      from: `${effectiveFromName} <${effectiveFromEmail}>`,
      to: recipientEmail,
      body: emailBody,
      status: messageStatus,
      channel: 'email',
      direction: 'outbound',
    });

    if (sendResult.success) {
      await LeadStore.update(targetLeadId, {
        lastAction: `Email Sent: ${subject.substring(0, 80)}`,
        lastActionDate: new Date()
      });

      await ActivityLogStore.create({
        leadId: targetLeadId,
        userId: targetUserId,
        action: 'email',
        channel: 'email',
        direction: 'outbound',
        outcome: 'sent',
        notes: `Subject: ${subject}\n\n${emailBody.substring(0, 200)}`,
        messageSid: sendResult.id || ''
      });

      // Auto-sync subscriber to Listmonk
      try {
        const { syncLeadToListmonk } = await import('@/lib/listmonk');
        syncLeadToListmonk(lead).catch(() => {});
      } catch (lmErr) {}

      console.log(`[Email] Successfully sent email to lead ${targetLeadId}: messageSid=${messageSid}`);

      // Broadcast over Realtime Event Bus
      broadcastRealtimeEvent('email.sent', {
        messageSid,
        leadId: targetLeadId,
        userId: targetUserId,
        to: recipientEmail,
        subject
      });
    } else {
      console.error(`[Email] Failed to send email to lead ${targetLeadId}: ${sendResult.error || 'Unknown error'}`);

      await ActivityLogStore.create({
        leadId: targetLeadId,
        userId: targetUserId,
        action: 'email',
        channel: 'email',
        direction: 'outbound',
        outcome: 'failed',
        notes: `Subject: ${subject}\n\nError: ${sendResult.error || 'Send failed'}`,
        messageSid: ''
      });

      return NextResponse.json(
        { success: false, message: sendResult.error || 'Failed to dispatch email via Resend.', isSuppressed: false },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: messageRecord._id || messageRecord.id,
      isSuppressed: false,
      data: { leadId: targetLeadId, subject, email: recipientEmail, resendId: sendResult.id }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

