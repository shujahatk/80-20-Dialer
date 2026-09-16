"use client";

import { useState, useEffect } from 'react';

function CallDurationTimer({ startTime }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!startTime) return;
    const startMs = new Date(startTime).getTime();
    const update = () => {
      const now = Date.now();
      setSeconds(Math.max(0, Math.floor((now - startMs) / 1000)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return (
    <span className="font-mono text-emerald-400 font-bold">
      {mins}:{secs < 10 ? '0' : ''}{secs}
    </span>
  );
}

export default function LiveCallActivityFeed({ liveCalls = [], recentActivity = [] }) {
  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
          </span>
          <h3 className="text-sm font-bold text-white tracking-tight">Live Call Stream &amp; Activity</h3>
        </div>
        <div className="flex items-center gap-2">
          {liveCalls.length > 0 && (
            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 rounded-full uppercase animate-pulse">
              {liveCalls.length} Active Call{liveCalls.length > 1 ? 's' : ''}
            </span>
          )}
          <span className="text-[10px] font-semibold text-slate-500 uppercase">
            Realtime Bus
          </span>
        </div>
      </div>

      {/* Active Calls Section */}
      {liveCalls.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
            In-Progress Calls
          </div>
          {liveCalls.map((call) => (
            <div
              key={call.callSid || call.id || Math.random()}
              className="p-3 bg-[#0a0e18] border border-cyan-500/30 rounded-xl space-y-2 relative overflow-hidden transition-all shadow-md shadow-cyan-500/5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-bold text-white">
                    {call.leadName || call.leadPhone || 'Outbound Call'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {call.leadPhone || ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    call.status === 'in-progress' || call.status === 'connected'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : call.status === 'ringing'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  }`}>
                    {call.status}
                  </span>
                  {call.answeredAt && (
                    <CallDurationTimer startTime={call.answeredAt} />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Agent:</span>
                  <span className="text-slate-200 font-medium">{call.userName || call.repName || 'Sales Rep'}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {call.startedAt ? new Date(call.startedAt).toLocaleTimeString() : 'Just now'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Activity Log Stream */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          Recent Real-Time Events
        </div>
        {recentActivity.length === 0 && liveCalls.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 bg-[#07090e] rounded-xl border border-white/5">
            Waiting for live calls or outbound events...
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {recentActivity.slice(0, 10).map((act, idx) => (
              <div
                key={act.id || idx}
                className="flex items-center justify-between p-2 bg-[#07090e] rounded-lg border border-white/5 text-xs hover:border-white/10 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    act.type?.includes('call') ? 'bg-cyan-400' :
                    act.type?.includes('sms') ? 'bg-indigo-400' :
                    act.type?.includes('email') ? 'bg-purple-400' :
                    act.type?.includes('stage') ? 'bg-amber-400' :
                    'bg-emerald-400'
                  }`} />
                  <span className="font-semibold text-slate-200 truncate">{act.title}</span>
                  <span className="text-[10px] text-slate-500 truncate">{act.detail}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono flex-shrink-0 ml-2">
                  {act.time}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
