import { randomUUID } from 'node:crypto';
import { getSupabaseClient, queryResult, queryRecord } from '../supabase.js';

// Flexible settings and templates live in Supabase JSONB, never on local disk.
export function recordStore(collection) {
  const decode = row => row ? { ...row.data, _id: row.id, id: row.id } : null;
  return {
    async create(data, id = data._id || data.id || randomUUID()) {
      return decode(await queryResult(getSupabaseClient().from('app_records').insert({
        collection, id, data: { createdAt: new Date().toISOString(), ...data }
      }).select().single()));
    },
    async findAll() {
      const rows = [];
      for (let start = 0; ; start += 1000) {
        const batch = await queryResult(getSupabaseClient().from('app_records').select('*')
          .eq('collection', collection).order('id').range(start, start + 999));
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      return rows.map(decode).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    },
    async findById(id) {
      if (!id) return null;
      return decode(await queryResult(getSupabaseClient().from('app_records').select('*')
        .eq('collection', collection).eq('id', String(id)).maybeSingle()));
    },
    async update(id, patch) {
      return decode(await queryRecord(getSupabaseClient().rpc('patch_app_record', {
        p_collection: collection, p_id: String(id), p_patch: JSON.parse(JSON.stringify(patch))
      })));
    },
    async delete(id) {
      return (await queryResult(getSupabaseClient().from('app_records').delete()
        .eq('collection', collection).eq('id', String(id)).select('id'))).length > 0;
    }
  };
}
