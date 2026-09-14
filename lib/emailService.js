export async function sendEmail({ to, fromEmail, fromName, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const defaultFromEmail = process.env.EMAIL_FROM || 'outreach@8020acquisition.com';
  const defaultFromName = process.env.EMAIL_FROM_NAME || '80/20 Acquisition';
  const configuredReplyTo = process.env.REPLY_TO || 'replies@8020acquisition.com';

  // Allowed official domains for individual salesperson dispatch
  const allowedDomains = ['8020acquisition.com', '8020aquisition.com', 'resend.dev'];
  const fromEmailDomain = fromEmail && fromEmail.includes('@') ? fromEmail.split('@')[1].toLowerCase() : '';
  const isCustomVerified = fromEmail && (
    allowedDomains.some(d => fromEmailDomain === d || fromEmailDomain.endsWith(`.${d}`)) ||
    (defaultFromEmail.includes('@') && fromEmailDomain === defaultFromEmail.split('@')[1].toLowerCase())
  );

  const effectiveFromEmail = isCustomVerified ? fromEmail.trim().toLowerCase() : defaultFromEmail;
  const effectiveFromName = fromName ? fromName.trim() : defaultFromName;
  const replyTo = isCustomVerified ? fromEmail.trim().toLowerCase() : (fromEmail && fromEmail.includes('@') ? fromEmail : configuredReplyTo);

  if (!apiKey) {
    console.log(`[Resend MOCK] Sending email:
      To: ${to}
      From: "${effectiveFromName}" <${effectiveFromEmail}>
      Reply-To: ${replyTo}
      Subject: ${subject}
      Body (HTML): ${html ? html.substring(0, 200) : text?.substring(0, 200)}...
    `);
    return { success: true, mock: true, id: `mock-${Date.now()}` };
  }

  try {
    const from = `${effectiveFromName} <${effectiveFromEmail}>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: Array.isArray(to) ? to : [to],
        reply_to: replyTo,
        subject: subject,
        html: html || undefined,
        text: text || undefined
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Resend API returned status ${response.status}`);
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Resend] Send error:', err.message);
    throw err;
  }
}
