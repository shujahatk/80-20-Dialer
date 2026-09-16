"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

import CollapsibleSidebar from './components/CollapsibleSidebar';
import AdminHeader from './components/AdminHeader';
import MetricsKpiGrid from './components/MetricsKpiGrid';
import OutboundActivityChart from './components/OutboundActivityChart';
import ChannelDonutChart from './components/ChannelDonutChart';
import AgentPresencePanel from './components/AgentPresencePanel';
import LiveCallActivityFeed from './components/LiveCallActivityFeed';
import BlastEngineSettingsCard from '@/components/BlastEngineSettingsCard';
import { useRealtimeEventBus } from '@/hooks/useRealtimeEventBus';

export default function Dashboard() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  // Auth User
  const [user, setUser] = useState(null);

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
  const [liveCalls, setLiveCalls] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
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

  useAuthenticatedEffect((sessionUser) => {
    setIsMounted(true);
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) {
      router.push('/login');
      return;
    }
    try {
      const parsedUser = sessionUser;
      if (parsedUser.role === 'salesperson') {
        router.push('/workstation');
        return;
      }
      setUser(parsedUser);
    } catch {
      router.push('/login');
      return;
    }

    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam) setActiveTab(tabParam);
    }

    fetchAllData();
    // Passive background sync fallback (every 60s) - Real-time updates handled instantly by Realtime Event Bus
    const interval = setInterval(fetchSilentData, 60000);
    return () => clearInterval(interval);
  }, [router]);

  // Real-time Event Bus Subscription (0ms instant sync across all tabs & remote clients)
  useRealtimeEventBus((event) => {
    const { eventType, payload, timestamp } = event;
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    // 1. CALL EVENTS
    if (eventType === 'call.started') {
      const repName = payload?.userName || 'Sales Rep';
      const leadName = payload?.leadName || payload?.leadPhone || 'Lead';
      const callData = {
        callSid: payload?.callSid || `call_${Date.now()}`,
        leadId: payload?.leadId,
        leadName: payload?.leadName,
        leadPhone: payload?.leadPhone,
        userId: payload?.userId,
        userName: repName,
        status: payload?.status || 'dialing',
        startedAt: timestamp || new Date().toISOString()
      };
      setLiveCalls(prev => [callData, ...prev.filter(c => c.callSid !== callData.callSid)]);
      setMetrics(prev => ({
        ...prev,
        callsToday: (prev.callsToday || 0) + 1
      }));
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'call.started',
          title: `${repName} → Called ${leadName}`,
          detail: `Dialing...`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'call.ringing') {
      setLiveCalls(prev => prev.map(c => (c.callSid === payload?.callSid || c.leadId === payload?.leadId) ? { ...c, status: 'ringing' } : c));
    } else if (eventType === 'call.connected') {
      const repName = payload?.userName || 'Sales Rep';
      const leadName = payload?.leadName || payload?.leadPhone || 'Lead';
      setLiveCalls(prev => prev.map(c => (c.callSid === payload?.callSid || c.leadId === payload?.leadId) ? { ...c, status: 'connected', answeredAt: timestamp || new Date().toISOString() } : c));
      setMetrics(prev => {
        const newConn = (prev.connectedCalls || 0) + 1;
        const total = prev.callsToday || 1;
        return {
          ...prev,
          connectedCalls: newConn,
          connectionRate: `${((newConn / total) * 100).toFixed(1)}%`
        };
      });
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'call.connected',
          title: `${repName} → Called ${leadName}`,
          detail: `Connected • Live Audio Active`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'call.completed') {
      setLiveCalls(prev => prev.filter(c => c.callSid !== payload?.callSid && c.leadId !== payload?.leadId));
      const repName = payload?.userName || 'Sales Rep';
      const leadName = payload?.leadName || payload?.leadPhone || 'Lead';
      const durationSec = payload?.duration ? `${Math.floor(payload.duration / 60)}:${(payload.duration % 60).toString().padStart(2, '0')}` : 'Ended';
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'call.completed',
          title: `${repName} → Called ${leadName}`,
          detail: `Completed • ${durationSec}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    }

    // 2. SMS EVENTS
    else if (eventType === 'sms.sent') {
      const repName = payload?.user?.name || payload?.userName || 'Sales Rep';
      setMetrics(prev => ({
        ...prev,
        smsSent: (prev.smsSent || 0) + 1
      }));
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'sms.sent',
          title: `${repName} → Sent SMS`,
          detail: `To: ${payload?.to || 'Contact'} • Delivered`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    }

    // 3. EMAIL EVENTS
    else if (eventType === 'email.sent') {
      const repName = payload?.user?.name || payload?.userName || 'Sales Rep';
      setMetrics(prev => ({
        ...prev,
        emailsSent: (prev.emailsSent || 0) + 1
      }));
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'email.sent',
          title: `${repName} → Sent Email`,
          detail: `To: ${payload?.to || 'Contact'} • Dispatched`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'email.delivered') {
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'email.delivered',
          title: `Email Delivered`,
          detail: `To: ${payload?.email || payload?.to || 'Contact'}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'email.replied') {
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'email.replied',
          title: `🔥 Inbound Reply Received!`,
          detail: `From: ${payload?.email || payload?.from || 'Lead'}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    }

    // 4. LEAD & DISPOSITION EVENTS
    else if (eventType === 'lead.stage_changed') {
      const repName = payload?.updatedBy || 'Sales Rep';
      const leadName = payload?.lead?.name || payload?.leadId || 'Contact';
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'lead.stage_changed',
          title: `${repName} → Moved ${leadName}`,
          detail: `${payload?.previousStage || 'Previous'} → ${payload?.stage || 'New Stage'}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
      setLeads(prev => prev.map(l => (l._id === payload?.leadId || l.id === payload?.leadId) ? { ...l, stage: payload.stage } : l));
    } else if (eventType === 'lead.disposition_changed') {
      const repName = payload?.user?.name || 'Sales Rep';
      const leadName = payload?.lead?.name || 'Contact';
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'lead.disposition',
          title: `${repName} → Logged Disposition`,
          detail: `${leadName} • ${payload?.outcome || 'Outcome'}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'meeting.booked') {
      const repName = payload?.user?.name || 'Sales Rep';
      const leadName = payload?.lead?.name || 'Prospect';
      setMetrics(prev => ({
        ...prev,
        meetingsBooked: (prev.meetingsBooked || 0) + 1
      }));
      setRecentActivity(prev => [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          type: 'meeting.booked',
          title: `🎉 ${repName} → Booked Meeting!`,
          detail: `Lead: ${leadName}`,
          time: timeStr
        },
        ...prev.slice(0, 19)
      ]);
    } else if (eventType === 'user.heartbeat') {
      if (payload?.user) {
        setOnlineUsers(prev => {
          const exists = prev.some(u => String(u._id || u.id) === String(payload.user.id));
          if (!exists) {
            return [...prev, { _id: payload.user.id, name: payload.user.name, email: payload.user.email, role: payload.user.role, isOnline: true }];
          }
          return prev;
        });
      }
    }
  });

  async function fetchSilentData() {
    try {
      const [
        metricsRes,
        boardRes,
        leadsRes,
        alertsRes,
        onlineRes
      ] = await Promise.all([
        apiRequest('/api/manager/metrics').catch(() => ({ success: false })),
        apiRequest('/api/manager/leaderboard').catch(() => ({ success: false })),
        apiRequest('/api/leads').catch(() => ({ success: false })),
        apiRequest('/api/manager/alerts').catch(() => ({ success: false })),
        apiRequest('/api/session/online').catch(() => ({ success: false }))
      ]);

      if (metricsRes.success && metricsRes.data) setMetrics(metricsRes.data);
      if (boardRes.success && boardRes.data) setTeamLeaderboard(boardRes.data);
      if (leadsRes.success && leadsRes.data) setLeads(leadsRes.data);
      if (alertsRes.success && alertsRes.data) setAlerts(alertsRes.data);
      if (onlineRes.success && onlineRes.data) setOnlineUsers(onlineRes.data);
    } catch (e) {}
  }

  async function fetchAllData() {
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

      const activeSalesUsers = (usersRes.success && Array.isArray(usersRes.data))
        ? usersRes.data.filter(u => u.role === 'salesperson' && u.approved !== false)
        : [];

      const initialInboxes = [
        {
          _id: 'default',
          name: 'Primary Outbound Identity (Resend)',
          fromEmail: 'outreach@8020acquisition.com',
          fromName: '80/20 Acquisition',
          dailyLimit: 500,
          sentToday: metricsRes.data?.emailsSent || 0,
          status: 'active',
          domainStatus: 'verified'
        },
        ...activeSalesUsers.map(u => ({
          _id: String(u._id || u.id),
          name: `${u.name} (Sales Identity)`,
          fromEmail: u.email || `${u.name.toLowerCase()}@8020acquisition.com`,
          fromName: `${u.name} | 80/20 Acquisition`,
          dailyLimit: 100,
          sentToday: 0,
          status: 'active',
          domainStatus: 'verified'
        }))
      ];

      setInboxes(initialInboxes);
    } catch (err) {
      console.error('Dashboard error loading data:', err);
    } finally {
      setStatsLoading(false);
    }
  }

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

  // 0ms Instant Optimistic Actions
  async function handleApproveUser(userId) {
    // Instant 0ms local state update
    setRegisteredUsers(prev => prev.map(u => u._id === userId ? { ...u, approved: true } : u));
    try {
      await apiRequest('/api/manager/users', 'PUT', { userId, action: 'approve' });
    } catch (err) { alert(err.message || 'Approval failed'); }
  }

  async function handleRoleChange(userId, role) {
    // Instant 0ms local state update
    setRegisteredUsers(prev => prev.map(u => u._id === userId ? { ...u, role } : u));
    try {
      await apiRequest('/api/manager/users', 'PUT', { userId, action: 'role', role });
    } catch (err) { alert(err.message || 'Role update failed'); }
  }

  async function handleRejectUser(userId) {
    if (!confirm('Remove this user from the system?')) return;
    // Instant 0ms local state update
    setRegisteredUsers(prev => prev.filter(u => u._id !== userId));
    try {
      await apiRequest(`/api/manager/users?userId=${userId}`, 'DELETE');
    } catch (err) { alert(err.message || 'Removal failed'); }
  }

  async function handleSaveSettings(e) {
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
  }

  async function handleReassignLead(leadId, newAssigneeId) {
    // Instant 0ms local state update
    setLeads(prev => prev.map(l => (l._id === leadId || l.id === leadId) ? { ...l, assignedTo: newAssigneeId, assigned_to: newAssigneeId } : l));
    try {
      await apiRequest(`/api/leads/${leadId}`, 'PUT', { assignedTo: newAssigneeId || null });
    } catch (err) {
      alert(err.message || 'Failed to reassign lead.');
    }
  }

  async function handleCsvUpload(e) {
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
        // Refresh leads list in background
        const leadsRes = await apiRequest('/api/leads').catch(() => ({ success: false }));
        if (leadsRes.success && leadsRes.data) setLeads(leadsRes.data);
      }
    } catch (err) { setUploadError(err.message || 'Import failed.'); }
    finally { setUploading(false); }
  }

  if (!isMounted || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#07090e] text-slate-100 font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 text-xs animate-pulse">Authenticating management console...</p>
        </div>
      </div>
    );
  }

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

              {/* Leaderboard, Live Call Stream & Agent Presence */}
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
                          teamLeaderboard.map((agent, i) => (
                            <tr key={agent._id || i} className="hover:bg-white/[0.02]">
                              <td className="p-2.5 font-bold text-cyan-400">0{i + 1}</td>
                              <td className="p-2.5 font-medium text-white flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center font-bold text-[10px] text-slate-200">
                                  {agent.name?.[0]?.toUpperCase() || 'A'}
                                </div>
                                <div>
                                  <div className="font-semibold text-white">{agent.name}</div>
                                  <div className="text-[10px] text-slate-500 font-mono">{agent.email}</div>
                                </div>
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

                {/* Live Call Stream & Agent Presence Column */}
                <div className="lg:col-span-1 space-y-6">
                  <LiveCallActivityFeed liveCalls={liveCalls} recentActivity={recentActivity} />
                  <AgentPresencePanel onlineUsers={onlineUsers} leaderboard={teamLeaderboard} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TEAM ACCESS & APPROVALS */}
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

          {/* TAB 4: OUTBOUND EMAIL SENDING INBOXES */}
          {activeTab === 'inboxes' && (
            <div className="space-y-6">
              {/* Monthly Global Capacity Pool Banner (50,000 Total Allocation) */}
              <div className="bg-gradient-to-r from-[#121624] via-[#161c2e] to-[#121624] border border-cyan-500/20 rounded-2xl p-6 shadow-xl shadow-cyan-500/5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/8 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                      <h2 className="text-base font-bold text-white tracking-tight">
                        Resend Outbound Monthly Pool &amp; Capacity
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Shared 50,000 emails/month plan. No artificial daily caps configured — all reps can send dynamically.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                      50,000 Total Monthly Pool
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#07090e] p-3.5 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Monthly Allocation</span>
                    <div className="text-xl font-black text-white mt-1">50,000</div>
                    <span className="text-[10px] text-slate-500">Resend Relay Pool</span>
                  </div>
                  <div className="bg-[#07090e] p-3.5 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Dispatched This Month</span>
                    <div className="text-xl font-black text-cyan-400 font-mono mt-1">
                      {(metrics.emailsSent || 0).toLocaleString()}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">Real-time team total</span>
                  </div>
                  <div className="bg-[#07090e] p-3.5 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Available Remaining</span>
                    <div className="text-xl font-black text-emerald-400 font-mono mt-1">
                      {Math.max(0, 50000 - (metrics.emailsSent || 0)).toLocaleString()}
                    </div>
                    <span className="text-[10px] text-emerald-400/80 font-medium">Ready for dispatch</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-400">
                    <span>Monthly Pool Usage:</span>
                    <span className="font-mono text-cyan-300">
                      {(metrics.emailsSent || 0).toLocaleString()} / 50,000 ({(((metrics.emailsSent || 0) / 50000) * 100).toFixed(2)}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-[#07090e] border border-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(1, ((metrics.emailsSent || 0) / 50000) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Rep Outbound Identities */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Configured Outbound Sending Identities ({inboxes.length})
                  </h3>
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full uppercase font-bold">
                    ✓ No Daily Limits Enforced
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {inboxes.map(inbox => {
                    const repStats = teamLeaderboard.find(a => a._id === inbox._id || a.email?.toLowerCase() === inbox.fromEmail?.toLowerCase());
                    const repSentToday = repStats?.emailsSent || inbox.sentToday || 0;

                    return (
                      <div key={inbox._id} className="bg-[#07090e] p-4 rounded-xl border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-white text-sm">{inbox.name}</div>
                            <div className="text-xs text-cyan-400 font-mono mt-0.5">{inbox.fromEmail}</div>
                          </div>
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full">
                            {inbox.domainStatus || 'Verified'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-white/[0.02] rounded-lg border border-white/5 text-xs">
                          <span className="text-slate-400">Sent Today:</span>
                          <span className="font-mono font-bold text-white">{repSentToday} emails</span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Daily Limit: <strong className="text-emerald-400 font-normal">None (Unlimited)</strong></span>
                          <span>Pool: <strong className="text-slate-300 font-normal">50k Shared</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: DIALER & SYSTEM CONFIG */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-3xl">
              <BlastEngineSettingsCard />

              <form onSubmit={handleSaveSettings} className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-5 shadow-lg shadow-black/20">
                <h2 className="text-lg font-bold text-white">Dialer & Operational Configuration</h2>

                {settingsSuccess && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl">
                    {settingsSuccess}
                  </div>
                )}

                <div className="space-y-4">
                  <label className="flex items-center justify-between bg-[#07090e] p-3.5 rounded-xl border border-white/5 cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-white block">Enable Call Recording</span>
                      <span className="text-[11px] text-slate-400">Record WebRTC call audio for quality and compliance.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.callRecordingEnabled}
                      onChange={e => setSettings({ ...settings, callRecordingEnabled: e.target.checked })}
                      className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                    />
                  </label>

                  {/* Operational Calling & Emailing Hours in AM / PM */}
                  <div className="bg-[#080b12] p-4 rounded-xl border border-white/5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-2">
                      <div>
                        <span className="text-xs font-bold text-white block">🕒 Operational Hours (AM / PM Enforcement)</span>
                        <span className="text-[11px] text-slate-400">
                          Strictly enforces calling, SMS, and email blast limits across all sales agents in real-time.
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                        Real-time Guard Active
                      </span>
                    </div>

                    {/* Quick Presets */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Presets:</span>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, allowedHoursStart: 9, allowedHoursEnd: 17 })}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5 transition-colors cursor-pointer"
                      >
                        9:00 AM – 5:00 PM
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, allowedHoursStart: 8, allowedHoursEnd: 20 })}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5 transition-colors cursor-pointer"
                      >
                        8:00 AM – 8:00 PM
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, allowedHoursStart: 0, allowedHoursEnd: 24 })}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-cyan-400 border border-cyan-500/20 transition-colors cursor-pointer"
                      >
                        24/7 (No Limit)
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">Start Allowed Time (AM/PM)</label>
                        <select
                          value={settings.allowedHoursStart ?? 8}
                          onChange={e => setSettings({ ...settings, allowedHoursStart: parseInt(e.target.value, 10) })}
                          className="w-full bg-[#121624] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                        >
                          {[
                            { value: 0, label: '12:00 AM (Midnight)' },
                            { value: 1, label: '01:00 AM' },
                            { value: 2, label: '02:00 AM' },
                            { value: 3, label: '03:00 AM' },
                            { value: 4, label: '04:00 AM' },
                            { value: 5, label: '05:00 AM' },
                            { value: 6, label: '06:00 AM' },
                            { value: 7, label: '07:00 AM' },
                            { value: 8, label: '08:00 AM' },
                            { value: 9, label: '09:00 AM' },
                            { value: 10, label: '10:00 AM' },
                            { value: 11, label: '11:00 AM' },
                            { value: 12, label: '12:00 PM (Noon)' },
                            { value: 13, label: '01:00 PM' },
                            { value: 14, label: '02:00 PM' },
                            { value: 15, label: '03:00 PM' },
                            { value: 16, label: '04:00 PM' },
                            { value: 17, label: '05:00 PM' },
                            { value: 18, label: '06:00 PM' },
                            { value: 19, label: '07:00 PM' },
                            { value: 20, label: '08:00 PM' },
                            { value: 21, label: '09:00 PM' },
                            { value: 22, label: '10:00 PM' },
                            { value: 23, label: '11:00 PM' }
                          ].map(opt => (
                            <option key={`start-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">End Allowed Time (AM/PM)</label>
                        <select
                          value={settings.allowedHoursEnd ?? 18}
                          onChange={e => setSettings({ ...settings, allowedHoursEnd: parseInt(e.target.value, 10) })}
                          className="w-full bg-[#121624] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                        >
                          {[
                            { value: 1, label: '01:00 AM' },
                            { value: 2, label: '02:00 AM' },
                            { value: 3, label: '03:00 AM' },
                            { value: 4, label: '04:00 AM' },
                            { value: 5, label: '05:00 AM' },
                            { value: 6, label: '06:00 AM' },
                            { value: 7, label: '07:00 AM' },
                            { value: 8, label: '08:00 AM' },
                            { value: 9, label: '09:00 AM' },
                            { value: 10, label: '10:00 AM' },
                            { value: 11, label: '11:00 AM' },
                            { value: 12, label: '12:00 PM (Noon)' },
                            { value: 13, label: '01:00 PM' },
                            { value: 14, label: '02:00 PM' },
                            { value: 15, label: '03:00 PM' },
                            { value: 16, label: '04:00 PM' },
                            { value: 17, label: '05:00 PM' },
                            { value: 18, label: '06:00 PM' },
                            { value: 19, label: '07:00 PM' },
                            { value: 20, label: '08:00 PM' },
                            { value: 21, label: '09:00 PM' },
                            { value: 22, label: '10:00 PM' },
                            { value: 23, label: '11:00 PM' },
                            { value: 24, label: '12:00 AM (Midnight / End of Day)' }
                          ].map(opt => (
                            <option key={`end-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">CRM Webhook Endpoint URL</label>
                    <input
                      type="url"
                      value={settings.crmWebhookUrl || ''}
                      onChange={e => setSettings({ ...settings, crmWebhookUrl: e.target.value })}
                      placeholder="https://your-crm.com/api/webhook"
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition-all cursor-pointer flex items-center gap-2"
                >
                  {savingSettings ? 'Saving Configuration...' : '💾 Save Configuration'}
                </button>
              </form>
            </div>
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

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Assign Uploaded Leads To (Optional)</label>
                  <select
                    value={uploadAssigneeId}
                    onChange={e => setUploadAssigneeId(e.target.value)}
                    className="w-full bg-[#07090e] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
                  >
                    <option value="">-- Unassigned (Available in Pool) --</option>
                    {registeredUsers.filter(u => u.approved !== false).map(u => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.role}) - {u.email}
                      </option>
                    ))}
                  </select>
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
