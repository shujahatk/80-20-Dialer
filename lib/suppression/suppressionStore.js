import { getSupabaseClient, queryResult } from '../supabase.js';
export function normalizeContactValue(value) { return typeof value === 'string' ? value.trim().toLowerCase() || null : null; }
export function normalizePhoneDigits(value) { const digits = typeof value === 'string' ? value.replace(/\D/g, '') : ''; return digits.length >= 6 ? digits : null; }
export const SuppressionStore = {
  async add({ email, phone, channel = 'all', reason = 'opt_out', source = 'system', leadId = null, createdBy = null }) {
    const email_normalized = normalizeContactValue(email);
    const phone_normalized = normalizePhoneDigits(phone);
    if (!email_normalized && !phone_normalized) return { success: false, message: 'Email or phone is required.' };
    const data = await queryResult(getSupabaseClient().from('suppression_list').insert({ email_normalized, phone_normalized,
      channel, reason, source, lead_id: leadId, created_by: createdBy, active: true }).select().single());
    return { success: true, data };
  },
  async isSuppressed({ email, phone, channel = 'all' }) {
    const lookups = [];
    const normalizedEmail = normalizeContactValue(email);
    const normalizedPhone = normalizePhoneDigits(phone);
    if (normalizedEmail) lookups.push(getSupabaseClient().from('suppression_list').select('*').eq('active', true).eq('email_normalized', normalizedEmail));
    if (normalizedPhone) lookups.push(getSupabaseClient().from('suppression_list').select('*').eq('active', true).eq('phone_normalized', normalizedPhone));
    const records = (await Promise.all(lookups.map(queryResult))).flat();
    const match = records.find(record => channel === 'all' || record.channel === 'all' || record.channel === channel);
    return match ? { suppressed: true, reason: match.reason, record: match } : { suppressed: false, reason: null };
  },
  async findAll() { return queryResult(getSupabaseClient().from('suppression_list').select('*').eq('active', true).order('created_at', { ascending: false })); },
  async remove(id) { return (await queryResult(getSupabaseClient().from('suppression_list').update({ active: false }).eq('id', id).select('id'))).length > 0; }
};
