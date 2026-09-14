/**
 * Supabase Primary Database Connector Module
 * The 80/20 Outbound System operates on Supabase (PostgreSQL) as its primary architecture.
 */

import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';

export async function connectDB() {
  if (isSupabaseConfigured()) {
    return true;
  }
  return false;
}

export function isMongoConnected() {
  return false;
}
