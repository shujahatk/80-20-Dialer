export async function sendEmail({ to, fromEmail, fromName, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  
  if (!apiKey) {
    console.log(`[Resend MOCK] Sending email:
      To: ${to}
      From: ${fromName ? `"${fromName}" ` : ''}<${fromEmail}>
      Subject: ${subject}
      Body (HTML): ${html.substring(0, 200)}...
    `);
    return { success: true, mock: true };
  }

  try {
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: subject,
        html: html,
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
