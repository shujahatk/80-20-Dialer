import { useEffect } from 'react';
import { broadcastRealtimeEvent } from '@/lib/realtime/eventBus';
import { useRealtimeEventBus } from '@/hooks/useRealtimeEventBus';

export function broadcastPipelineUpdate(lead) {
  broadcastRealtimeEvent('lead.stage_changed', {
    lead,
    leadId: lead?.id || lead?._id,
    stage: lead?.stage || lead?.pipelineStage || lead?.status
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('8020_pipeline_update', JSON.stringify({ id: lead?.id || lead?._id, time: Date.now() }));
    window.dispatchEvent(new Event('focus'));
  }
}

export function useRealtimePipeline(onStageUpdate) {
  useRealtimeEventBus((event) => {
    if (['lead.stage_changed', 'lead.updated', 'lead.created', 'lead.contacted', 'lead.disposition_changed', 'meeting.booked'].includes(event.eventType)) {
      if (typeof onStageUpdate === 'function') {
        onStageUpdate(event.lead || event.payload || null);
      }
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof onStageUpdate !== 'function') return;
    const refresh = () => onStageUpdate(null);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [onStageUpdate]);
}
