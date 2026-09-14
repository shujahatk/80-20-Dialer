import { createClient } from '@supabase/supabase-js';
let client;
let configuration;
export function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.');
  if (!client || configuration !== `${url}:${key}`) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: options.signal || AbortSignal.timeout(10000) }) }
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
