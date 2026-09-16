import { randomUUID } from 'node:crypto';
import { getSupabaseClient, queryResult, queryRecord } from '../supabase.js';
export const decodeBlast = row => row ? { ...row.data, id: row.id, _id: row.id, status: row.status, createdAt: row.created_at } : null;
export const BlastCampaignStore = {
  async create(data) {
    const id = randomUUID();
    const leadIds = [...new Set(data.leadIds || [])];
    const recipients = leadIds.map(leadId => ({ lead_id: String(leadId), status: 'pending',
      idempotency_key: `blast/${id}/${leadId}`, attempt_count: 0 }));
    return decodeBlast(await queryResult(getSupabaseClient().from('outbound_blast_campaigns').insert({
      id, status: data.status || 'draft', data: { ...data, leadIds, recipients }
    }).select().single()));
  },
  async findAll() {
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const batch = await queryResult(getSupabaseClient().from('outbound_blast_campaigns').select('*').order('id').range(start, start + 999));
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    return rows.map(decodeBlast).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
  async findById(id) {
    if (!id) return null;
    return decodeBlast(await queryResult(getSupabaseClient().from('outbound_blast_campaigns').select('*').eq('id', id).maybeSingle()));
  },
  async update(id, patch) {
    return decodeBlast(await queryRecord(getSupabaseClient().rpc('patch_outbound_blast', { p_id: id, p_patch: patch })));
  },
  async delete(id) {
    return (await queryResult(getSupabaseClient().from('outbound_blast_campaigns').delete().eq('id', id).eq('status', 'draft').select('id'))).length > 0;
  },
  async claim(worker) {
    return decodeBlast(await queryRecord(getSupabaseClient().rpc('claim_outbound_blast', { p_worker: worker })));
  },
  async checkpoint(id, worker, patch, terminalStatus = null) {
    const result = await queryRecord(getSupabaseClient().rpc('checkpoint_outbound_blast', {
      p_id: id, p_worker: worker, p_patch: patch, p_terminal_status: terminalStatus
    }));
    if (!result) throw new Error('Campaign lease lost; dispatch stopped.');
    return decodeBlast(result);
  },
  async release(id, worker) {
    await queryRecord(getSupabaseClient().rpc('release_outbound_blast', { p_id: id, p_worker: worker }));
  }
};
