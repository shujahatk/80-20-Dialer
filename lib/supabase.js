import { createClient } from '@supabase/supabase-js';
let client;
let configuration;
export function getSupabaseClient() {
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !rawKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.');

  const url = String(rawUrl).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  const key = String(rawKey).trim().replace(/^["']|["']$/g, '');

  if (!client || configuration !== `${url}:${key}`) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    configuration = `${url}:${key}`;
  }
  return client;
}
export function isSupabaseConfigured() {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
export async function queryResult(query) {
  const { data, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return data;
}
export async function queryRecord(query) {
  const data = await queryResult(query);
  if (Array.isArray(data) && data.length > 1) throw new Error('Expected one Supabase record.');
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? row : null;
}
