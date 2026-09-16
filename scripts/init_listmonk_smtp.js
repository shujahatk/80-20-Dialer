/**
 * Resend SMTP Bootstrap Script for Listmonk Engine
 * Configures Listmonk default SMTP server settings to use Resend
 */

const LISTMONK_URL = process.env.LISTMONK_URL || 'http://localhost:9001';
const LISTMONK_USER = process.env.LISTMONK_ADMIN_USER;
const LISTMONK_PASS = process.env.LISTMONK_ADMIN_PASS;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY || !LISTMONK_USER || !LISTMONK_PASS) {
  console.warn('⚠️ [Configuration Notice]: RESEND_API_KEY, LISTMONK_ADMIN_USER, and LISTMONK_ADMIN_PASS must be provided via environment variables.');
  process.exit(0);
}

const authHeader = 'Basic ' + Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');

async function configureResendSmtp() {
  console.log('--- Initializing Listmonk SMTP with Resend Delivery Engine ---');
  try {
    const smtpSettings = {
      name: 'Resend SMTP',
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: RESEND_API_KEY,
      auth_protocol: 'login',
      max_connections: 10,
      rate_limit: 100,
      enable_starttls: true,
    };

    const res = await fetch(`${LISTMONK_URL}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        'smtp': [smtpSettings]
      }),
    });

    if (res.ok) {
      console.log('✅ Listmonk SMTP configured to Resend (smtp.resend.com:587).');
    } else {
      const errText = await res.text();
      console.warn('⚠️ Notice initializing Listmonk SMTP:', errText);
    }
  } catch (err) {
    console.error('Error connecting to Listmonk server:', err.message);
  }
}

configureResendSmtp();
