"use client";

export default function MetricsKpiGrid({ metrics = {} }) {
  const cards = [
    {
      title: 'TOTAL LEADS',
      value: (metrics.totalLeads ?? 0).toLocaleString(),
      subText: 'Database total lead count',
      color: 'cyan',
      icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z'
    },
    {
      title: 'CALLS TODAY',
      value: (metrics.callsToday ?? 0).toLocaleString(),
      subText: `${metrics.connectedCalls ?? 0} connected (${metrics.connectionRate || '0.0%'})`,
      color: 'indigo',
      icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'
    },
    {
      title: 'MEETINGS BOOKED',
      value: (metrics.meetingsBooked ?? 0).toLocaleString(),
      subText: 'Total interested & booked',
      color: 'emerald',
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
    },
    {
      title: 'EMAILS SENT',
      value: (metrics.emailsSent ?? 0).toLocaleString(),
      subText: `Reply Rate: ${metrics.replyRate || '0.0%'}`,
      color: 'cyan',
      icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
    },
    {
      title: 'ACTIVE AGENTS',
      value: `${metrics.activeAgents ?? 0} Online`,
      subText: 'Real-time agent presence',
      color: 'amber',
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
    },
    {
      title: 'RUNNING CAMPAIGNS',
      value: (metrics.runningCampaigns ?? 0).toString(),
      subText: 'Active queue dispatches',
      color: 'indigo',
      icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className="bg-[#121624] border border-white/6 hover:border-white/15 rounded-2xl p-4 transition-all duration-200 shadow-lg shadow-black/20 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{card.title}</span>
            <div className={`p-1.5 rounded-lg bg-${card.color}-500/10 text-${card.color}-400 border border-${card.color}-500/20`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xl font-black text-white tracking-tight">{card.value}</div>
            {card.subText ? (
              <div className="text-[11px] text-slate-400 font-medium mt-1">{card.subText}</div>
            ) : card.trend ? (
              <div className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                <span>↑</span> {card.trend}
              </div>
            ) : null}
          </div>

          {/* Mini Sparkline Visualization SVG */}
          <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
            <span className="text-[10px] text-slate-600 font-mono">24h pace</span>
            <svg className="w-16 h-4 text-cyan-400" viewBox="0 0 60 15" fill="none">
              <path
                d="M0 12 L10 9 L20 11 L30 5 L40 7 L50 2 L60 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
