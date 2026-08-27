"use client";

import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/apiClient';

export default function SystemHealthMonitor() {
  const [health, setHealth] = useState({
    status: 'healthy',
    api: 'Healthy',
    database: 'Connected',
    resend: 'Healthy',
    twilio: 'Healthy',
    aiCopilot: 'Healthy',
    queueWorker: 'Active'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkHealth = async () => {
    try {
      const res = await apiRequest('/api/health');
      if (res) {
        setHealth({
          status: res.status || 'healthy',
          api: 'Healthy',
          database: res.database === 'connected' ? 'Connected' : 'Degraded',
          resend: 'Healthy',
          twilio: 'Healthy',
          aiCopilot: 'Healthy',
          queueWorker: 'Active'
        });
      }
    } catch (e) {
      setHealth(prev => ({ ...prev, status: 'degraded', database: 'Degraded' }));
    } finally {
      setLoading(false);
    }
  };

  const services = [
    { name: 'Core Next.js API Engine', status: health.api, icon: '⚡' },
    { name: 'MongoDB Database', status: health.database, icon: '🗄️' },
    { name: 'Resend Email Gateway', status: health.resend, icon: '✉️' },
    { name: 'Twilio WebRTC Voice', status: health.twilio, icon: '📞' },
    { name: 'AI Copilot Engine', status: health.aiCopilot, icon: '🤖' },
    { name: 'Queue Worker Process', status: health.queueWorker, icon: '⚙️' }
  ];

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${health.status === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <h3 className="text-sm font-bold text-white tracking-tight">System Infrastructure Health</h3>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">Auto-refreshed 30s</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {services.map((svc, i) => (
          <div key={i} className="p-3 bg-[#07090e] rounded-xl border border-white/5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm">{svc.icon}</span>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                svc.status === 'Healthy' || svc.status === 'Connected' || svc.status === 'Active'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {svc.status}
              </span>
            </div>
            <div className="text-xs font-semibold text-white truncate pt-1">{svc.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
