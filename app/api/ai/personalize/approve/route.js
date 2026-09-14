import { NextResponse } from 'next/server';
import { requireAuth, assertDraftAccess, assertLeadAccess } from '@/lib/middleware/authGuard';
import { LeadStore, MessageStore, ActivityLogStore, AiEmailGenerationStore } from '@/lib/store';
import { sendEmail } from '@/lib/emailService';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { action = 'approve', draftId, drafts = [], subject, emailBody } = body;

    // 1. Single Draft Update / Edit / Approve
    if (draftId) {
      const existingDraft = await AiEmailGenerationStore.findById(draftId);
      if (!existingDraft) {
        return NextResponse.json({ success: false, message: 'Draft not found.' }, { status: 404 });
      }

      if (!assertDraftAccess(user, existingDraft)) {
        return NextResponse.json(
          { success: false, message: 'Forbidden. You do not have permission to modify this draft.' },
          { status: 403 }
        );
      }

      if (action === 'update') {
        const updated = await AiEmailGenerationStore.update(draftId, {
          ...(subject !== undefined ? { subject } : {}),
          ...(emailBody !== undefined ? { body: emailBody } : {})
        });
        return NextResponse.json({ success: true, draft: updated });
      }

      if (action === 'skip') {
        const updated = await AiEmailGenerationStore.updateStatus(draftId, 'skipped');
        return NextResponse.json({ success: true, draft: updated });
      }

      if (action === 'approve_single') {
        const updated = await AiEmailGenerationStore.updateStatus(draftId, 'approved');
        return NextResponse.json({ success: true, draft: updated });
      }
    }

    // 2. Dispatch Approved Emails into Sending Pipeline via Resend
    if (action === 'dispatch_approved') {
      const approvedDrafts = drafts.filter(d => d.status === 'approved' || d.status === 'generated');
      if (approvedDrafts.length === 0) {
        return NextResponse.json(
          { success: false, message: 'No approved drafts selected for dispatch.' },
          { status: 400 }
        );
      }

      const dispatchResults = [];
      let sentCount = 0;
      let failedCount = 0;

      for (const draft of approvedDrafts) {
        try {
          // IDOR draft ownership verification
          if (!assertDraftAccess(user, draft)) {
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: 'Unauthorized draft access' });
            failedCount++;
            continue;
          }

          const lead = await LeadStore.findById(draft.leadId);
          if (!lead) {
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: 'Lead not found' });
            failedCount++;
            continue;
          }

          // IDOR lead ownership verification
          if (!assertLeadAccess(user, lead)) {
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: 'Unauthorized lead access' });
            failedCount++;
            continue;
          }

          // Suppression & DNC check
          if (lead.suppression?.email) {
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'skipped', error: 'Lead opted out of email' });
            continue;
          }

          const targetEmail = lead.email || lead.contact?.email;
          if (!targetEmail || !targetEmail.includes('@')) {
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: 'Lead has invalid email' });
            failedCount++;
            continue;
          }

          // Dispatch through verified Resend outbound engine
          const resendResult = await sendEmail({
            to: targetEmail,
            subject: draft.subject || 'Outbound Collaboration',
            html: `<div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${draft.body}</div>`,
            fromName: user.name || 'Sales Representative',
            fromEmail: user.email || 'outreach@8020acquisition.com'
          });

          if (resendResult.success) {
            sentCount++;
            const targetLeadId = lead._id || lead.id;
            const targetUserId = user._id || user.id;

            // Log Message Record
            await MessageStore.create({
              userId: targetUserId,
              leadId: targetLeadId,
              messageSid: resendResult.id || `ai-email-${Date.now()}`,
              from: `${user.name || 'Sales Team'} <${user.email || 'outreach@8020acquisition.com'}>`,
              to: targetEmail,
              body: draft.body,
              status: 'sent',
              channel: 'email',
              direction: 'outbound'
            });

            // Update Lead State Machine & Activity Log
            await LeadStore.updateStage(targetLeadId, 'CONTACTED', `AI Email: ${(draft.subject || '').substring(0, 80)}`);
            await ActivityLogStore.create({
              leadId: targetLeadId,
              userId: targetUserId,
              action: 'email',
              channel: 'email',
              direction: 'outbound',
              outcome: 'sent',
              notes: `AI Generated Email Dispatched\nSubject: ${draft.subject}\n\n${draft.body.substring(0, 180)}...`,
              messageSid: resendResult.id || ''
            });

            // Mark draft as approved & dispatched
            if (draft._id || draft.id) {
              await AiEmailGenerationStore.update(draft._id || draft.id, { status: 'approved' });
            }

            dispatchResults.push({ draftId: draft._id || draft.id, status: 'sent', messageSid: resendResult.id });
          } else {
            failedCount++;
            dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: resendResult.error });
          }
        } catch (err) {
          failedCount++;
          dispatchResults.push({ draftId: draft._id || draft.id, status: 'failed', error: err.message });
        }
      }

      return NextResponse.json({
        success: true,
        sentCount,
        failedCount,
        results: dispatchResults
      });
    }

    return NextResponse.json(
      { success: false, message: 'Invalid action specified.' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[AI Approve POST Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
