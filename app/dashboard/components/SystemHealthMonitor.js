"use client";

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/apiClient';

export default function SystemHealthMonitor() {
  const [health, setHealth] = useState({
    status: 'checking',
    api: 'Checking',
    database: 'Checking',
    resend: 'Checking',
    twilio: 'Checking',
    aiCopilot: 'Checking',
    queueWorker: 'Checking'
  });
  const [loading, setLoading] = useState(true);



  function checkHealth() {
    return authenticatedFetch('/api/health').then(response => response.json().then(res => ({ res, ok: response.ok }))).then(({ res, ok }) => {
      setHealth({ status: res.status === 'ok' ? 'healthy' : 'degraded', api: ok ? 'Healthy' : 'Degraded',
        database: res.services?.database === 'connected' ? 'Connected' : 'Degraded',
        resend: res.services?.email === 'configured' ? 'Configured' : 'Missing',
        twilio: res.services?.telephony === 'configured' ? 'Configured' : 'Missing',
        aiCopilot: res.services?.ai === 'configured' ? 'Configured' : 'Missing',
        queueWorker: res.services?.worker === 'running' ? 'Active' : 'Stopped' });
    }).catch(() => setHealth({ status: 'degraded', api: 'Unavailable', database: 'Unknown', resend: 'Unknown', twilio: 'Unknown', aiCopilot: 'Unknown', queueWorker: 'Unknown' }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const services = [
    { name: 'Core Next.js API Engine', status: health.api, icon: '⚡' },
    { name: 'Supabase PostgreSQL', status: health.database, icon: '🗄️' },
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
                svc.status === 'Healthy' || svc.status === 'Connected' || svc.status === 'Active' || svc.status === 'Configured'
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
