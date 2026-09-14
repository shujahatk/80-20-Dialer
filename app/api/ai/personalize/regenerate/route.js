import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard';
import { LeadStore, AiEmailGenerationStore, AiUsageStore } from '@/lib/store';
import { regeneratePersonalizedEmail } from '@/lib/ai/anthropic';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const {
      draftId,
      leadId,
      customInstruction = '',
      goal = 'Cold outreach',
      tone = 'Professional',
      length = 'Short',
      generateSubject = true,
      offer = 'Automated outbound sales dialer and email pipeline to accelerate qualified demo bookings'
    } = body;

    let draft = null;
    let targetLeadId = leadId;

    if (draftId) {
      draft = await AiEmailGenerationStore.findById(draftId);
      if (draft) targetLeadId = draft.leadId;
    }

    if (!targetLeadId) {
      return NextResponse.json(
        { success: false, message: 'leadId or draftId is required for regeneration.' },
        { status: 400 }
      );
    }

    const lead = await LeadStore.findById(targetLeadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Role & IDOR checks
    const { assertLeadAccess, assertDraftAccess } = await import('@/lib/middleware/authGuard.js');
    if (!assertLeadAccess(user, lead)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to personalize this lead.' },
        { status: 403 }
      );
    }

    if (draft && !assertDraftAccess(user, draft)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You do not have permission to regenerate this draft.' },
        { status: 403 }
      );
    }

    // Call Claude AI Regeneration
    const aiResult = await regeneratePersonalizedEmail({
      lead,
      currentDraft: draft || {},
      customInstruction,
      goal,
      tone,
      length,
      generateSubject,
      offer,
      sender: {
        name: user.name || 'Sales Representative',
        company: '80/20 Acquisition'
      }
    });

    if (!aiResult.success) {
      // Preserve previous version on failure
      await AiUsageStore.logUsage({
        userId: user._id || user.id,
        campaignId: draft?.campaignId || null,
        leadId: targetLeadId,
        model: aiResult.model,
        inputTokens: 0,
        outputTokens: 0,
        status: 'failed'
      });

      return NextResponse.json(
        { success: false, message: aiResult.error || 'Failed to regenerate email draft.', previousDraft: draft },
        { status: 502 }
      );
    }

    // Log Token Usage
    await AiUsageStore.logUsage({
      userId: user._id || user.id,
      campaignId: draft?.campaignId || null,
      leadId: targetLeadId,
      model: aiResult.model,
      inputTokens: aiResult.tokens?.input || 0,
      outputTokens: aiResult.tokens?.output || 0,
      status: 'success'
    });

    // Update Draft Record
    let updatedDraft;
    if (draft) {
      updatedDraft = await AiEmailGenerationStore.update(draft._id || draft.id, {
        subject: aiResult.subject || draft.subject,
        body: aiResult.body,
        status: 'generated',
        customInstruction,
        tokens: aiResult.tokens,
        error: null
      });
    } else {
      updatedDraft = await AiEmailGenerationStore.create({
        userId: user._id || user.id,
        leadId: targetLeadId,
        subject: aiResult.subject,
        body: aiResult.body,
        status: 'generated',
        customInstruction,
        tokens: aiResult.tokens
      });
    }

    return NextResponse.json({
      success: true,
      draft: {
        ...updatedDraft,
        lead: {
          _id: lead._id || lead.id,
          name: lead.name || lead.contact?.name,
          company: typeof lead.company === 'string' ? lead.company : lead.company?.name,
          email: lead.email || lead.contact?.email
        }
      }
    });
  } catch (err) {
    console.error('[AI Regenerate Route Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error during regeneration.' },
      { status: 500 }
    );
  }
}
