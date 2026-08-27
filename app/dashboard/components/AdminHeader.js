"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminHeader({ user, searchQuery, setSearchQuery, alerts = [], onRefresh }) {
  const router = useRouter();
  const [showAlertsPopover, setShowAlertsPopover] = useState(false);

  return (
    <header className="h-16 border-b border-white/5 bg-[#07090e]/80 backdrop-blur-md px-6 flex items-center justify-between z-20 shrink-0">
      {/* Search Input */}
      <div className="flex items-center gap-4 flex-1 max-w-md">
        <div className="relative w-full">
          <svg className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search leads, campaigns, users, or companies..."
            className="w-full bg-[#121624] border border-white/8 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Right Header Actions */}
      <div className="flex items-center gap-3">
        {/* Refresh button */}
        <button
          onClick={onRefresh}
          className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5"
          title="Refresh Data"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">Refresh</span>
        </button>

        {/* Quick Launch Buttons */}
        <button
          onClick={() => router.push('/manager/blasts')}
          className="bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-1.5"
        >
          <span>+ Launch Campaign</span>
        </button>

        {/* System Alerts & Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowAlertsPopover(!showAlertsPopover)}
            className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all relative"
            title="System Alerts"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {alerts.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 absolute top-1.5 right-1.5 animate-pulse" />
            )}
          </button>

          {/* Alerts Popover */}
          {showAlertsPopover && (
            <div className="absolute right-0 mt-2 w-80 bg-[#121624] border border-white/10 rounded-2xl p-4 shadow-2xl z-50 space-y-3">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">System Notifications</span>
                <span className="text-[10px] text-slate-500">{alerts.length} Active</span>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2 text-center">No unhandled system alerts.</p>
                ) : (
                  alerts.map((a, idx) => (
                    <div key={idx} className="p-2.5 bg-white/5 rounded-xl border border-white/5 text-xs text-slate-300">
                      <div className="font-semibold text-rose-400">{a.title || 'System Warning'}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{a.message || a}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
