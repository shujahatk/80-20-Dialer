import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { BlastCampaignStore, LeadStore, MessageStore, ActivityLogStore } from '@/lib/store';
import { sendEmail } from '@/lib/emailService';
import {
  checkListmonkHealth,
  getOrCreateList,
  syncSubscribersToListmonk,
  createListmonkCampaign,
  updateListmonkCampaignStatus
} from '@/lib/listmonk';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const campaigns = await BlastCampaignStore.findAll();
    return NextResponse.json({
      success: true,
      data: campaigns
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const {
      title,
      name,
      subject,
      templateSubject,
      htmlContent,
      templateBody,
      leadIds = [],
      sendingInboxId = 'default'
    } = body;

    const blastTitle = (title || name || '').trim();
    const blastSubject = (subject || templateSubject || '').trim();
    const blastContent = (htmlContent || templateBody || '').trim();

    if (!blastTitle || !blastSubject || !blastContent) {
      return NextResponse.json(
        { success: false, error: 'Missing campaign title, subject line, or message body.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one recipient lead must be selected for the campaign.' },
        { status: 400 }
      );
    }

    // 1. Fetch and validate all selected recipient leads
    const verifiedLeads = [];
    for (const id of leadIds) {
      const lead = await LeadStore.findById(id);
      if (lead) {
        verifiedLeads.push(lead);
      }
    }

    if (verifiedLeads.length === 0) {
      return NextResponse.json(
        { success: false, error: 'None of the selected lead IDs were found in the database.' },
        { status: 404 }
      );
    }

    // 2. Server-side DNC and suppression filtering
    const eligibleLeads = [];
    let suppressedCount = 0;
    let missingEmailCount = 0;

    for (const lead of verifiedLeads) {
      const email = (lead.contact?.email || lead.email || '').trim();
      if (!email || !email.includes('@')) {
        missingEmailCount++;
      } else if (lead.suppression?.email || lead.status === 'DO_NOT_CONTACT' || lead.status === 'opted-out') {
        suppressedCount++;
      } else {
        eligibleLeads.push(lead);
      }
    }

    if (eligibleLeads.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `No eligible leads to send to (${suppressedCount} suppressed, ${missingEmailCount} missing email).`
        },
        { status: 400 }
      );
    }

    // 3. Create persistent campaign record with atomic recipients queue
    const initialRecipients = eligibleLeads.map(l => ({
      leadId: l._id || l.id,
      email: l.contact?.email || l.email,
      name: l.contact?.name || l.name || '',
      company: l.company?.name || l.companyName || '',
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      dispatchedAt: null,
      messageSid: null,
      error: null
    }));

    const campaign = await BlastCampaignStore.create({
      name: blastTitle,
      type: 'email',
      createdBy: user._id || user.id,
      templateSubject: blastSubject,
      templateBody: blastContent,
      leadIds: eligibleLeads.map(l => l._id || l.id),
      recipients: initialRecipients,
      status: 'processing',
      stats: {
        total: verifiedLeads.length,
        eligible: eligibleLeads.length,
        sent: 0,
        failed: 0,
        skipped: suppressedCount + missingEmailCount
      }
    });

    let listmonkMeta = null;
    let listmonkSuccess = false;

    // 4. Try synchronizing with Listmonk bulk engine
    try {
      const lmHealth = await checkListmonkHealth();
      if (lmHealth && lmHealth.connected) {
        // Create dedicated Listmonk list for this campaign's exact recipients
        const listName = `Campaign: ${blastTitle} (${campaign._id})`;
        const listId = await getOrCreateList(listName);

        // Sync only the exact eligible leads as subscribers to this specific list
        const syncRes = await syncSubscribersToListmonk(eligibleLeads, listId);

        // Create the Listmonk campaign targeted specifically at this list
        const lmCamp = await createListmonkCampaign({
          name: `${blastTitle} - ${campaign._id}`,
          subject: blastSubject,
          bodyHtml: blastContent,
          listIds: [listId]
        });

        if (lmCamp && lmCamp.campaignId) {
          // Launch the Listmonk campaign (dispatches through Resend SMTP relay)
          await updateListmonkCampaignStatus(lmCamp.campaignId, 'running');
          listmonkMeta = {
            campaignId: lmCamp.campaignId,
            listId,
            subscribersSynced: syncRes.synced
          };
          listmonkSuccess = true;

          await BlastCampaignStore.update(campaign._id, {
            listmonk_campaign_id: lmCamp.campaignId,
            listmonk_list_id: listId
          });
        }
      }
    } catch (lmErr) {
      console.warn('[Listmonk Sync Notice - falling back to direct Resend relay]:', lmErr.message);
    }

    // 5. If Listmonk was not connected or for direct individual personalization, dispatch via verified Resend engine
    let sentCount = 0;
    let failedCount = 0;
    const updatedRecipients = [...initialRecipients];

    for (let i = 0; i < eligibleLeads.length; i++) {
      const lead = eligibleLeads[i];
      const targetEmail = lead.contact?.email || lead.email;
      const firstName = lead.contact?.name?.split(' ')[0] || lead.name?.split(' ')[0] || 'there';
      const company = lead.company?.name || lead.companyName || 'your team';
      const industry = lead.industry || lead.niche || 'business';

      const personalizedSubject = blastSubject
        .replace(/{{firstName}}/g, firstName)
        .replace(/{{company}}/g, company)
        .replace(/{{industry}}/g, industry);

      const personalizedBody = blastContent
        .replace(/{{firstName}}/g, firstName)
        .replace(/{{company}}/g, company)
        .replace(/{{industry}}/g, industry);

      try {
        const sendResult = await sendEmail({
          to: targetEmail,
          subject: personalizedSubject,
          html: `<div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${personalizedBody}</div>`,
          fromName: user.name || '80/20 Outbound',
          fromEmail: user.email || 'outreach@8020acquisition.com'
        });

        if (sendResult.success) {
          sentCount++;
          const targetLeadId = lead._id || lead.id;
          const targetUserId = user._id || user.id;

          updatedRecipients[i].status = 'sent';
          updatedRecipients[i].dispatchedAt = new Date().toISOString();
          updatedRecipients[i].messageSid = sendResult.id || `blast-msg-${Date.now()}`;

          await MessageStore.create({
            userId: targetUserId,
            leadId: targetLeadId,
            messageSid: sendResult.id || `blast-${campaign._id}-${i}`,
            from: `${user.name || 'Sales Representative'} <${user.email || 'outreach@8020acquisition.com'}>`,
            to: targetEmail,
            body: personalizedBody,
            status: 'sent',
            channel: 'email',
            direction: 'outbound'
          });

          await LeadStore.updateStage(targetLeadId, 'CONTACTED', `Blast Campaign: ${blastTitle}`);
          await ActivityLogStore.create({
            leadId: targetLeadId,
            userId: targetUserId,
            action: 'email',
            channel: 'email',
            direction: 'outbound',
            outcome: 'sent',
            notes: `Dispatched in campaign "${blastTitle}"\nSubject: ${personalizedSubject}`,
            messageSid: sendResult.id || ''
          });
        } else {
          failedCount++;
          updatedRecipients[i].status = 'failed';
          updatedRecipients[i].error = sendResult.error || 'Dispatch failed';
        }
      } catch (sendErr) {
        failedCount++;
        updatedRecipients[i].status = 'failed';
        updatedRecipients[i].error = sendErr.message;
      }
    }

    const finalStatus = failedCount === eligibleLeads.length ? 'failed' : 'completed';
    await BlastCampaignStore.update(campaign._id, {
      status: finalStatus,
      recipients: updatedRecipients,
      completedAt: new Date().toISOString(),
      stats: {
        total: verifiedLeads.length,
        eligible: eligibleLeads.length,
        sent: sentCount,
        failed: failedCount,
        skipped: suppressedCount + missingEmailCount
      }
    });

    return NextResponse.json({
      success: true,
      message: `Campaign "${blastTitle}" processed: ${sentCount} sent, ${failedCount} failed, ${suppressedCount + missingEmailCount} skipped.`,
      data: {
        campaignId: campaign._id,
        status: finalStatus,
        sentCount,
        failedCount,
        skippedCount: suppressedCount + missingEmailCount,
        listmonk: listmonkMeta
      }
    });
  } catch (err) {
    console.error('[Manager Blast POST Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Server error occurred during campaign dispatch.' },
      { status: 500 }
    );
  }
}