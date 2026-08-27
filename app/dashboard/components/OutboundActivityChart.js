"use client";

import { useState } from 'react';

export default function OutboundActivityChart() {
  const [channelFilter, setChannelFilter] = useState('calls'); // 'calls' | 'emails' | 'sms' | 'whatsapp'
  const [timeframe, setTimeframe] = useState('7d'); // 'today' | '7d' | '30d' | '90d'

  // Mocked SVG spark/wave points based on timeframe selection
  const chartPoints = timeframe === 'today'
    ? '0,80 15,60 30,75 45,40 60,50 75,20 90,35 100,15'
    : timeframe === '30d'
    ? '0,90 15,70 30,60 45,65 60,30 75,40 90,20 100,10'
    : '0,70 15,45 30,55 45,30 60,40 75,15 90,25 100,10';

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">Outbound Activity Analytics</h3>
          <p className="text-xs text-slate-400 mt-0.5">Real-time throughput and connection trend overview</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Channel selector */}
          <div className="flex bg-[#07090e] p-1 rounded-xl border border-white/5 text-xs">
            {['calls', 'emails', 'sms', 'whatsapp'].map(ch => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2.5 py-1 rounded-lg capitalize font-semibold transition-all ${
                  channelFilter === ch ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Timeframe selector */}
          <select
            value={timeframe}
            onChange={e => setTimeframe(e.target.value)}
            className="bg-[#07090e] border border-white/8 text-xs text-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* SVG Line Chart */}
      <div className="relative h-56 w-full pt-4">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Background Grid Lines */}
          <line x1="0" y1="20" x2="100" y2="20" stroke="#ffffff10" strokeDasharray="2" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="#ffffff10" strokeDasharray="2" />
          <line x1="0" y1="80" x2="100" y2="80" stroke="#ffffff10" strokeDasharray="2" />

          {/* Area Gradient */}
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <polygon points={`0,100 ${chartPoints} 100,100`} fill="url(#chartGradient)" />

          {/* Main Trend Line */}
          <polyline
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={chartPoints}
          />
        </svg>
      </div>

      {/* X Axis Labels */}
      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1 border-t border-white/5 pt-2">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
    </div>
  );
}
