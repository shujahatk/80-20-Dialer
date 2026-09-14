import { useEffect } from 'react';
import { getBrowserSupabaseClient } from '@/lib/supabaseClient.js';

/**
 * useRealtimePipeline Hook
 * Subscribes to real-time PostgreSQL updates, BroadcastChannels, and cross-tab storage events
 */
export function useRealtimePipeline(onStageUpdate) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof onStageUpdate !== 'function') return;

    let supabaseChannel = null;
    let broadcastChannel = null;

    // 1. Supabase Realtime WebSocket Subscription
    try {
      const supabase = getBrowserSupabaseClient();
      if (supabase) {
        supabaseChannel = supabase
          .channel('public:leads_realtime_pipeline')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'leads' },
            (payload) => {
              if (payload && payload.new) {
                onStageUpdate(payload.new);
              } else {
                onStageUpdate(null);
              }
            }
          )
          .on(
            'broadcast',
            { event: 'stage_change' },
            ({ payload }) => {
              if (payload) {
                onStageUpdate(payload);
              }
            }
          )
          .subscribe();
      }
    } catch (e) {
      console.warn('[useRealtimePipeline] Supabase subscription notice:', e.message);
    }

    // 2. Cross-Tab / Cross-Window BroadcastChannel (0ms Instant Local Sync)
    try {
      if ('BroadcastChannel' in window) {
        broadcastChannel = new BroadcastChannel('8020_pipeline_events');
        broadcastChannel.onmessage = (event) => {
          if (event && event.data) {
            onStageUpdate(event.data.lead || event.data);
          }
        };
      }
    } catch (e) {
      console.warn('[useRealtimePipeline] BroadcastChannel notice:', e.message);
    }

    // 3. LocalStorage Cross-Tab Storage Event Listener
    const handleStorageChange = (e) => {
      if (e.key === '8020_last_pipeline_update' || e.key === 'last_pipeline_update') {
        onStageUpdate(null);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (supabaseChannel) {
        try {
          const supabase = getBrowserSupabaseClient();
          if (supabase) supabase.removeChannel(supabaseChannel);
        } catch (e) {}
      }
      if (broadcastChannel) {
        try {
          broadcastChannel.close();
        } catch (e) {}
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [onStageUpdate]);
}

/**
 * Broadcasts a local real-time pipeline event across tabs and to Supabase
 */
export function broadcastPipelineUpdate(payload) {
  if (typeof window === 'undefined' || !payload) return;

  const leadObj = payload.lead || payload.data || payload;
  const leadId = leadObj._id || leadObj.id || payload._id || payload.id;
  const stage = leadObj.stage || payload.stage;
  const outcome = leadObj.outcome || payload.outcome;

  const normalizedLead = {
    ...leadObj,
    _id: leadId,
    id: leadId,
    stage,
    outcome,
    timestamp: Date.now()
  };

  // 1. Post to BroadcastChannel (0ms instant cross-tab / cross-window sync)
  try {
    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('8020_pipeline_events');
      bc.postMessage({ type: 'STAGE_CHANGED', lead: normalizedLead, timestamp: Date.now() });
      setTimeout(() => bc.close(), 100);
    }
  } catch (e) {}

  // 2. Update localStorage to trigger cross-tab storage listeners
  try {
    localStorage.setItem('8020_last_pipeline_update', JSON.stringify({
      leadId,
      stage,
      outcome,
      timestamp: Date.now()
    }));
  } catch (e) {}

  // 3. Post to Supabase Realtime Broadcast Channel
  try {
    const supabase = getBrowserSupabaseClient();
    if (supabase) {
      const ch = supabase.channel('public:leads_realtime_pipeline');
      ch.send({
        type: 'broadcast',
        event: 'stage_change',
        payload: normalizedLead
      }).catch(() => {});
    }
  } catch (e) {}
}
