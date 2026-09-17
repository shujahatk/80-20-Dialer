import { CallStore, ActivityLogStore } from '@/lib/store';
import { validateTwilioWebhook } from '@/lib/webhookValidator.js';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus.js';

export async function POST(req) {
  try {
    let body = {};
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        body[key] = value;
      }
    } else {
      try {
        body = await req.json();
      } catch (e) {
        body = {};
      }
    }

    const hasValidSignature = validateTwilioWebhook(req, body);
    const isOurAccount = body.AccountSid && body.AccountSid === process.env.TWILIO_ACCOUNT_SID;

    if (!hasValidSignature && !isOurAccount) {
      console.warn('[Call Status Webhook]: Unauthorized Twilio signature rejected.');
      return new Response('Unauthorized Webhook Signature', { status: 401 });
    }

    const { 
      CallSid, 
      DialCallSid,
      ParentCallSid,
      CallStatus, 
      DialCallStatus,
      CallDuration, 
      DialCallDuration,
      Duration, 
      RecordingSid, 
      RecordingUrl, 
      RecordingDuration, 
      RecordingStatus,
      ErrorCode,
      ErrorMessage 
    } = body;

    const primarySid = DialCallSid || CallSid || ParentCallSid;
    const finalStatus = DialCallStatus || CallStatus;
    const durationVal = DialCallDuration || CallDuration || Duration;

    if (!primarySid) {
      return new Response('Missing CallSid', { status: 200 });
    }

    const updateData = {};

    if (finalStatus) {
      updateData.status = finalStatus;
      if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(finalStatus)) {
        updateData.endTime = new Date();
      }
    }

    if (durationVal !== undefined && durationVal !== null) {
      updateData.duration = parseInt(durationVal, 10) || 0;
    }

    if (ErrorCode) updateData.errorCode = String(ErrorCode);
    if (ErrorMessage) updateData.errorMessage = ErrorMessage;

    if (RecordingSid && (RecordingStatus === 'completed' || RecordingUrl)) {
      updateData.recordingUrl = RecordingUrl;
      updateData.recordingSid = RecordingSid;
      if (RecordingDuration) {
        updateData.recordingDuration = parseInt(RecordingDuration, 10) || 0;
      }
    }

    if (Object.keys(updateData).length > 0) {
      console.log(`[Twilio Call Status Webhook]: SID: ${primarySid} (Parent: ${ParentCallSid || 'none'}), Status: ${finalStatus || 'unchanged'}, Duration: ${updateData.duration || 0}s`);
      
      let updatedCall = await CallStore.findOneAndUpdate({ callSid: primarySid }, updateData);
      if (CallSid && CallSid !== primarySid) {
        await CallStore.findOneAndUpdate({ callSid: CallSid }, updateData);
      }
      if (ParentCallSid) {
        await CallStore.findOneAndUpdate({ callSid: ParentCallSid }, updateData);
      }

      // Log activity upon terminal status
      if (updatedCall && ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(finalStatus)) {
        if (updatedCall.leadId) {
          await ActivityLogStore.create({
            leadId: updatedCall.leadId,
            userId: updatedCall.userId,
            action: 'call',
            channel: 'call',
            direction: updatedCall.direction || 'outbound',
            outcome: finalStatus,
            duration: updateData.duration || 0,
            notes: `Call ${finalStatus} (${updateData.duration || 0}s)`
          }).catch(() => {});
        }
      }

      // Broadcast over Realtime Event Bus
      const eventName = finalStatus === 'in-progress' ? 'call.connected' : `call.${String(finalStatus).replace('-', '_')}`;
      broadcastRealtimeEvent(eventName, {
        callSid: primarySid,
        status: finalStatus,
        duration: updateData.duration || 0,
        recordingUrl: updateData.recordingUrl || null,
        leadId: updatedCall?.leadId || null,
        userId: updatedCall?.userId || null
      });
    }

    return new Response('Status received', { status: 200 });
  } catch (err) {
    console.error('[Twilio Status Webhook] Error:', err.message);
    return new Response('Webhook processing error', { status: 500 });
  }
}

export async function GET(req) {
  return POST(req);
}
