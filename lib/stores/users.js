import bcrypt from 'bcryptjs';
import { getSupabaseClient, queryResult, queryRecord } from '../supabase.js';
const aliases = { tokenVersion: 'token_version', lastActive: 'last_active', lastLogin: 'last_login', createdAt: 'created_at', dailyLeadTarget: 'daily_lead_target', dailyEmailLimit: 'daily_email_limit', calendarLink: 'calendar_link', crmWebhookUrl: 'crm_webhook_url' };
const fields = new Set(['name', 'email', 'password', 'role', 'approved', 'active', 'token_version', 'last_active', 'last_login', 'reset_password_token', 'reset_password_expires_at', 'password_changed_at', 'daily_lead_target', 'daily_email_limit', 'calendar_link', 'crm_webhook_url', 'timezone']);
function decode(row, withPassword = false) {
  if (!row) return null;
  const { password, reset_password_token, reset_password_expires_at, ...safe } = row;
  return { ...safe, ...(withPassword ? { password, reset_password_token, reset_password_expires_at } : {}),
    _id: row.id, tokenVersion: row.token_version, lastActive: row.last_active,
    lastLogin: row.last_login, createdAt: row.created_at, dailyLeadTarget: row.daily_lead_target,
    dailyEmailLimit: row.daily_email_limit, calendarLink: row.calendar_link, crmWebhookUrl: row.crm_webhook_url };
}
function byId(query, id) {
  const value = String(id || '').trim();
  if (value.includes('@')) return query.eq('email', value.toLowerCase());
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? query.eq('id', value) : query.eq('_id', value);
}
export const UserStore = {
  async findOne({ email }) {
    if (!email) return null;
    return decode(await queryResult(getSupabaseClient().from('users').select('*').eq('email', email.toLowerCase().trim()).maybeSingle()), true);
  },
  async findById(id) {
    if (!id) return null;
    return decode(await queryResult(byId(getSupabaseClient().from('users').select('*'), id).maybeSingle()));
  },
  async findByIdWithPassword(id) {
    if (!id) return null;
    return decode(await queryResult(byId(getSupabaseClient().from('users').select('*'), id).maybeSingle()), true);
  },
  async findByResetToken(token) {
    return decode(await queryResult(getSupabaseClient().from('users').select('*').eq('reset_password_token', token).maybeSingle()), true);
  },
  async create({ name, email, password, role = 'salesperson', approved = false, tokenVersion = 1 }) {
    if (!password) throw new Error('A password is required to create a user.');
    return decode(await queryResult(getSupabaseClient().from('users').insert({
      name: name.trim(), email: email.toLowerCase().trim(), password: await bcrypt.hash(password, 12),
      role, approved, active: true, token_version: tokenVersion
    }).select().single()));
  },
  async register({ name, email, password }) {
    return decode(await queryRecord(getSupabaseClient().rpc('register_outbound_user', {
      p_name: name.trim(), p_email: email.toLowerCase().trim(), p_password: await bcrypt.hash(password, 12)
    })));
  },
  async matchPassword(password, hash) { return typeof hash === 'string' && await bcrypt.compare(password, hash); },
  async update(id, data) {
    const patch = {};
    for (const [key, value] of Object.entries(data)) {
      const field = aliases[key] || key;
      if (fields.has(field)) patch[field] = value;
    }
    patch.updated_at = new Date().toISOString();
    return decode(await queryResult(byId(getSupabaseClient().from('users').update(patch), id).select().maybeSingle()));
  },
  async delete(id) { return (await queryResult(byId(getSupabaseClient().from('users').delete(), id).select('id'))).length > 0; },
  async updateProfile(id, data) { return this.update(id, data); },
  async updateLastActive(id) { return this.update(id, { lastActive: new Date().toISOString() }); },
  async updateLastLogin(id) { return this.update(id, { lastLogin: new Date().toISOString(), lastActive: new Date().toISOString() }); },
  async findAllUsers() {
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const batch = await queryResult(getSupabaseClient().from('users').select('*').order('id').range(start, start + 999));
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    return rows.map(row => decode(row));
  },
  async findPendingUsers() { return (await this.findAllUsers()).filter(user => !user.approved); },
  async findOnlineUsers() {
    return (await queryResult(getSupabaseClient().from('users').select('*').eq('approved', true).eq('active', true)
      .gte('last_active', new Date(Date.now() - 300000).toISOString()))).map(row => decode(row));
  },
  async approveUser(id) { return this.update(id, { approved: true, active: true }); },
  async rejectUser(id) { return this.delete(id); },
  async updateRole(id, role) { return this.update(id, { role }); }
};
