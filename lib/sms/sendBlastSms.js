import twilio from 'twilio';
export async function sendBlastSms({ to, body }) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = process.env;
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from || !to || !body) {
    const error = new Error('Twilio configuration, SMS recipient, and body are required.');
    error.definitive = true;
    throw error;
  }
  try {
    const message = await twilio(sid, token, { timeout: 30000 }).messages.create({ to, from, body });
    return { success: true, sid: message.sid };
  } catch (error) {
    error.definitive = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    throw error;
  }
}
