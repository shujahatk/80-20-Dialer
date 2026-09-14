"use client";

import { authenticatedFetch } from "@/lib/apiClient";

import { useState, useEffect, useCallback } from 'react';

export default function BlastEngineSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [blastStatus, setBlastStatus] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const fetchStatus = useCallback(() => {
    return authenticatedFetch('/api/settings/blast').then(res => res.json()).then(data => setBlastStatus(data))
      .catch(err => setBlastStatus({ connected: false, error: err.message })).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleTestAndSync = async () => {
    try {
      setSyncing(true);
      setFeedback(null);
      const res = await authenticatedFetch('/api/settings/blast/sync', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          message: data.message || 'Resend SMTP successfully synchronized with Listmonk!',
        });
      } else {
        setFeedback({
          type: 'error',
          message: data.message || data.error || 'Failed to sync SMTP credentials.',
        });
      }
      await fetchStatus();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Connection test failed',
      });
    } finally {
      setSyncing(false);
    }
  };

  const isConnected = blastStatus?.connected;
  const resendConfigured = blastStatus?.resend?.configured;

  return (
    <div className="bg-[#121624] border border-white/10 rounded-2xl p-6 shadow-xl shadow-black/30 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-cyan-500/20">
            ⚡
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              Blast &amp; Delivery Engine
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Listmonk + Resend
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              High-throughput asynchronous bulk email queue &amp; Resend SMTP relay
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-slate-400 animate-pulse font-mono">Checking status...</span>
          ) : isConnected ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 -ml-3.5"></span>
              Connected (Port 9000)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-sm shadow-rose-500/10">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{feedback.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid of Microservices Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Listmonk App Node */}
        <div className="bg-[#080b12] p-4 rounded-xl border border-white/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Listmonk Server</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {isConnected ? 'Active' : 'Down'}
            </span>
          </div>
          <div className="text-sm font-bold text-white font-mono">
            {blastStatus?.listmonk?.url || 'http://127.0.0.1:9000'}
          </div>
          <div className="text-[11px] text-slate-400">Rate Limit: 25 msg/s · Batch: 100</div>
        </div>

        {/* PostgreSQL Database */}
        <div className="bg-[#080b12] p-4 rounded-xl border border-white/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">PostgreSQL DB</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'
              }`}
            >
              {isConnected ? 'Healthy' : 'Port 5432'}
            </span>
          </div>
          <div className="text-sm font-bold text-white font-mono">
            postgres:15-alpine
          </div>
          <div className="text-[11px] text-slate-400">Database: listmonk (Isolated)</div>
        </div>

        {/* Resend SMTP Relay */}
        <div className="bg-[#080b12] p-4 rounded-xl border border-white/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Resend SMTP Relay</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                resendConfigured ? 'bg-cyan-500/20 text-cyan-400' : 'bg-amber-500/20 text-amber-400'
              }`}
            >
              {resendConfigured ? 'SSL/TLS 465' : 'Key Required'}
            </span>
          </div>
          <div className="text-sm font-bold text-cyan-400 font-mono">
            smtp.resend.com:465
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            From: {blastStatus?.resend?.fromEmail || 'outreach@8020acquisition.com'}
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <div className="text-[11px] text-slate-400">
          Webhook Endpoint: <code className="text-cyan-400 bg-white/5 px-2 py-0.5 rounded font-mono">/api/webhooks/listmonk</code>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="px-3.5 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-xs rounded-xl border border-white/5 transition-all cursor-pointer"
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>

          <button
            type="button"
            onClick={handleTestAndSync}
            disabled={syncing}
            className="flex-1 sm:flex-none px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {syncing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Syncing SMTP...
              </>
            ) : (
              '⚡ Test Connection & Sync SMTP'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
