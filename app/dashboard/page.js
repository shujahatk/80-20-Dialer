"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

import CollapsibleSidebar from './components/CollapsibleSidebar';
import AdminHeader from './components/AdminHeader';
import MetricsKpiGrid from './components/MetricsKpiGrid';
import OutboundActivityChart from './components/OutboundActivityChart';
import ChannelDonutChart from './components/ChannelDonutChart';
import AgentPresencePanel from './components/AgentPresencePanel';
import SystemHealthMonitor from './components/SystemHealthMonitor';

export default function Dashboard() {
  const router = useRouter();

  // Auth User
  const [user, setUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) return null;
    try {
      return JSON.parse(localUser);
    } catch {
      return null;
    }
  });

  // Active View Tab: 'overview' | 'leads' | 'inboxes' | 'approvals' | 'settings' | 'upload'
  const [activeTab, setActiveTab] = useState('overview');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Data States
  const [metrics, setMetrics] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [teamLeaderboard, setTeamLeaderboard] = useState([]);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [settings, setSettings] = useState({
    callRecordingEnabled: false,
    allowedHoursStart: 8,
    allowedHoursEnd: 18,
    crmWebhookUrl: ''
  });

  // Form & Loading States
  const [statsLoading, setStatsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadCampaignId, setUploadCampaignId] = useState('');
  const [uploadAssigneeId, setUploadAssigneeId] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) { router.push('/login'); return; }
    const parsedUser = JSON.parse(localUser);
    if (parsedUser.role === 'salesperson') { router.push('/workstation'); return; }

    fetchAllData();
    const interval = setInterval(fetchAlertsAndOnline, 30000);
    return () => clearInterval(interval);
  }, [router]);

  const fetchAlertsAndOnline = async () => {
    try {
      const alertRes = await apiRequest('/api/manager/alerts');
      if (alertRes.success) setAlerts(alertRes.data);
      const onlineRes = await apiRequest('/api/session/online');
      if (onlineRes.success) setOnlineUsers(onlineRes.data);
    } catch (e) {}
  };

  const fetchAllData = async () => {
    setStatsLoading(true);
    try {
      const [
        metricsRes,
        usersRes,
        boardRes,
        configRes,
        leadsRes,
        campRes,
        alertsRes,
        onlineRes
      ] = await Promise.all([
        apiRequest('/api/manager/metrics').catch(() => ({ success: false })),
        apiRequest('/api/manager/users').catch(() => ({ success: false })),
        apiRequest('/api/manager/leaderboard').catch(() => ({ success: false })),
        apiRequest('/api/manager/config').catch(() => ({ success: false })),
        apiRequest('/api/leads').catch(() => ({ success: false })),
        apiRequest('/api/manager/blasts').catch(() => ({ success: false })),
        apiRequest('/api/manager/alerts').catch(() => ({ success: false })),
        apiRequest('/api/session/online').catch(() => ({ success: false }))
      ]);

      if (metricsRes.success && metricsRes.data) setMetrics(metricsRes.data);
      if (usersRes.success && usersRes.data) setRegisteredUsers(usersRes.data);
      if (boardRes.success && boardRes.data) setTeamLeaderboard(boardRes.data);
      if (configRes.success && configRes.data) setSettings(configRes.data);
      if (leadsRes.success && leadsRes.data) setLeads(leadsRes.data);
      if (campRes.success && campRes.data) setCampaigns(campRes.data);
      if (alertsRes.success && alertsRes.data) setAlerts(alertsRes.data);
      if (onlineRes.success && onlineRes.data) setOnlineUsers(onlineRes.data);

      setInboxes([
        { _id: 'default', name: 'Default Outbound Identity', fromEmail: 'onboarding@resend.dev', fromName: '80/20 Outbound', dailyLimit: 500, sentToday: 12, status: 'active', domainStatus: 'verified' }
      ]);
    } catch (err) {
      console.error('Dashboard error loading data:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    if (!searchQuery) return leads;
    const q = searchQuery.toLowerCase();
    return leads.filter(l =>
      (l.contact?.name || l.name || '').toLowerCase().includes(q) ||
      (l.company?.name || l.company || '').toLowerCase().includes(q) ||
      (l.contact?.email || l.email || '').toLowerCase().includes(q)
    );
  }, [leads, searchQuery]);

  // Actions
  const handleApproveUser = async (userId) => {
    // Instant optimistic update in local UI state
    setRegisteredUsers(prev => prev.map(u => u._id === userId ? { ...u, approved: true } : u));
    try {
      const res = await apiRequest('/api/manager/users', 'PUT', { userId, action: 'approve' });
      if (res.success) fetchAllData();
    } catch (err) { alert(err.message); fetchAllData(); }
  };

  const handleRoleChange = async (userId, role) => {
    setRegisteredUsers(prev => prev.map(u => u._id === userId ? { ...u, role } : u));
    try {
      const res = await apiRequest('/api/manager/users', 'PUT', { userId, action: 'role', role });
      if (res.success) fetchAllData();
    } catch (err) { alert(err.message); fetchAllData(); }
  };

  const handleRejectUser = async (userId) => {
    if (!confirm('Remove this user from the system?')) return;
    setRegisteredUsers(prev => prev.filter(u => u._id !== userId));
    try {
      const res = await apiRequest(`/api/manager/users?userId=${userId}`, 'DELETE');
      if (res.success) fetchAllData();
    } catch (err) { alert(err.message); fetchAllData(); }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccess('');
    try {
      const res = await apiRequest('/api/manager/config', 'PUT', settings);
      if (res.success) {
        setSettings(res.data);
        setSettingsSuccess('Configuration updated successfully.');
      }
    } catch (err) {
      alert(err.message || 'Failed to save config.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCsvUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) { setUploadError('Please choose a CSV file first.'); return; }
    setUploading(true); setUploadError(''); setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (uploadCampaignId) formData.append('campaignId', uploadCampaignId);
      if (uploadAssigneeId) formData.append('userId', uploadAssigneeId);
      const res = await apiRequest('/api/leads/upload', 'POST', formData, true);
      if (res.success) {
        setUploadResult(res.data); setSelectedFile(null);
        fetchAllData();
      }
    } catch (err) { setUploadError(err.message || 'Import failed.'); }
    finally { setUploading(false); }
  };

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-100 font-sans overflow-hidden">
      {/* 1. Left Collapsible Navigation Sidebar */}
      <CollapsibleSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        onlineCount={onlineUsers.length}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 2. Compact Admin Header */}
        <AdminHeader
          user={user}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          alerts={alerts}
          onRefresh={fetchAllData}
        />

        {/* Body Content Scrollable Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: OVERVIEW & PERFORMANCE */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Operational Greeting Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-white tracking-tight" suppressHydrationWarning>
                    Welcome back, {user?.name || 'Manager'}
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time operational dashboard for your outbound sales team.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-white/5 border border-white/8 px-3 py-1.5 rounded-xl text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-slate-300 font-semibold">Live System Online</span>
                </div>
              </div>

              {/* 8 Operational KPI Cards */}
              <MetricsKpiGrid metrics={metrics} />

              {/* Analytics Section: Outbound Time-Series & Channel Donut */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <OutboundActivityChart />
                </div>
                <div className="lg:col-span-1">
                  <ChannelDonutChart metrics={metrics} />
                </div>
              </div>

              {/* Leaderboard, Live Presence & Infrastructure Monitor */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Top Sales Agents Leaderboard */}
                <div className="lg:col-span-2 bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/20">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white tracking-tight">Top Performing Sales Agents</h3>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">Today Rank</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/5 text-slate-400">
                        <tr>
                          <th className="p-2.5">Rank</th>
                          <th className="p-2.5">Agent</th>
                          <th className="p-2.5 text-center">Calls</th>
                          <th className="p-2.5 text-center">Connected</th>
                          <th className="p-2.5 text-center">Booked</th>
                          <th className="p-2.5 text-center">Emails</th>
                          <th className="p-2.5 text-right">Reply Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {teamLeaderboard.length === 0 ? (
                          <tr><td colSpan={7} className="p-4 text-center text-slate-500">No agent performance data available yet.</td></tr>
                        ) : (
                          teamLeaderboard.slice(0, 5).map((agent, i) => (
                            <tr key={agent._id || i} className="hover:bg-white/[0.02]">
                              <td className="p-2.5 font-bold text-cyan-400">0{i + 1}</td>
                              <td className="p-2.5 font-medium text-white flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center font-bold text-[10px] text-slate-200">
                                  {agent.name?.[0]?.toUpperCase() || 'A'}
                                </div>
                                <span>{agent.name}</span>
                              </td>
                              <td className="p-2.5 text-center font-mono">{agent.callsToday}</td>
                              <td className="p-2.5 text-center font-mono text-emerald-400">{agent.connectedCalls}</td>
                              <td className="p-2.5 text-center font-mono font-bold text-emerald-400">{agent.booked}</td>
                              <td className="p-2.5 text-center font-mono">{agent.emailsSent}</td>
                              <td className="p-2.5 text-right font-mono font-bold text-cyan-400">{agent.replyRate}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Live Agent Presence Panel */}
                <div className="lg:col-span-1">
                  <AgentPresencePanel onlineUsers={onlineUsers} leaderboard={teamLeaderboard} />
                </div>
              </div>

              {/* Infrastructure Health Card */}
              <SystemHealthMonitor />
            </div>
          )}

          {/* TAB 2: ADMIN LEADS MANAGEMENT */}
          {activeTab === 'leads' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Leads Database & Routing</h2>
                  <p className="text-xs text-slate-400">Manage, assign, and audit lead records across the organization.</p>
                </div>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-xs px-4 py-2 rounded-xl"
                >
                  + Upload Lead CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-white/10 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Company</th>
                      <th className="p-3">Contact Details</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Assignee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {filteredLeads.length === 0 ? (
                      <tr><td colSpan={5} className="p-4 text-center text-slate-500">No leads found matching query.</td></tr>
                    ) : (
                      filteredLeads.slice(0, 25).map(lead => (
                        <tr key={lead._id} className="hover:bg-white/[0.02]">
                          <td className="p-3 font-semibold text-white">{lead.contact?.name || lead.name || 'N/A'}</td>
                          <td className="p-3">{lead.company?.name || lead.company || '—'}</td>
                          <td className="p-3">{lead.contact?.email || lead.email || 'No email'}</td>
                          <td className="p-3 capitalize">
                            <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-[11px]">
                              {lead.status || 'new'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-400">{lead.assignedTo?.name || 'Unassigned'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: TEAM ACCESS & APPROVALS */}
          {activeTab === 'approvals' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
              <h2 className="text-lg font-bold text-white">Team Access & User Role Governance</h2>

              <div className="overflow-x-auto border border-white/10 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="p-3">User Name</th>
                      <th className="p-3">Email Address</th>
                      <th className="p-3">Current Role</th>
                      <th className="p-3">Approval Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {registeredUsers.length === 0 ? (
                      <tr><td colSpan={5} className="p-4 text-center text-slate-500">No user accounts found.</td></tr>
                    ) : (
                      registeredUsers.map(u => (
                        <tr key={u._id} className="hover:bg-white/[0.02]">
                          <td className="p-3 font-semibold text-white">{u.name}</td>
                          <td className="p-3">{u.email}</td>
                          <td className="p-3">
                            <select
                              value={u.role}
                              onChange={e => handleRoleChange(u._id, e.target.value)}
                              className="bg-[#07090e] border border-white/10 text-xs text-white rounded-lg px-2 py-1"
                            >
                              <option value="salesperson">Salesperson</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                              <option value="owner">Owner</option>
                            </select>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              u.approved ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {u.approved ? 'Approved' : 'Pending Approval'}
                            </span>
                          </td>
                          <td className="p-3 text-right space-x-2">
                            {!u.approved && (
                              <button
                                onClick={() => handleApproveUser(u._id)}
                                className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs px-3 py-1 rounded-lg font-semibold"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => handleRejectUser(u._id)}
                              className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-xs px-3 py-1 rounded-lg font-semibold border border-rose-500/30"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: OUTBOUND EMAIL SENDING INBOXES */}
          {activeTab === 'inboxes' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
              <h2 className="text-lg font-bold text-white">Outbound Sending Identities & Inboxes</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {inboxes.map(inbox => (
                  <div key={inbox._id} className="bg-[#07090e] p-4 rounded-xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-white text-sm">{inbox.name}</div>
                        <div className="text-xs text-slate-400">{inbox.fromEmail}</div>
                      </div>
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full">
                        {inbox.domainStatus || 'Verified'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Daily Capacity:</span>
                        <span className="font-mono text-white">{inbox.sentToday} / {inbox.dailyLimit}</span>
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 rounded-full"
                          style={{ width: `${Math.min(100, (inbox.sentToday / inbox.dailyLimit) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: DIALER & SYSTEM CONFIG */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-5 shadow-lg shadow-black/20 max-w-2xl">
              <h2 className="text-lg font-bold text-white">Dialer & Operational Configuration</h2>

              {settingsSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl">
                  {settingsSuccess}
                </div>
              )}

              <div className="space-y-4">
                <label className="flex items-center justify-between bg-[#07090e] p-3 rounded-xl border border-white/5 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-white block">Enable Call Recording</span>
                    <span className="text-[11px] text-slate-400">Record WebRTC call audio for quality and compliance.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.callRecordingEnabled}
                    onChange={e => setSettings({ ...settings, callRecordingEnabled: e.target.checked })}
                    className="w-4 h-4 accent-cyan-500 rounded"
                  />
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Allowed Hours Start (24h)</label>
                    <input
                      type="number"
                      value={settings.allowedHoursStart}
                      onChange={e => setSettings({ ...settings, allowedHoursStart: e.target.value })}
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Allowed Hours End (24h)</label>
                    <input
                      type="number"
                      value={settings.allowedHoursEnd}
                      onChange={e => setSettings({ ...settings, allowedHoursEnd: e.target.value })}
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">CRM Webhook Endpoint URL</label>
                  <input
                    type="url"
                    value={settings.crmWebhookUrl || ''}
                    onChange={e => setSettings({ ...settings, crmWebhookUrl: e.target.value })}
                    placeholder="https://your-crm.com/api/webhook"
                    className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20"
              >
                {savingSettings ? 'Saving Settings...' : 'Save Configuration'}
              </button>
            </form>
          )}

          {/* TAB 6: CSV LEAD UPLOAD */}
          {activeTab === 'upload' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20 max-w-xl">
              <h2 className="text-lg font-bold text-white">Import Leads via CSV</h2>

              {uploadError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
                  {uploadError}
                </div>
              )}

              {uploadResult && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl space-y-1">
                  <p className="font-bold">Import Successful!</p>
                  <p>Imported: {uploadResult.importedCount} | Skipped: {uploadResult.skippedCount}</p>
                </div>
              )}

              <form onSubmit={handleCsvUpload} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Select CSV File *</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={e => setSelectedFile(e.target.files[0])}
                    className="w-full bg-[#07090e] border border-white/10 rounded-xl p-2 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20"
                >
                  {uploading ? 'Importing File...' : 'Start CSV Import'}
                </button>
              </form>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
