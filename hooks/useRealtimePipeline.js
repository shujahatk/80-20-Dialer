import { useEffect } from 'react';
export function broadcastPipelineUpdate(lead) {
  if (typeof window === 'undefined') return;
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('8020_pipeline_events');
    channel.postMessage({ lead });
    channel.close();
  }
  localStorage.setItem('8020_pipeline_update', JSON.stringify({ id: lead?.id || lead?._id, time: Date.now() }));
  window.dispatchEvent(new Event('focus'));
}
// Lead data is protected by custom API authentication. Refresh via authorized
// API readers instead of granting anonymous Supabase access to the leads table.
export function useRealtimePipeline(onStageUpdate) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof onStageUpdate !== 'function') return;
    const refresh = () => onStageUpdate(null);
    const timer = setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('8020_pipeline_events') : null;
    if (channel) channel.onmessage = refresh;
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); channel?.close(); };
  }, [onStageUpdate]);
}
