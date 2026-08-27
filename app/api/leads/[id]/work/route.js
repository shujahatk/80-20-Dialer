import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore, ActivityLogStore } from '@/lib/store';
import { triggerCrmWebhook } from '@/lib/crmWebhook';

const AUTO_RETRY_DELAYS = {
  'no-answer': 60 * 60 * 1000,   // 1 hour
  'busy': 30 * 60 * 1000,        // 30 mins
  'voicemail': 2 * 60 * 60 * 1000 // 2 hours
};

export async function POST(req, { params }) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { id: leadId } = await params;
    const body = await req.json();
    const { outcome, notes, duration, callSid, callbackDate, booking } = body;

    if (!outcome) {
      return NextResponse.json(
        { success: false, message: 'Outcome is required.' },
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

    // Verify lock ownership
    if (
      lead.currentlyBeingWorked &&
      lead.currentlyBeingWorkedBy &&
      lead.currentlyBeingWorkedBy.toString() !== user._id.toString()
    ) {
      return NextResponse.json(
        { success: false, message: 'Lock error: This lead is being worked by another agent.' },
        { status: 409 }
      );
    }

    const previousStatus = lead.status;
    const updateData = {
      status: outcome,
      lastAction: notes || `Call - ${outcome}`,
      lastActionDate: new Date(),
      hasUnansweredReply: false,
      // Release lock
      currentlyBeingWorked: false,
      currentlyBeingWorkedBy: null,
      currentlyBeingWorkedAt: null
    };

    switch (outcome) {
      case 'callback':
        if (!callbackDate) {
          return NextResponse.json(
            { success: false, message: 'callbackDate is required for callbacks.' },
            { status: 400 }
          );
        }
        updateData.callbackDate = new Date(callbackDate);
        updateData.callbackNote = notes || '';
        updateData.nextAction = 'callback';
        break;

      case 'no-answer':
      case 'busy':
      case 'voicemail':
        updateData.nextAction = 'retry';
        updateData.callbackDate = new Date(Date.now() + (AUTO_RETRY_DELAYS[outcome] || 60 * 60 * 1000));
        updateData.callbackNote = `Auto-retry scheduled: ${outcome}`;
        break;

      case 'send-info':
        updateData.nextAction = 'send-email';
        break;

      case 'interested':
        updateData.nextAction = 'follow-up';
        break;

      case 'meeting-booked':
        updateData.coldOutreachStopped = true;
        updateData.nextAction = 'none';
        updateData['emailSequence.status'] = 'stopped';
        updateData['emailSequence.stopReason'] = 'meeting-booked';
        
        // Add booking details
        if (booking) {
          updateData.booking = {
            booked: true,
            meetingDate: booking.meetingDate ? new Date(booking.meetingDate) : new Date(),
            meetingTimezone: booking.meetingTimezone || 'UTC',
            closer: booking.closer || user.name,
            meetingLink: booking.meetingLink || ''
          };
        } else {
          updateData.booking = {
            booked: true,
            meetingDate: new Date(),
            meetingTimezone: 'UTC',
            closer: user.name,
            meetingLink: ''
          };
        }
        break;

      case 'not-interested':
      case 'wrong-number':
      case 'dnc':
      case 'opted-out':
        updateData.coldOutreachStopped = true;
        updateData.nextAction = 'none';
        updateData['emailSequence.status'] = 'stopped';
        updateData['emailSequence.stopReason'] = outcome;
        
        if (outcome === 'dnc' || outcome === 'opted-out') {
          updateData.suppression = { phone: true, email: true, sms: true, whatsapp: true };
        }
        if (outcome === 'wrong-number') {
          updateData.suppression = { ...(lead.suppression || {}), phone: true };
        }
        break;

      default:
        updateData.nextAction = 'call';
    }

    const updatedLead = await LeadStore.update(leadId, updateData);

    // Save call timeline logs
    const log = await ActivityLogStore.create({
      leadId,
      userId: user._id,
      action: 'call',
      channel: 'phone',
      direction: 'outbound',
      outcome,
      previousStatus,
      newStatus: outcome,
      notes: notes || '',
      duration: duration || 0,
      callSid: callSid || ''
    });

    // If booked, trigger CRM Webhook in the background
    if (outcome === 'meeting-booked') {
      const history = await ActivityLogStore.findByLead(leadId);
      triggerCrmWebhook(updatedLead, history);
    }

    return NextResponse.json({
      success: true,
      message: 'Call outcome successfully logged.',
      data: updatedLead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
