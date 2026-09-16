import { createClient } from '@supabase/supabase-js';
let client;
let configuration;
export function getSupabaseClient() {
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !rawKey) {
    throw new Error(`Supabase configuration error: SUPABASE_URL is ${rawUrl ? 'SET' : 'MISSING'}, SUPABASE_SERVICE_ROLE_KEY is ${rawKey ? 'SET' : 'MISSING'}.`);
  }

  const url = String(rawUrl).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  const key = String(rawKey).trim().replace(/^["']|["']$/g, '');

  if (!client || configuration !== `${url}:${key}`) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, options = {}) => {
          return fetch(input, {
            ...options,
            cache: 'no-store'
          });
        }
      }
    });
    configuration = `${url}:${key}`;
  }
  return client;
}
export function isSupabaseConfigured() {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
export async function queryResult(query) {
  try {
    const { data, error } = await query;
    if (error) {
      const msg = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
      throw new Error(`Supabase query failed: ${msg}`);
    }
    return data;
  } catch (err) {
    if (err.message && err.message.includes('fetch failed')) {
      const targetUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'undefined';
      throw new Error(`Supabase connection failed (${err.message}) connecting to '${targetUrl}'.`);
    }
    throw err;
  }
}
export async function queryRecord(query) {
  const data = await queryResult(query);
  if (Array.isArray(data) && data.length > 1) throw new Error('Expected one Supabase record.');
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? row : null;
}
