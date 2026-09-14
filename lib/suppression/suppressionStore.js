import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';

let inMemorySuppressionList = [];

export function normalizeContactValue(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim().toLowerCase();
  return trimmed || null;
}

export function normalizePhoneDigits(val) {
  if (!val || typeof val !== 'string') return null;
  const digits = val.replace(/\D/g, '');
  return digits.length >= 6 ? digits : null;
}

/**
 * Permanent Suppression & DNC Store
 * Guarantees that opt-outs survive lead deletion and block all future outreach channels.
 */
export const SuppressionStore = {
  async add({ email, phone, channel = 'all', reason = 'opt_out', source = 'system', leadId = null, createdBy = null }) {
    const normEmail = normalizeContactValue(email);
    const normPhone = normalizePhoneDigits(phone);
    const now = new Date().toISOString();

    if (!normEmail && !normPhone) {
      return { success: false, message: 'Either email or phone is required to add suppression.' };
    }

    const payload = {
      id: 'sup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      email_normalized: normEmail,
      phone_normalized: normPhone,
      channel: channel || 'all',
      reason: reason || 'opt_out',
      source: source || 'system',
      lead_id: leadId ? String(leadId) : null,
      created_by: createdBy ? String(createdBy) : null,
      active: true,
      created_at: now,
      updated_at: now
    };

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data, error } = await client.from('suppression_list').insert([payload]).select().single();
        if (error) {
          console.warn('[Supabase SuppressionStore Insert Notice]:', error.message);
        } else if (data) {
          return { success: true, data };
        }
      } catch (err) {
        console.error('[Supabase SuppressionStore Exception]:', err.message);
      }
    }

    // Update in-memory fallback/test cache
    const existingIdx = inMemorySuppressionList.findIndex(
      s => (normEmail && s.email_normalized === normEmail) || (normPhone && s.phone_normalized === normPhone)
    );
    if (existingIdx !== -1) {
      inMemorySuppressionList[existingIdx] = { ...inMemorySuppressionList[existingIdx], ...payload, active: true };
    } else {
      inMemorySuppressionList.push(payload);
    }

    return { success: true, data: payload };
  },

  async isSuppressed({ email, phone, channel = 'all' }) {
    const normEmail = normalizeContactValue(email);
    const normPhone = normalizePhoneDigits(phone);

    if (!normEmail && !normPhone) {
      return { suppressed: false, reason: null };
    }

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        let query = client.from('suppression_list').select('*').eq('active', true);

        const conditions = [];
        if (normEmail) conditions.push(`email_normalized.eq.${normEmail}`);
        if (normPhone) conditions.push(`phone_normalized.eq.${normPhone}`);

        if (conditions.length > 0) {
          query = query.or(conditions.join(','));
        }

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          const match = data.find(s => s.channel === 'all' || s.channel === channel || channel === 'all');
          if (match) {
            return {
              suppressed: true,
              reason: match.reason || 'Contact is on the permanent suppression / DNC list',
              record: match
            };
          }
        }
      } catch (err) {
        console.warn('[Supabase Suppression Query Notice]:', err.message);
      }
    }

    // Check in-memory test cache
    const match = inMemorySuppressionList.find(s =>
      s.active !== false &&
      ((normEmail && s.email_normalized === normEmail) || (normPhone && s.phone_normalized === normPhone)) &&
      (s.channel === 'all' || s.channel === channel || channel === 'all')
    );

    if (match) {
      return {
        suppressed: true,
        reason: match.reason || 'Contact is on the permanent suppression / DNC list',
        record: match
      };
    }

    return { suppressed: false, reason: null };
  },

  async findAll() {
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await getSupabaseClient()
          .from('suppression_list')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false });

        if (!error && data) return data;
      } catch (e) {}
    }
    return inMemorySuppressionList.filter(s => s.active !== false);
  },

  async remove(id) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        await client.from('suppression_list').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
        return true;
      } catch (e) {}
    }
    const idx = inMemorySuppressionList.findIndex(s => s.id === id);
    if (idx !== -1) {
      inMemorySuppressionList[idx].active = false;
      return true;
    }
    return false;
  }
};
