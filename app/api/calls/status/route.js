import { CallStore } from '@/lib/store';

export async function POST(req) {
  try {
    let body = {};
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        body[key] = value;
      }
    } else {
      body = await req.json();
    }

    const { CallSid, CallStatus, CallDuration, RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus } = body;

    if (RecordingSid && RecordingStatus === 'completed') {
      console.log(`[Twilio Webhook] Recording completed - SID: ${RecordingSid}, Call SID: ${CallSid}`);
      await CallStore.findOneAndUpdate({ callSid: CallSid }, {
        recordingUrl: RecordingUrl,
        recordingSid: RecordingSid,
        recordingDuration: parseInt(RecordingDuration, 10) || 0
      });
    }

    if (CallSid && CallStatus) {
      console.log(`[Twilio Webhook] Call Status update - SID: ${CallSid}, Status: ${CallStatus}, Duration: ${CallDuration}s`);
      const updateData = { status: CallStatus };

      if (CallDuration) {
        updateData.duration = parseInt(CallDuration, 10);
      }

      if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
        updateData.endTime = new Date();
      }

      await CallStore.findOneAndUpdate({ callSid: CallSid }, updateData);
    }

    return new Response('Status received', { status: 200 });
  } catch (err) {
    console.error('[Twilio Status Webhook] Error:', err.message);
    return new Response('Webhook processing error', { status: 500 });
  }
}
