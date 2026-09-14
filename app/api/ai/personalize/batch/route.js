import { NextResponse } from 'next/server.js';
import { requireAuth } from '../../../../../lib/middleware/authGuard.js';
import { LeadStore, AiEmailGenerationStore, AiUsageStore } from '../../../../../lib/store.js';
import { generatePersonalizedEmail } from '../../../../../lib/ai/anthropic.js';




export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const {
      leadIds = [],
      goal = 'Cold outreach',
      tone = 'Professional',
      length = 'Short',
      instructions = '',
      generateSubject = true,
      offer = 'Automated outbound sales dialer and email pipeline to accelerate qualified demo bookings',
      campaignId = `camp_${Date.now()}`
    } = body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'At least one lead must be selected for personalization.' },
        { status: 400 }
      );
    }

    const MAX_AI_BATCH_SIZE = 50;
    if (leadIds.length > MAX_AI_BATCH_SIZE) {
      return NextResponse.json(
        {
          success: false,
          code: 'BATCH_LIMIT_EXCEEDED',
          message: `Maximum ${MAX_AI_BATCH_SIZE} leads per batch personalization job to protect API quotas and rate limits.`
        },
        { status: 400 }
      );
    }


    // Role Authorization: Salespeople can only generate for leads assigned to them or unassigned
    const isManager = ['admin', 'owner', 'manager'].includes(user.role);
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    // Process leads in parallel chunks of 5
    const CHUNK_SIZE = 5;
    for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
      const chunk = leadIds.slice(i, i + CHUNK_SIZE);
      const chunkPromises = chunk.map(async (leadId) => {
        try {
          const lead = await LeadStore.findById(leadId);
          if (!lead) {
            return {
              leadId,
              status: 'generation_failed',
              error: 'Lead not found.'
            };
          }

          // Authorization Check
          if (!isManager && lead.assignedTo && String(lead.assignedTo) !== String(user._id) && String(lead.assigned_to) !== String(user._id)) {
            return {
              leadId,
              status: 'skipped',
              error: 'Unauthorized access to lead.'
            };
          }

          // Call Claude AI Generator
          const aiResult = await generatePersonalizedEmail({
            lead,
            sender: {
              name: user.name || 'Sales Representative',
              company: '80/20 Acquisition'
            },
            offer,
            goal,
            tone,
            length,
            instructions,
            generateSubject
          });

          if (!aiResult.success) {
            failedCount++;
            await AiUsageStore.logUsage({
              userId: user._id || user.id,
              campaignId,
              leadId,
              model: aiResult.model,
              inputTokens: aiResult.tokens?.input || 0,
              outputTokens: aiResult.tokens?.output || 0,
              status: 'failed'
            });

            const fallbackLeadName = typeof lead.name === 'string' ? lead.name : (lead.contact?.name || 'there');
            const fallbackCompName = typeof lead.company === 'string' ? lead.company : (lead.company?.name || 'your team');
            const fallbackBody = `Hi ${fallbackLeadName},\n\nI noticed ${fallbackCompName}'s focus on growth and wanted to reach out directly.\n\nWe provide ${offer.toLowerCase()}, helping sales teams scale qualified demo bookings without adding headcount.\n\nWould you be open to a brief 5-minute conversation this Thursday to explore if this is relevant for ${fallbackCompName}?\n\nBest regards,\n${user.name || 'Sales Representative'}\n80/20 Acquisition`;

            const failedDraft = await AiEmailGenerationStore.create({
              userId: user._id || user.id,
              leadId,
              campaignId,
              subject: `Outreach to ${fallbackCompName}`,
              body: fallbackBody,
              model: aiResult.model || 'claude-3-5-sonnet',
              status: 'generated',
              error: aiResult.error || null,
              goal,
              tone,
              length,
              generationInstruction: instructions
            });

            return {
              ...failedDraft,
              lead: {
                _id: lead._id || lead.id,
                name: lead.name || lead.contact?.name,
                company: typeof lead.company === 'string' ? lead.company : lead.company?.name,
                email: lead.email || lead.contact?.email
              }
            };
          }

          successCount++;
          // Log Token Usage
          await AiUsageStore.logUsage({
            userId: user._id || user.id,
            campaignId,
            leadId,
            model: aiResult.model,
            inputTokens: aiResult.tokens?.input || 0,
            outputTokens: aiResult.tokens?.output || 0,
            status: 'success'
          });

          // Save Draft
          const draft = await AiEmailGenerationStore.create({
            userId: user._id || user.id,
            leadId,
            campaignId,
            subject: aiResult.subject || `Outreach for ${lead.company || 'Growth'}`,
            body: aiResult.body,
            model: aiResult.model,
            status: 'generated',
            goal,
            tone,
            length,
            tokens: aiResult.tokens,
            generationInstruction: instructions
          });

          return {
            ...draft,
            lead: {
              _id: lead._id || lead.id,
              name: lead.name || lead.contact?.name,
              company: typeof lead.company === 'string' ? lead.company : lead.company?.name,
              email: lead.email || lead.contact?.email
            }
          };
        } catch (itemErr) {
          failedCount++;
          return {
            leadId,
            status: 'generation_failed',
            error: itemErr.message
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return NextResponse.json({
      success: true,
      campaignId,
      total: leadIds.length,
      successCount,
      failedCount,
      drafts: results
    });
  } catch (err) {
    console.error('[AI Batch Route Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error during batch personalization.' },
      { status: 500 }
    );
  }
}
