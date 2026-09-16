import { getSupabaseClient, queryResult, queryRecord } from '../supabase.js';

const aliases = { assignedTo: 'assigned_to', userId: 'assigned_to', campaignId: 'campaign_id', stageUpdatedAt: 'stage_updated_at', lastActivityNote: 'last_activity_note' };
const columns = new Set(['contact', 'company', 'name', 'email', 'phone', 'city', 'country', 'timezone', 'niche', 'industry', 'status', 'stage', 'assigned_to', 'campaign_id', 'priority', 'notes', 'suppression', 'tags', 'custom_context', 'locked_by', 'locked_at', 'lock_heartbeat_at', 'deleted_at', 'deleted_by', 'deletion_reason', 'stage_updated_at', 'last_activity_note', 'last_activity_at']);
export function decodeLead(row) {
  if (!row) return null;
  const data = { ...row, ...(row.data || {}) };
  return { ...data, _id: row.id, assignedTo: row.assigned_to, userId: row.assigned_to,
    campaignId: row.campaign_id, createdAt: row.created_at,
    contact: { ...(data.contact || {}), name: row.name || data.contact?.name || '', email: row.email || data.contact?.email || '', phone: row.phone || data.contact?.phone || '' },
    geography: { ...(data.geography || {}), city: row.city || '', country: row.country || '', timezone: row.timezone || 'UTC' },
    assignment: { ...(data.assignment || {}), priority: row.priority || 0 },
    stage: row.stage || row.status || 'NEW',
    currentlyBeingWorked: Boolean(row.locked_by), currentlyBeingWorkedBy: row.locked_by, currentlyBeingWorkedAt: row.locked_at };
}
function payload(data) {
  const patch = {};
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (['id', '_id', 'data', 'created_at', 'updated_at'].includes(key)) continue;
    const field = aliases[key] || key;
    if (columns.has(field)) patch[field] = value;
    else extra[key] = value;
  }
  if (data.contact) {
    patch.name = data.contact.name || '';
    patch.email = data.contact.email || null;
    patch.phone = data.contact.phone || null;
  }
  if (typeof patch.company === 'string') patch.company = { name: patch.company };
  if (data.geography) {
    patch.city = data.geography.city || '';
    patch.country = data.geography.country || '';
    patch.timezone = data.geography.timezone || 'UTC';
  }
  if (data.assignment?.priority !== undefined) patch.priority = data.assignment.priority;
  if (['pool', ''].includes(patch.assigned_to)) patch.assigned_to = null;
  patch.data = extra;
  return patch;
}
async function list(apply = query => query) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const batch = await queryResult(apply(getSupabaseClient().from('leads').select('*')).order('id').range(start, start + 999));
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows.map(decodeLead).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
function identifier(query, id) {
  const value = String(id);
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? query.eq('id', value) : query.eq('_id', value);
}
export const LeadStore = {
  async create(data) {
    return decodeLead(await queryResult(getSupabaseClient().from('leads').insert({
      ...payload(data), _id: data._id || null, status: data.status || 'new'
    }).select().single()));
  },
  async createBulk(leads) {
    const results = [];
    for (let i = 0; i < leads.length; i += 500) {
      results.push(...(await queryResult(getSupabaseClient().from('leads').insert(leads.slice(i, i + 500)
        .map(data => ({ ...payload(data), _id: data._id || null, status: data.status || 'new' }))).select())).map(decodeLead));
    }
    return results;
  },
  async countAll(filter = {}) {
    let query = getSupabaseClient().from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null);
    if (filter.assignedTo) query = query.eq('assigned_to', String(filter.assignedTo));
    if (filter.stage) query = query.eq('stage', String(filter.stage));
    if (filter.status) query = query.eq('status', String(filter.status));
    const { count, error } = await query;
    if (error) throw new Error(`Lead count failed: ${error.message}`);
    return count || 0;
  },
  async findPaginated({ page = 1, limit = 50, search = '', stage = '', status = '', assignedTo = null, light = true } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (p - 1) * l;

    const selectFields = light 
      ? 'id, _id, name, email, phone, company, position, city, country, timezone, stage, status, priority, assigned_to, campaign_id, created_at, locked_by, locked_at, last_activity_at, last_activity_note'
      : '*';

    let query = getSupabaseClient()
      .from('leads')
      .select(selectFields, { count: 'exact' })
      .is('deleted_at', null);

    if (assignedTo) {
      query = query.eq('assigned_to', String(assignedTo));
    }
    if (stage) {
      query = query.eq('stage', String(stage));
    }
    if (status) {
      query = query.eq('status', String(status));
    }
    if (search && search.trim()) {
      const q = search.trim();
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + l - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Paginated lead query failed: ${error.message}`);

    const total = count || 0;
    const leads = (data || []).map(decodeLead);

    return {
      leads,
      total,
      page: p,
      limit: l,
      totalPages: Math.ceil(total / l)
    };
  },
  async findAll() { return list(query => query.is('deleted_at', null)); },
  async findDeleted() { return list(query => query.not('deleted_at', 'is', null)); },
  async findById(id) {
    if (!id) return null;
    return decodeLead(await queryResult(identifier(getSupabaseClient().from('leads').select('*'), id).is('deleted_at', null).maybeSingle()));
  },
  async findByUser(id) { return list(query => query.eq('assigned_to', String(id)).is('deleted_at', null)); },
  async findByCampaign(id) { return list(query => query.eq('campaign_id', String(id)).is('deleted_at', null)); },
  async claimNextLead(userId) {
    return decodeLead(await queryRecord(getSupabaseClient().rpc('claim_outbound_lead', { p_user: String(userId) })));
  },
  async findDailyQueue(userId) {
    const leads = await this.findByUser(userId);
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setDate(end.getDate() + 1);
    const state = lead => String(lead.status || '').toLowerCase();
    return {
      replies: leads.filter(lead => lead.hasUnansweredReply),
      overdue: leads.filter(lead => state(lead) === 'callback' && lead.callbackDate && new Date(lead.callbackDate) < now),
      dueToday: leads.filter(lead => state(lead) === 'callback' && lead.callbackDate && new Date(lead.callbackDate) >= now && new Date(lead.callbackDate) < end),
      interested: leads.filter(lead => ['interested', 'qualified'].includes(state(lead)) && !lead.coldOutreachStopped),
      newLeads: leads.filter(lead => ['new', 'assigned'].includes(state(lead))).sort((a, b) => b.priority - a.priority).slice(0, 50)
    };
  },
  async acquireAtomicLock(id, userId) {
    const lead = await this.findById(id);
    if (!lead) return { success: false, status: 404, message: 'Lead not found.' };
    const updated = await queryRecord(getSupabaseClient().rpc('lock_outbound_lead', { p_lead: lead.id, p_user: String(userId) }));
    return updated ? { success: true, lead: decodeLead(updated) } : { success: false, status: 423, message: 'This lead is locked by another agent.', lockedBy: lead.locked_by };
  },
  async renewLockHeartbeat(id, userId) {
    const lead = await this.findById(id);
    if (!lead) return null;
    return decodeLead(await queryResult(getSupabaseClient().from('leads').update({ locked_at: new Date().toISOString(), lock_heartbeat_at: new Date().toISOString() })
      .eq('id', lead.id).eq('locked_by', String(userId)).select().maybeSingle()));
  },
  async releaseLock(id, userId = null, force = false) {
    let query = identifier(getSupabaseClient().from('leads').update({ locked_by: null, locked_at: null, lock_heartbeat_at: null }), id);
    if (!force) {
      if (!userId) return false;
      query = query.eq('locked_by', String(userId));
    }
    return (await queryResult(query.select('id'))).length > 0;
  },
  async findPendingByPhone(phone) { return phone ? list(query => query.eq('phone', phone).is('deleted_at', null)) : []; },
  async findPendingByEmail(email) { return email ? list(query => query.eq('email', email.trim().toLowerCase()).is('deleted_at', null)) : []; },
  async update(id, data) {
    const patch = payload(data);
    // RPC merges JSONB under a row lock, preserving concurrent metadata edits.
    return decodeLead(await queryRecord(getSupabaseClient().rpc('patch_outbound_lead', { p_identifier: String(id), p_patch: patch })));
  },
  async updateStage(id, stage, note = null) {
    return this.update(id, { stage, status: stage, stage_updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), ...(note ? { last_activity_note: note } : {}) });
  },
  async findPipelineLeads(userId = null) { return userId ? this.findByUser(userId) : this.findAll(); },
  async softDelete(id, userId = null, reason = 'Deleted by user') {
    return Boolean(await this.update(id, { deleted_at: new Date().toISOString(), deleted_by: userId, deletion_reason: reason, locked_by: null, locked_at: null, lock_heartbeat_at: null }));
  },
  async softDeleteBulk(ids, userId, reason) {
    let count = 0;
    for (const id of ids) if (await this.softDelete(id, userId, reason)) count++;
    return count;
  },
  async restore(id) { return Boolean(await this.update(id, { deleted_at: null, deleted_by: null, deletion_reason: null })); },
  async purgePermanent(id) { return (await queryResult(identifier(getSupabaseClient().from('leads').delete(), id).select('id'))).length > 0; },
  async purgeBulk(ids) { let count = 0; for (const id of ids) if (await this.purgePermanent(id)) count++; return count; },
  async delete(id, userId, reason) { return this.softDelete(id, userId, reason); },
  async deleteBulk(ids, userId, reason) { return this.softDeleteBulk(ids, userId, reason); },
  async countByUser(userId) { return (await this.findByUser(userId)).length; },
  async getManagerMetrics(userId) {
    const leads = await this.findByUser(userId);
    const status = lead => String(lead.status || '').toLowerCase();
    return { total: leads.length, new: leads.filter(lead => status(lead) === 'new').length,
      contacted: leads.filter(lead => !['new', 'assigned'].includes(status(lead))).length,
      interested: leads.filter(lead => ['interested', 'qualified'].includes(status(lead))).length,
      booked: leads.filter(lead => ['booked', 'meeting_booked'].includes(status(lead))).length,
      closed: leads.filter(lead => ['closed', 'closed_won'].includes(status(lead))).length };
  }
};
