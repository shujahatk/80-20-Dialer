import { NextResponse } from 'next/server';
import { requireAuth, canAccessResource } from '@/lib/middleware/authGuard.js';
import { LeadStore, ActivityLogStore } from '@/lib/store.js';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabase.js';
import { handleStageChangeTrigger } from '@/lib/triggers/stageTriggers.js';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus.js';

const ALLOWED_OUTCOMES = ['no_answer', 'voicemail', 'meeting_booked', 'not_interested'];

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    let { leadId, outcome, notes, disqualificationReason } = body;

    if (!leadId) {
      return NextResponse.json(
        { success: false, message: 'leadId is required.' },
        { status: 400 }
      );
    }

    if (!outcome) {
      return NextResponse.json(
        { success: false, message: 'outcome is required.' },
        { status: 400 }
      );
    }

    // Normalize hyphenated outcome formats
    if (outcome === 'no-answer') outcome = 'no_answer';
    if (outcome === 'meeting-booked') outcome = 'meeting_booked';
    if (outcome === 'not-interested') outcome = 'not_interested';

    if (!ALLOWED_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid outcome: '${outcome}'. Must be one of: ${ALLOWED_OUTCOMES.join(', ')}`
        },
        { status: 400 }
      );
    }

    if (outcome === 'not_interested' && !disqualificationReason) {
      return NextResponse.json(
        {
          success: false,
          message: 'disqualificationReason is required when marking lead as not_interested (e.g. Too Expensive, Bad Contact Info, Competitor Selected, No Budget / Bad Timing, Other).'
        },
        { status: 400 }
      );
    }

    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Permission check
    const leadOwner = lead.assignedTo || lead.assigned_to || lead.userId;
    if (!canAccessResource(user, leadOwner)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden. You cannot log dispositions on this lead.' },
        { status: 403 }
      );
    }

    const now = new Date();
    const oldStage = lead.stage || 'new_lead';
    let newStage = oldStage;
    const currentAttempts = (lead.call_attempts || 0) + 1;

    const updateFields = {
      lastAction: notes || `Call Disposition: ${outcome}`,
      lastActionDate: now,
      call_attempts: currentAttempts,
      // Release lock on disposition
      locked_by: null,
      locked_at: null,
      currentlyBeingWorked: false,
      currentlyBeingWorkedBy: null,
      currentlyBeingWorkedAt: null
    };

    switch (outcome) {
      case 'no_answer':
        updateFields.status = 'no-answer';
        if (oldStage === 'new_lead') newStage = 'call_1';
        else if (oldStage === 'call_1') newStage = 'call_2';
        else if (oldStage === 'call_2') newStage = 'call_3';
        else if (oldStage === 'call_3') newStage = 'call_4';
        else if (oldStage === 'contacted') newStage = 'call_1';
        break;

      case 'voicemail':
        updateFields.status = 'voicemail';
        if (oldStage === 'new_lead') newStage = 'call_1';
        else if (oldStage === 'call_1') newStage = 'call_2';
        else if (oldStage === 'call_2') newStage = 'call_3';
        else if (oldStage === 'call_3') newStage = 'call_4';
        break;

      case 'meeting_booked':
        newStage = 'appointment_booked';
        updateFields.status = 'interested';
        updateFields.coldOutreachStopped = true;
        updateFields.booking = {
          booked: true,
          meetingDate: now,
          closer: user.name || 'Sales Rep'
        };
        break;

      case 'not_interested':
        newStage = 'lost';
        updateFields.status = 'not_interested';
        updateFields.coldOutreachStopped = true;
        if (disqualificationReason) {
          updateFields.disqualification_reason = disqualificationReason;
        }
        break;
    }

    updateFields.stage = newStage;
    updateFields.stage_updated_at = now.toISOString();
    updateFields.last_activity_note = notes || `Disposition: ${outcome}`;

    // Update lead record
    const updatedLead = await LeadStore.update(leadId, updateFields);

    // Save audit record to Supabase call_dispositions table if configured
    const uId = String(user._id || user.id);
    const dispositionPayload = {
      _id: 'disp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      lead_id: leadId,
      user_id: uId,
      outcome,
      notes: notes || '',
      disqualification_reason: disqualificationReason || null,
      created_at: now.toISOString()
    };

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        await client.from('calls').insert([{
          _id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          user_id: uId,
          lead_id: leadId,
          status: outcome,
          notes: notes || '',
          created_at: now.toISOString()
        }]);
      } catch (dbErr) {
        console.warn('[Supabase calls audit insert notice]:', dbErr.message);
      }
    }

    // Log Activity Timeline
    await ActivityLogStore.create({
      leadId,
      userId: uId,
      action: 'call',
      channel: 'phone',
      direction: 'outbound',
      outcome,
      previousStatus: lead.status,
      newStatus: updateFields.status,
      notes: notes || `Call Disposition: ${outcome}`,
      created_at: now
    }).catch(() => {});

    // Execute Automated Stage Triggers (Listmonk sync/unsubscribe/blocklist)
    try {
      handleStageChangeTrigger(updatedLead, oldStage, newStage).catch(console.error);
    } catch (e) {}

    // Broadcast real-time events
    try {
      await broadcastRealtimeEvent('lead.disposition_changed', {
        leadId,
        outcome,
        stage: newStage,
        previousStage: oldStage,
        notes: notes || '',
        user: { id: uId, name: user.name || user.email },
        lead: updatedLead
      });

      if (newStage !== oldStage) {
        await broadcastRealtimeEvent('lead.stage_changed', {
          leadId,
          stage: newStage,
          previousStage: oldStage,
          lead: updatedLead,
          updatedBy: user.name || user.email || 'User'
        });
      }

      if (outcome === 'meeting_booked') {
        await broadcastRealtimeEvent('meeting.booked', {
          leadId,
          user: { id: uId, name: user.name || user.email },
          lead: updatedLead,
          date: now.toISOString()
        });
      }
    } catch (rtErr) {
      console.warn('[Realtime broadcast error]:', rtErr.message);
    }

    return NextResponse.json({
      success: true,
      message: `Disposition '${outcome}' recorded successfully. Stage advanced to '${newStage}'.`,
      data: {
        lead: updatedLead,
        stage: newStage,
        call_attempts: currentAttempts,
        disposition: dispositionPayload
      }
    });
  } catch (err) {
    console.error('[Call Disposition API Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error recording disposition.' },
      { status: 500 }
    );
  }
}
