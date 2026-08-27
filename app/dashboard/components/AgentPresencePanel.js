"use client";

export default function AgentPresencePanel({ onlineUsers = [], leaderboard = [] }) {
  const agentList = onlineUsers.length > 0 ? onlineUsers : leaderboard;

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <h3 className="text-sm font-bold text-white tracking-tight">Live Agent Presence</h3>
        </div>
        <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase">
          {onlineUsers.length} Active Online
        </span>
      </div>

      <div className="space-y-2">
        {agentList.map((agent, i) => {
          const isOnline = agent.isOnline !== undefined ? agent.isOnline : true;
          return (
            <div key={agent._id || i} className="flex items-center justify-between p-2.5 bg-[#07090e] rounded-xl border border-white/5 text-xs">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <div className="w-6 h-6 rounded-lg bg-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-200">
                  {agent.name?.[0]?.toUpperCase() || 'A'}
                </div>
                <div>
                  <div className="font-semibold text-white truncate max-w-[120px]">{agent.name}</div>
                  <div className="text-[10px] text-slate-500">{agent.callsToday || 0} calls placed</div>
                </div>
              </div>

              <div className="text-right">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                  agent.status === 'Calling' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                  agent.status === 'On Break' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                  agent.status === 'Offline' ? 'bg-slate-800 text-slate-500' :
                  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                }`}>
                  {agent.status || 'Available'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
