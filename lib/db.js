import { getSupabaseClient, queryResult } from './supabase.js';
export async function connectDB() { getSupabaseClient(); return true; }
export async function checkDatabaseHealth() {
  await queryResult(getSupabaseClient().from('users').select('id').limit(1));
  return true;
}
