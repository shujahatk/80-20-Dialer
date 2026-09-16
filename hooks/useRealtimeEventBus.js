'use client';

import { useEffect, useRef } from 'react';
import { getBrowserSupabaseClient } from '@/lib/supabaseClient';
import { REALTIME_CHANNEL } from '@/lib/realtime/eventBus';

/**
 * Reusable React Hook to subscribe to the centralized Supabase Realtime Event Bus
 * 
 * @param {Function} onEvent - Callback handler: (event) => void
 * @param {Array<string>|string} [filterEvents] - Optional filter for specific event types (e.g. ['call.started', 'call.completed'] or '*')
 */
export function useRealtimeEventBus(onEvent, filterEvents = '*') {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof onEvent !== 'function') return;

    const matchesFilter = (type) => {
      if (!filterEvents || filterEvents === '*') return true;
      if (Array.isArray(filterEvents)) return filterEvents.includes(type);
      return filterEvents === type;
    };

    const handleEvent = (eventData) => {
      if (!eventData || !eventData.eventType) return;
      if (matchesFilter(eventData.eventType)) {
        if (typeof handlerRef.current === 'function') {
          handlerRef.current(eventData);
        }
      }
    };

    // 1. Local DOM CustomEvent listener
    const domListener = (e) => {
      if (e.detail) handleEvent(e.detail);
    };
    window.addEventListener('8020_realtime_event', domListener);

    // 2. BroadcastChannel for inter-tab sync
    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(REALTIME_CHANNEL);
        bc.onmessage = (e) => {
          if (e.data) handleEvent(e.data);
        };
      }
    } catch (e) {}

    // 3. Supabase Realtime WebSocket subscription (cross-network / cross-device)
    let supabaseChannel = null;
    try {
      const supabase = getBrowserSupabaseClient();
      if (supabase) {
        supabaseChannel = supabase.channel(REALTIME_CHANNEL);

        // Listen to all broadcast events on the channel
        supabaseChannel
          .on('broadcast', { event: '*' }, (payload) => {
            if (payload && payload.payload) {
              handleEvent(payload.payload);
            }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              // console.log(`[Realtime EventBus]: Subscribed to ${REALTIME_CHANNEL}`);
            }
          });
      }
    } catch (err) {
      console.warn('[Realtime EventBus Subscription Error]:', err.message);
    }

    return () => {
      window.removeEventListener('8020_realtime_event', domListener);
      if (bc) {
        bc.close();
      }
      if (supabaseChannel) {
        supabaseChannel.unsubscribe();
      }
    };
  }, [filterEvents]);
}
