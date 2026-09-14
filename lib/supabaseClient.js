import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let browserClient = null;

export function getBrowserSupabaseClient() {
  if (typeof window === 'undefined') return null;
  if (!browserClient && supabaseUrl && supabaseAnonKey) {
    try {
      browserClient = createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 20
          }
        }
      });
    } catch (e) {
      console.warn('[Supabase Realtime Browser Init Notice]:', e.message);
    }
  }
  return browserClient;
}
