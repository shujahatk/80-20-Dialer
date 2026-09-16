import { getBrowserSupabaseClient } from '../supabaseClient.js';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';

export const REALTIME_CHANNEL = '8020_realtime_bus';

/**
 * Standardized Realtime Event Broadcaster
 * Works seamlessly across both Server-side (APIs, Webhooks) and Client-side (Workstation, Dashboard)
 */
export async function broadcastRealtimeEvent(eventType, payload = {}) {
  const event = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    eventType,
    timestamp: new Date().toISOString(),
    payload
  };

  // 1. Browser context
  if (typeof window !== 'undefined') {
    // Broadcast via local BroadcastChannel for zero-latency same-browser tabs
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(REALTIME_CHANNEL);
        bc.postMessage(event);
        bc.close();
      }
    } catch (e) {
      console.warn('[BroadcastChannel Error]:', e.message);
    }

    // Dispatch DOM event
    try {
      window.dispatchEvent(new CustomEvent('8020_realtime_event', { detail: event }));
    } catch (e) {}

    // Broadcast via Supabase Realtime Client
    try {
      const browserClient = getBrowserSupabaseClient();
      if (browserClient) {
        const channel = browserClient.channel(REALTIME_CHANNEL);
        channel.send({
          type: 'broadcast',
          event: eventType,
          payload: event
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[Browser Realtime Broadcast Error]:', e.message);
    }

    return {
      success: true,
      channel: REALTIME_CHANNEL,
      event
    };
  }

  // 2. Server / Node API Route / Webhook context
  if (isSupabaseConfigured()) {
    try {
      const serverClient = getSupabaseClient();
      if (serverClient) {
        const channel = serverClient.channel(REALTIME_CHANNEL);
        await channel.send({
          type: 'broadcast',
          event: eventType,
          payload: event
        });
      }
    } catch (e) {
      // Non-blocking fallback
      console.warn('[Server Realtime Broadcast Error]:', e.message);
    }
  }

  return {
    success: true,
    channel: REALTIME_CHANNEL,
    event
  };
}
