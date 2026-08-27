"use client";

export default function ChannelDonutChart({ metrics = {} }) {
  const emails = metrics.emailsSent || 0;
  const calls = metrics.callsToday || 0;
  const sms = metrics.smsSent || 0;
  const whatsapp = metrics.whatsappSent || 0;
  const total = emails + calls + sms + whatsapp;

  const getPct = (val) => total > 0 ? Math.round((val / total) * 100) + '%' : '0%';

  const channels = [
    { name: 'Email Blasts', pct: getPct(emails), count: emails.toLocaleString(), color: 'bg-cyan-500' },
    { name: 'Phone Calls', pct: getPct(calls), count: calls.toLocaleString(), color: 'bg-indigo-500' },
    { name: 'SMS Texts', pct: getPct(sms), count: sms.toLocaleString(), color: 'bg-emerald-500' },
    { name: 'WhatsApp', pct: getPct(whatsapp), count: whatsapp.toLocaleString(), color: 'bg-amber-500' }
  ];

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white tracking-tight">Activity by Channel</h3>
        <span className="text-[10px] font-semibold uppercase text-slate-500">Real 24h Data</span>
      </div>

      <div className="flex items-center justify-center py-3">
        {/* SVG Donut */}
        <div className="relative w-36 h-36 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="#ffffff0a"
              strokeWidth="3.8"
            />
            {total > 0 && (
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="3.8"
                strokeDasharray="100, 100"
              />
            )}
          </svg>
          <div className="absolute text-center">
            <span className="text-xl font-black text-white block">{total.toLocaleString()}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Touches</span>
          </div>
        </div>
      </div>

      {/* Legend list */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        {channels.map((ch, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${ch.color}`} />
              <span className="text-slate-300 font-medium">{ch.name}</span>
            </div>
            <div className="flex items-center gap-2 font-mono">
              <span className="text-slate-400">{ch.count}</span>
              <span className="text-white font-bold">{ch.pct}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
