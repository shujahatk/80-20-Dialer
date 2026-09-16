"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

import CollapsibleSidebar from '../components/CollapsibleSidebar';
import AdminHeader from '../components/AdminHeader';
import ActivityHistoryTable from '../components/ActivityHistoryTable';
import UserDetailModal from '../components/UserDetailModal';

const safeText = (val, fallback = '—') => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if (typeof val.name === 'string') return val.name;
    if (typeof val.company === 'string') return val.company;
    if (typeof val.title === 'string') return val.title;
    if (typeof val.label === 'string') return val.label;
    if (typeof val.value === 'string') return val.value;
    return fallback;
  }
  return String(val);
};

export default function AnalyticsHistoryPage() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [user, setUser] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectUser, setInspectUser] = useState(null);

  useAuthenticatedEffect((sessionUser) => {
    setIsMounted(true);
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) {
      router.push('/login');
      return;
    }
    if (sessionUser.role === 'salesperson') {
      router.push('/workstation');
      return;
    }
    setUser(sessionUser);
    loadOverviewData();
  }, [router]);

  async function loadOverviewData() {
    try {
      const [boardRes, metricsRes, alertsRes, onlineRes] = await Promise.all([
        apiRequest('/api/manager/leaderboard').catch(() => ({ data: [] })),
        apiRequest('/api/manager/metrics').catch(() => ({ data: {} })),
        apiRequest('/api/manager/alerts').catch(() => ({ data: [] })),
        apiRequest('/api/session/online').catch(() => ({ data: [] }))
      ]);

      if (boardRes.success && boardRes.data) setLeaderboard(boardRes.data);
      if (metricsRes.success && metricsRes.data) setMetrics(metricsRes.data);
      if (alertsRes.success && alertsRes.data) setAlerts(alertsRes.data);
      if (onlineRes.success && onlineRes.data) setOnlineUsers(onlineRes.data);
    } catch (e) {}
  }

  if (!isMounted || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#07090e] text-slate-100 font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 text-xs animate-pulse">Loading Analytics &amp; History...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-100 font-sans overflow-hidden">
      {/* 1. Collapsible Sidebar Navigation */}
      <CollapsibleSidebar
        activeTab="analytics"
        user={user}
        onlineCount={onlineUsers.length}
      />

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Admin Header */}
        <AdminHeader
          user={user}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          alerts={alerts}
          onRefresh={loadOverviewData}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Greeting & Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Team Analytics &amp; Activity History
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-dimensional communication intelligence with user-level attribution.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/dashboard')}
                className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-semibold text-xs border border-white/5 transition-colors cursor-pointer"
              >
                ← Back to Live Overview
              </button>
            </div>
          </div>

          {/* Salesperson Performance Matrix */}
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Sales Team Attribution &amp; Performance
                </h3>
              </div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase">
                Active Reps ({leaderboard.length})
              </span>
            </div>

            <div className="overflow-x-auto border border-white/5 rounded-xl bg-[#07090e]">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="p-3">Salesperson</th>
                    <th className="p-3 text-center">Calls Placed</th>
                    <th className="p-3 text-center">Connected</th>
                    <th className="p-3 text-center">Talk Time</th>
                    <th className="p-3 text-center">Emails Sent</th>
                    <th className="p-3 text-center">SMS Sent</th>
                    <th className="p-3 text-center">Meetings Booked</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-slate-500">
                        No sales agent activity data found.
                      </td>
                    </tr>
                  ) : (
                    leaderboard.map((rep) => (
                      <tr key={rep._id || rep.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-[10px] text-cyan-300">
                              {safeText(rep.name, 'R')[0]?.toUpperCase() || 'R'}
                            </div>
                            <div>
                              <div className="font-bold text-white">{safeText(rep.name, 'Salesperson')}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{safeText(rep.email, '')}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-white">{rep.callsToday || 0}</td>
                        <td className="p-3 text-center font-mono text-emerald-400 font-semibold">{rep.connectedCalls || 0}</td>
                        <td className="p-3 text-center font-mono text-cyan-400">
                          {rep.talkTimeSeconds ? `${Math.floor(rep.talkTimeSeconds / 60)}m ${rep.talkTimeSeconds % 60}s` : '0m'}
                        </td>
                        <td className="p-3 text-center font-mono">{rep.emailsSent || 0}</td>
                        <td className="p-3 text-center font-mono">{rep.smsSent || 0}</td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-400">{rep.booked || 0}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => setInspectUser(rep._id || rep.id)}
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 font-semibold text-[11px] transition-colors cursor-pointer"
                          >
                            View Drilldown →
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Activity History Table */}
          <ActivityHistoryTable />

        </main>
      </div>

      {/* User Detail Drilldown Modal */}
      {inspectUser && (
        <UserDetailModal
          isOpen={Boolean(inspectUser)}
          userId={inspectUser}
          onClose={() => setInspectUser(null)}
        />
      )}
    </div>
  );
}
