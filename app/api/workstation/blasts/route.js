import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource } from '@/lib/middleware/authGuard';
import { connectDB } from '@/lib/db';
import BlastCampaign from '@/models/BlastCampaign';
import Lead from '@/models/Lead';
import SendingInbox from '@/models/SendingInbox';
import { logAuditEvent } from '@/lib/auditLogger';

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

    if (leadIds.length > 5000) {
      return NextResponse.json(
        { success: false, error: { code: 'LIMIT_EXCEEDED', message: 'Campaign cannot exceed 5,000 leads per batch.' } },
        { status: 400 }
      );
    }

    // Verify Lead Ownership: Salespeople can ONLY send blasts to leads assigned to them or unassigned
    const isManager = ['owner', 'admin', 'manager'].includes(user.role);
    const validLeads = await Lead.find({ _id: { $in: leadIds } }).select('_id assignedTo contact suppression').lean();

    const authorizedLeadIds = [];
    let suppressedCount = 0;

    for (const lead of validLeads) {
      // Check ownership
      if (!isManager && lead.assignedTo && lead.assignedTo.toString() !== user._id.toString()) {
        continue; // Exclude lead not assigned to salesperson
      }

      // Check suppression
      const isSuppressed = type === 'email' ? lead.suppression?.email : lead.suppression?.sms;
      if (isSuppressed) {
        suppressedCount++;
        continue;
      }

      authorizedLeadIds.push(lead._id);
    }

    if (authorizedLeadIds.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NO_ELIGIBLE_LEADS', message: 'No eligible or authorized leads found for this campaign.' } },
        { status: 400 }
      );
    }

    // Verify Inbox Authorization
    let inboxObjId = 'default';
    if (sendingInboxId !== 'default') {
      const inbox = await SendingInbox.findById(sendingInboxId).lean();
      if (!inbox || inbox.status !== 'active') {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_INBOX', message: 'Selected sending inbox is inactive or invalid.' } },
          { status: 400 }
        );
      }
      inboxObjId = inbox._id.toString();
    }

    const initialStatus = ['queued', 'draft'].includes(status) ? status : 'queued';

    const campaign = await BlastCampaign.create({
      name: name.trim(),
      description: description.trim(),
      type,
      createdBy: user._id,
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
