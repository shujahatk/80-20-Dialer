// Blast SMS sender — stubbed for development.
// TODO: Wire up Twilio once account is verified and credentials are added to .env
// 
// To enable real SMS: install twilio, add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env,
// then replace the mock send function below with actual Twilio .create() call.
//
// This function accepts an array of phone numbers and a body (which may contain
// merge tags {{firstName}} {{company}} that should be personalized per lead).
// It returns { success: true/false, results: [{phone, status, error} ...] }.
//
export async function sendBlastSms(phoneNumbers, body, leadIds) {
  const results = [];

  for (const phone of phoneNumbers) {
    // Simple per-lead placeholder replacement
    let personalizedBody = body;
    // Note: real implementation would pull lead data for merge tags
    // For now just pass through; frontend can personalize before calling

    // Mock "send" — simulate random success/failure for demo
    const success = Math.random() > 0.1; // 90% success mock rate
    const status = success ? 'sent' : 'failed';
    const error = success ? '' : 'Mock Twilio error: simulated failure';

    results.push({ phone, status, error });

    // TODO: Replace with actual Twilio client call:
    // const message = await twilioClient.messages.create({
    //   body: personalizedBody,
    //   from: process.env.TWILIO_FROM_NUMBER,
    //   to: phone,
    // });
  }

  const totalSent = results.filter(r => r.status === 'sent').length;
  const totalFailed = results.filter(r => r.status === 'failed').length;

  return {
    success: totalFailed === 0,
    total: phoneNumbers.length,
    sent: totalSent,
    failed: totalFailed,
    results,
  };
}