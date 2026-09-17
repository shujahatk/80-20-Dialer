export function prepareEmail({ to, fromEmail, fromName, subject, html, text }) {
  const defaultEmail = process.env.EMAIL_FROM || 'outreach@8020aquisition.com';
  const defaultName = process.env.EMAIL_FROM_NAME || '80/20 Acquisition';
  let candidate = (fromEmail || defaultEmail).trim().toLowerCase();
  if (candidate.includes('@8020acquisition.com')) {
    candidate = candidate.replace('@8020acquisition.com', '@8020aquisition.com');
  }
  const domain = value => value?.split('@')[1]?.trim().toLowerCase();
  const allowed = new Set(['8020aquisition.com', '8020acquisition.com', 'resend.dev', domain(defaultEmail), ...(process.env.EMAIL_ALLOWED_DOMAINS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)]);
  const custom = candidate && allowed.has(domain(candidate));
  const effectiveEmail = custom ? candidate : defaultEmail;
  return { from: `${(fromName || defaultName).replace(/[\r\n<>]/g, '')} <${effectiveEmail}>`,
    to: Array.isArray(to) ? to : [to], reply_to: custom ? effectiveEmail : process.env.REPLY_TO || defaultEmail,
    subject, ...(html ? { html } : {}), ...(text ? { text } : {}) };
}
export async function sendEmail(options) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const error = new Error('RESEND_API_KEY is required; email was not sent.');
    error.definitive = true;
    throw error;
  }
  const payload = options.preparedPayload || prepareEmail(options);
  const idempotencyKey = options.idempotencyKey || options.headers?.['X-Idempotency-Key'];
  
  let response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify(payload)
  });
  let data = await response.json();

  // If custom user address fails verification, retry with verified default outbound identity
  if (!response.ok && data?.message && (data.message.includes('is not verified') || data.message.includes('verify your domain'))) {
    console.warn(`[Resend Notice]: Custom sender not verified. Retrying via outreach@8020aquisition.com...`);
    const fallbackPayload = {
      ...payload,
      from: `80/20 Acquisition <outreach@8020aquisition.com>`
    };
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackPayload)
    });
    data = await response.json();
  }

  if (!response.ok) {
    const error = new Error(data.message || `Resend returned ${response.status}`);
    error.definitive = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
    throw error;
  }
  if (!data.id) throw new Error('Resend returned no message ID; delivery requires reconciliation.');
  return { success: true, id: data.id };
}
