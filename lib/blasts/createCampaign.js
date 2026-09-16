import { BlastCampaignStore, LeadStore, SendingInboxStore } from '../store.js';
import { SuppressionStore } from '../suppression/suppressionStore.js';
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
export async function createCampaign(user, body) {
  const name = body.name || body.title;
  const type = body.type || 'email';
  const subject = body.templateSubject || body.subject || '';
  const content = body.templateBody || body.htmlContent || '';
  const inboxId = body.sendingInboxId || 'default';
  if (!['email', 'sms'].includes(type)) invalid('Campaign type must be email or sms.');
  if (typeof name !== 'string' || !name.trim()) invalid('Campaign name is required.');
  if (typeof content !== 'string' || !content.trim() || (type === 'email' && (typeof subject !== 'string' || !subject.trim()))) invalid('Campaign subject and body are required.');
  if (type === 'email' && !process.env.RESEND_API_KEY) invalid('Email sending is not configured. Set RESEND_API_KEY.');
  if (type === 'sms' && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER))) invalid('SMS sending is not configured.');
  const manager = ['owner', 'manager', 'admin'].includes(user.role);
  if (!manager && user.role !== 'salesperson') { const error = new Error('Your role cannot create blast campaigns.'); error.status = 403; throw error; }
  if (!Array.isArray(body.leadIds) || !body.leadIds.length || body.leadIds.some(id => typeof id !== 'string')) invalid('Select recipient lead IDs.');
  const ids = [...new Set(body.leadIds)];
  if (ids.length > (manager ? 5000 : 500)) invalid('Campaign recipient limit exceeded.');
  if (inboxId !== 'default') {
    const inbox = await SendingInboxStore.findInboxById(inboxId);
    if (!inbox || inbox.active === false) invalid('Selected sending inbox is unavailable.');
    if (!manager && String(inbox.createdBy || inbox.userId || '') !== String(user.id) && !(inbox.assignedUsers || []).map(String).includes(String(user.id))) invalid('Selected sending inbox is not authorized for you.');
  }
  const leadIds = [];
  for (const id of ids) {
    const lead = await LeadStore.findById(id);
    if (!lead || (!manager && String(lead.assigned_to || '') !== String(user.id))) continue;
    const email = lead.contact?.email || lead.email;
    const phone = lead.contact?.phone || lead.phone;
    if ((type === 'email' && !email?.includes('@')) || (type === 'sms' && !phone)) continue;
    const check = await SuppressionStore.isSuppressed({ email, phone, channel: type });
    if (check.suppressed || lead.suppression?.[type] || ['do_not_contact', 'opted-out'].includes(String(lead.status).toLowerCase())) continue;
    leadIds.push(lead.id);
  }
  if (!leadIds.length) invalid('No eligible and authorized recipients were found.');
  const excludedCount = ids.length - leadIds.length;
  return BlastCampaignStore.create({ name: name.trim(), type, createdBy: user.id,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    templateSubject: subject.trim(), templateBody: content.trim(), sendingInboxId: inboxId, leadIds,
    tone: body.tone || 'professional', useAiPersonalization: Boolean(body.useAiPersonalization),
    status: body.status === 'draft' ? 'draft' : 'queued', excludedCount,
    stats: { total: ids.length, eligible: leadIds.length, sent: 0, failed: 0, skipped: excludedCount, unknown: 0 } });
}
