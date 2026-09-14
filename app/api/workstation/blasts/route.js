import { NextResponse } from 'next/server.js';
import { requireAuth, canAccessResource } from '../../../../lib/middleware/authGuard.js';
import { connectDB } from '../../../../lib/db.js';
import BlastCampaign from '../../../../models/BlastCampaign.js';
import Lead from '../../../../models/Lead.js';
import SendingInbox from '../../../../models/SendingInbox.js';
import { logAuditEvent } from '../../../../lib/auditLogger.js';
import { LeadStore, BlastCampaignStore } from '../../../../lib/store.js';
import { SuppressionStore } from '../../../../lib/suppression/suppressionStore.js';





export async function GET(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    await connectDB();

    // Salespeople see campaigns they created; Managers/Admins/Owners see all
    const isManager = ['owner', 'admin', 'manager'].includes(user.role);
    const query = isManager ? {} : { createdBy: user._id };

    let campaigns = [];
    try {
      campaigns = await BlastCampaign.find(query).sort({ createdAt: -1 }).lean();
    } catch (e) {
      console.warn('[BlastCampaign] Query warning:', e.message);
    }

    return NextResponse.json({
      success: true,
      data: campaigns || []
    });
  } catch (err) {
    return NextResponse.json({
      success: true,
      data: []
    });
  }
}

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    await connectDB();
    const body = await req.json();

    const {
      name,
      description = '',
      type = 'email',
      templateSubject,
      templateBody,
      tone = 'professional',
      salesObjective = '',
      useAiPersonalization = true,
      leadIds = [],
      sendingInboxId = 'default',
      status = 'queued'
    } = body;

    // Basic Validation
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Campaign name is required.' } },
        { status: 400 }
      );
    }

    if (type === 'email' && (!templateSubject?.trim() || !templateBody?.trim())) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Email subject and body template are required.' } },
        { status: 400 }
      );
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one recipient lead must be selected.' } },
        { status: 400 }
      );
    }

    const isManager = ['owner', 'admin', 'manager'].includes(user.role);

    // Salesperson batch limits vs manager batch limits
    const maxBatchLimit = isManager ? 5000 : 500;
    if (leadIds.length > maxBatchLimit) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `Campaign cannot exceed ${maxBatchLimit} leads for your role (${user.role}).`
          }
        },
        { status: 400 }
      );
    }

    // Role-based Campaign Permissions:
    // Salespeople can create draft campaigns or send campaigns targeting only leads assigned directly to them.
    // Managers/Admins can send teamwide blasts.
    const authorizedLeadIds = [];
    let suppressedCount = 0;
    const userIdStr = String(user._id || user.id);

    for (const id of leadIds) {
      const lead = await LeadStore.findById(id);
      if (!lead) continue;

      const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;

      // Ownership Scope Check: Salespeople cannot blast leads assigned to others or unassigned pool
      if (!isManager) {
        if (!leadOwner || String(leadOwner) !== userIdStr) {
          continue; // Block unassigned or other rep's leads from salesperson blast
        }
      }

      // Check permanent suppression table
      const email = lead.contact?.email || lead.email;
      const phone = lead.contact?.phone || lead.phone;
      const suppCheck = await SuppressionStore.isSuppressed({
        email,
        phone,
        channel: type === 'email' ? 'email' : 'sms'
      });

      const leadSuppressed = suppCheck.suppressed || (type === 'email' ? lead.suppression?.email : lead.suppression?.sms);
      if (leadSuppressed) {
        suppressedCount++;
        continue;
      }

      authorizedLeadIds.push(lead._id || lead.id);
    }

    if (authorizedLeadIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_ELIGIBLE_LEADS',
            message: 'No eligible or authorized leads found for this campaign. Verify lead assignment and suppression status.'
          }
        },
        { status: 400 }
      );
    }

    // Verify Inbox Authorization
    let inboxObjId = 'default';
    if (sendingInboxId !== 'default') {
      try {
        const inbox = await SendingInbox.findById(sendingInboxId).lean();
        if (!inbox || inbox.status !== 'active') {
          return NextResponse.json(
            { success: false, error: { code: 'INVALID_INBOX', message: 'Selected sending inbox is inactive or invalid.' } },
            { status: 400 }
          );
        }
        inboxObjId = inbox._id.toString();
      } catch (e) {}
    }

    const initialStatus = ['queued', 'draft'].includes(status) ? status : 'queued';

    const campaign = await BlastCampaignStore.create({
      name: name.trim(),
      description: description.trim(),
      type,
      createdBy: user._id || user.id,
      sendingInboxId: inboxObjId,
      templateSubject: type === 'email' ? templateSubject.trim() : '',
      templateBody: templateBody.trim(),
      tone,
      salesObjective,
      useAiPersonalization: Boolean(useAiPersonalization),
      leadIds: authorizedLeadIds,
      status: initialStatus,
      stats: {
        total: authorizedLeadIds.length,
        sent: 0,
        failed: 0,
        skipped: suppressedCount
      }
    });


    await logAuditEvent({
      userId: user._id,
      action: 'note',
      notes: `Created Blast Campaign '${campaign.name}' with ${authorizedLeadIds.length} eligible recipients (${suppressedCount} suppressed).`
    });

    return NextResponse.json({
      success: true,
      data: campaign
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to create campaign.' } },
      { status: 500 }
    );
  }
}
