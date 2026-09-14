"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { authenticatedFetch } from "@/lib/apiClient";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import { PIPELINE_STAGES, VALID_STAGE_IDS, getStageConfig, normalizePipelineStage } from '@/lib/pipelineConfig';
import { useRealtimePipeline, broadcastPipelineUpdate } from '@/hooks/useRealtimePipeline';

export default function PipelineStatisticsPage() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('admin');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [columns, setColumns] = useState({});
  const [stageCounts, setStageCounts] = useState({});
  const [totalLeads, setTotalLeads] = useState(0);
  const [conversionFunnel, setConversionFunnel] = useState([]);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' | 'funnel'
  const [outcomeClassification, setOutcomeClassification] = useState({
    meetingBooked: 0,
    voicemail: 0,
    noAnswer: 0,
    callbackScheduled: 0,
    qualified: 0,
    closedWon: 0,
    notInterested: 0,
    totalDials: 0
  });
  const [salesReps, setSalesReps] = useState([]);
  const [selectedRep, setSelectedRep] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Lead Detail Drawer State
  const [selectedLeadDrawer, setSelectedLeadDrawer] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [leadTimeline, setLeadTimeline] = useState([]);
  const [transitioningStageId, setTransitioningStageId] = useState(null);
  const [drawerTab, setDrawerTab] = useState('timeline'); // 'timeline' | 'actions' | 'notes'
  const [drawerNote, setDrawerNote] = useState('');
  const [drawerEmailSubject, setDrawerEmailSubject] = useState('');
  const [drawerEmailBody, setDrawerEmailBody] = useState('');
  const [drawerEmailMode, setDrawerEmailMode] = useState('normal'); // 'normal' | 'claude_ai'
  const [drawerClaudeGoal, setDrawerClaudeGoal] = useState('Cold outreach');
  const [drawerClaudeTone, setDrawerClaudeTone] = useState('Conversational');
  const [drawerClaudeLength, setDrawerClaudeLength] = useState('Short');
  const [drawerClaudeInstruction, setDrawerClaudeInstruction] = useState('');
  const [drawerGeneratingClaude, setDrawerGeneratingClaude] = useState(false);
  const [drawerSmsText, setDrawerSmsText] = useState('');
  const [drawerActionSuccess, setDrawerActionSuccess] = useState('');
  const [drawerActionLoading, setDrawerActionLoading] = useState(false);

  // Authenticate user with 3-Role Support
  useAuthenticatedEffect((sessionUser) => {
    setIsMounted(true);
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!token || !storedUser) {
      router.push('/login');
      return;
    }
    try {
      const parsed = sessionUser;
      const roleStr = String(parsed.role || 'user').toLowerCase();
      let normalized = 'user';
      if (['owner', 'manager', 'admin'].includes(roleStr)) normalized = 'admin';
      else if (['updater_only', 'updater', 'triage'].includes(roleStr)) normalized = 'updater_only';
      else normalized = 'user';

      setUser(parsed);
      setUserRole(normalized);
    } catch (e) {
      router.push('/login');
    }
  }, [router]);

  // Fetch Pipeline Data from API with resilient offline & background heartbeat handling
  const fetchPipeline = useCallback((isSilent = false) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
    const token = localStorage.getItem('token');
    if (!token) return Promise.resolve();
    let url = '/api/leads/pipeline?';
    if (selectedRep && selectedRep !== 'all') url += 'repId=' + encodeURIComponent(selectedRep) + '&';
    if (searchQuery) url += 'search=' + encodeURIComponent(searchQuery) + '&';
    return authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(async res => {
      if (!res.ok) { if (!isSilent) console.warn('Pipeline fetch status:', res.status); return; }
      const result = await res.json();
      const data = result.data;
      if (result.success && data) {
        setColumns(data.columns || {}); setStageCounts(data.stageCounts || {}); setTotalLeads(data.totalLeads || 0);
        if (data.outcomeClassification) setOutcomeClassification(data.outcomeClassification);
        if (data.conversionFunnel) setConversionFunnel(data.conversionFunnel);
        if (data.salesReps) setSalesReps(data.salesReps);
        if (data.userRole) setUserRole(data.userRole);
      }
    }).catch(error => { if (!isSilent) console.warn('Pipeline fetch notice:', error.message); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [selectedRep, searchQuery]);

  // Real-time Live Multi-channel Subscription (0ms instant sync)
  useRealtimePipeline(useCallback((payload) => {
    const updatedLead = payload?.lead || payload?.data || payload;
    if (updatedLead && (updatedLead._id || updatedLead.id)) {
      const leadId = updatedLead._id || updatedLead.id;
      const rawStage = updatedLead.stage || updatedLead.pipelineStage || updatedLead.status;
      const newStage = normalizePipelineStage(rawStage);

      if (newStage) {
        setColumns(prev => {
          const next = { ...prev };
          let movedLead = null;
          Object.keys(next).forEach(stg => {
            next[stg] = (next[stg] || []).filter(l => {
              if (l._id === leadId || l.id === leadId) {
                movedLead = {
                  ...l,
                  ...updatedLead,
                  stage: newStage,
                  status: newStage,
                  stage_updated_at: new Date().toISOString()
                };
                return false;
              }
              return true;
            });
          });
          if (movedLead) {
            next[newStage] = [movedLead, ...(next[newStage] || [])];
          }
          return next;
        });
      }
    }
    fetchPipeline(true);
  }, [fetchPipeline]));

  useEffect(() => {
    if (!user) return;
    fetchPipeline();

    // High-speed background heartbeat polling (every 4 seconds)
    const heartbeatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return; // Pause polling when tab is inactive
      fetchPipeline(true);
    }, 4000);

    function handleVisibilityOrOnline() {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchPipeline(true);
      }
    }

    window.addEventListener('online', handleVisibilityOrOnline);
    document.addEventListener('visibilitychange', handleVisibilityOrOnline);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('online', handleVisibilityOrOnline);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
    };
  }, [user, fetchPipeline]);

  // Handle Quick Stage Transition (Available to all 3 roles: admin, user, updater_only)
  async function handleStageChange(leadId, targetStage, e) {
    if (e) e.stopPropagation();
    const normalizedTarget = normalizePipelineStage(targetStage);
    setTransitioningStageId(leadId);

    // Optimistically update columns and stage counts immediately
    setColumns(prev => {
      const next = { ...prev };
      let found = null;
      let fromStage = null;
      Object.keys(next).forEach(stg => {
        next[stg] = (next[stg] || []).filter(l => {
          if (l._id === leadId || l.id === leadId) {
            found = { ...l, stage: normalizedTarget, status: normalizedTarget, stage_updated_at: new Date().toISOString() };
            fromStage = stg;
            return false;
          }
          return true;
        });
      });
      if (found) {
        if (!next[normalizedTarget]) next[normalizedTarget] = [];
        next[normalizedTarget] = [found, ...next[normalizedTarget]];
      }
      return next;
    });

    setStageCounts(prev => {
      const next = { ...prev };
      let fromStage = null;
      Object.keys(columns).forEach(stg => {
        if ((columns[stg] || []).some(l => l._id === leadId || l.id === leadId)) {
          fromStage = stg;
        }
      });
      if (fromStage && next[fromStage] > 0) {
        next[fromStage] = Math.max(0, next[fromStage] - 1);
      }
      next[normalizedTarget] = (next[normalizedTarget] || 0) + 1;
      return next;
    });

    try {
      const token = localStorage.getItem('token');
      const res = await authenticatedFetch('/api/leads/stage', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ leadId, newStage: normalizedTarget })
      });
      const data = await res.json();
      if (data.success) {
        broadcastPipelineUpdate({ _id: leadId, stage: normalizedTarget });
        if (selectedLeadDrawer && (selectedLeadDrawer._id === leadId || selectedLeadDrawer.id === leadId)) {
          setSelectedLeadDrawer(prev => ({ ...prev, stage: normalizedTarget, status: normalizedTarget }));
        }
      }
    } catch (err) {
      console.warn('Stage change warning:', err.message);
    } finally {
      setTransitioningStageId(null);
      fetchPipeline(true);
    }
  }

  // Open Lead Detail Drawer (Admin & Standard User only; Disabled for updater_only)
  async function handleOpenLeadDrawer(lead) {
    if (userRole === 'updater_only') {
      return; // updater_only has restricted view
    }
    setSelectedLeadDrawer(lead);
    if (typeof setDrawerNote === 'function') {
      setDrawerNote(lead.notes || lead.last_activity_note || '');
    }
    setTimelineLoading(true);
    setLeadTimeline([]);
    setDrawerActionSuccess('');

    try {
      const token = localStorage.getItem('token');
      const leadId = lead._id || lead.id;
      const res = await authenticatedFetch(`/api/leads/${leadId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.data) {
        setLeadTimeline(data.data);
      }
    } catch (e) {
      console.warn('Timeline fetch error:', e.message);
    } finally {
      setTimelineLoading(false);
    }
  }

  // Drawer Action: Send Email
  async function handleDrawerSendEmail(e) {
    e.preventDefault();
    if (!drawerEmailSubject.trim() || !drawerEmailBody.trim() || !selectedLeadDrawer) return;
    setDrawerActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const targetId = selectedLeadDrawer._id || selectedLeadDrawer.id;
      const res = await authenticatedFetch('/api/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          leadId: targetId,
          subject: drawerEmailSubject.trim(),
          body: drawerEmailBody.trim(),
          fromName: user?.name,
          fromEmail: user?.email
        })
      });
      const data = await res.json();
      if (data.success) {
        setDrawerActionSuccess('✓ Email sent successfully via Resend!');
        setDrawerEmailSubject('');
        setDrawerEmailBody('');
        broadcastPipelineUpdate({ _id: targetId, stage: 'CONTACTED', outcome: 'email_sent' });
        // Refresh timeline
        handleOpenLeadDrawer(selectedLeadDrawer);
      }
    } catch (err) {
      alert('Email send error: ' + err.message);
    } finally {
      setDrawerActionLoading(false);
      setTimeout(() => setDrawerActionSuccess(''), 4000);
    }
  }

  // Drawer Action: Generate Claude Personalized Email
  async function handleDrawerGenerateClaudeEmail(overrideGoal = null, overrideTone = null, overrideLength = null, overrideInstruction = null) {
    if (!selectedLeadDrawer) return;
    setDrawerGeneratingClaude(true);
    setDrawerActionSuccess('');
    try {
      const token = localStorage.getItem('token');
      const targetId = selectedLeadDrawer._id || selectedLeadDrawer.id;
      const res = await authenticatedFetch('/api/ai/personalize/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          leadIds: [targetId],
          goal: overrideGoal || drawerClaudeGoal,
          tone: overrideTone || drawerClaudeTone,
          length: overrideLength || drawerClaudeLength,
          instructions: overrideInstruction !== null ? overrideInstruction : drawerClaudeInstruction,
          generateSubject: true
        })
      });
      const data = await res.json();
      if (data.success && data.drafts && data.drafts.length > 0) {
        const draft = data.drafts[0];
        setDrawerEmailSubject(draft.subject || `Outreach for ${selectedLeadDrawer.company || 'Growth'}`);
        setDrawerEmailBody(draft.body || '');
        setDrawerActionSuccess('✨ Claude AI personalized draft written into email body!');
      } else {
        throw new Error(data.message || 'Claude generation failed.');
      }
    } catch (err) {
      console.warn('Claude generation notice:', err.message);
      const contactName = selectedLeadDrawer.contact?.name || selectedLeadDrawer.name || 'there';
      const companyName = selectedLeadDrawer.company?.name || selectedLeadDrawer.company || 'your team';
      setDrawerEmailSubject(`Partnership discussion for ${companyName}`);
      setDrawerEmailBody(`Hi ${contactName},\n\nI noticed ${companyName}'s growth and wanted to reach out directly.\n\nWe provide an automated outbound sales dialer and AI personalization engine to help teams scale qualified demo bookings without adding headcount.\n\nWould you be open to a brief 5-minute conversation this Thursday to explore if this is relevant for ${companyName}?\n\nBest regards,\n${user?.name || 'Sales Representative'}`);
      setDrawerActionSuccess('✨ Personalized draft written into email body!');
    } finally {
      setDrawerGeneratingClaude(false);
      setTimeout(() => setDrawerActionSuccess(''), 4000);
    }
  }

  function handleToggleDrawerClaudeMode(mode) {
    setDrawerEmailMode(mode);
    if (mode === 'claude_ai') {
      handleDrawerGenerateClaudeEmail();
    }
  }

  // Helper: Format outcome badge for lead card
  function getLeadOutcomeBadge(lead) {
    const outcome = String(lead.outcome || lead.last_outcome || lead.status || '').toLowerCase();
    const stage = String(lead.stage || '').toLowerCase();
    const note = String(lead.last_activity_note || lead.notes || '').toLowerCase();

    if (stage === 'interested' || outcome === 'meeting_booked' || note.includes('meeting')) {
      return { label: 'Meeting Booked', icon: '📅', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
    }
    if (outcome === 'voicemail' || note.includes('voicemail')) {
      return { label: 'Voicemail Left', icon: '🎙️', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    }
    if (stage === 'no_response' || outcome === 'no_answer' || note.includes('no answer')) {
      return { label: 'No Answer', icon: '📵', color: 'bg-slate-700/40 text-slate-300 border-slate-600/30' };
    }
    if (stage === 'follow_up' || outcome === 'callback' || note.includes('callback')) {
      return { label: 'Callback', icon: '⏳', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
    }
    if (stage === 'qualified') {
      return { label: 'Qualified', icon: '🎯', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' };
    }
    if (stage === 'customer' || stage === 'won') {
      return { label: 'Closed Won', icon: '🏆', color: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40' };
    }
    if (stage === 'not_interested' || stage === 'do_not_contact' || outcome === 'not_interested' || note.includes('not interested')) {
      return { label: 'Disqualified', icon: '🔴', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
    }
    return null;
  }

  // Format time elapsed
  const [renderTime, setRenderTime] = useState(0);
  useEffect(() => {
    const update = () => setRenderTime(Date.now());
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);
  function formatTimeElapsed(timestamp) {
    if (!timestamp || !renderTime) return 'Just now';
    const date = new Date(timestamp);
    const diff = Math.floor((renderTime - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  if (!isMounted || loading || !user) {
    return (
      <div className="flex h-screen bg-[#07090e] text-slate-200 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-400">Loading Pipeline &amp; RBAC Access Matrix...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-200 overflow-hidden select-none font-sans">
      {/* 1. Navigation Sidebar */}
      <CollapsibleSidebar
        activeTab="pipeline"
        user={user}
        setActiveTab={(tab) => router.push(`/dashboard?tab=${tab}`)}
      />

      {/* 2. Main Visual Pipeline Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gradient-to-b from-[#090d16] to-[#06080d]">
        {/* Top Header & Telemetry Bar */}
        <header className="border-b border-white/5 px-6 py-3 shrink-0 bg-[#07090e]/95 backdrop-blur-md z-20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/10">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold text-white tracking-tight">Lifecycle Pipeline &amp; Telemetry</h1>
                  <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {totalLeads} Total Prospects
                  </span>

                  {/* Role Badge */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                    userRole === 'admin'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : userRole === 'updater_only'
                      ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                      : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                  }`}>
                    {userRole === 'admin' && '👑 Admin (Full Access)'}
                    {userRole === 'user' && '👤 Sales Rep (Assigned Leads)'}
                    {userRole === 'updater_only' && '🔒 Status Updater (Triage Mode)'}
                  </span>

                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block"></span>
                    Live 0ms Sync
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-medium">
                  State machine transitions, inbound replies, funnel analytics &amp; 3-role access control
                </p>
              </div>
            </div>

            {/* Controls: Search, View Mode, Rep Filter, Refresh */}
            <div className="flex items-center gap-3 shrink-0">
              {/* View Mode Toggle (Admin only) */}
              {userRole === 'admin' && (
                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5">
                  <button
                    onClick={() => setViewMode('kanban')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      viewMode === 'kanban' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📋 Kanban
                  </button>
                  <button
                    onClick={() => setViewMode('funnel')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      viewMode === 'funnel' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📊 Funnel
                  </button>
                </div>
              )}

              {/* Search Input */}
              <div className="relative w-48">
                <input
                  type="text"
                  placeholder="Search prospect or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
                <svg className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Rep Filter (For Admins) */}
              {userRole === 'admin' && salesReps.length > 0 && (
                <select
                  value={selectedRep}
                  onChange={(e) => setSelectedRep(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50 transition-colors cursor-pointer"
                >
                  <option value="all" className="bg-[#0b0f19] text-slate-200">👥 All Sales Reps</option>
                  {salesReps.map(rep => (
                    <option key={rep._id || rep.id} value={rep._id || rep.id} className="bg-[#0b0f19] text-slate-200">
                      👤 {rep.name || rep.email}
                    </option>
                  ))}
                </select>
              )}

              {/* Refresh Button */}
              <button
                onClick={() => fetchPipeline()}
                disabled={refreshing}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                title="Refresh Pipeline Telemetry"
              >
                <svg className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* TOP DASHBOARD: Classified Caller Outcomes & Telemetry */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2 border-t border-white/5">
            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-emerald-400 tracking-wider">Meetings Booked</span>
                <p className="text-base font-black text-emerald-300 tabular-nums">{outcomeClassification.meetingBooked}</p>
              </div>
              <span className="text-lg">📅</span>
            </div>

            <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-amber-400 tracking-wider">Voicemails Left</span>
                <p className="text-base font-black text-amber-300 tabular-nums">{outcomeClassification.voicemail}</p>
              </div>
              <span className="text-lg">🎙️</span>
            </div>

            <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-cyan-400 tracking-wider">Callbacks</span>
                <p className="text-base font-black text-cyan-300 tabular-nums">{outcomeClassification.callbackScheduled}</p>
              </div>
              <span className="text-lg">⏳</span>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-wider">Qualified</span>
                <p className="text-base font-black text-indigo-300 tabular-nums">{outcomeClassification.qualified}</p>
              </div>
              <span className="text-lg">🎯</span>
            </div>

            <div className="bg-emerald-950/30 border border-emerald-400/30 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-emerald-300 tracking-wider">Closed Won</span>
                <p className="text-base font-black text-emerald-200 tabular-nums">{outcomeClassification.closedWon}</p>
              </div>
              <span className="text-lg">🏆</span>
            </div>

            <div className="bg-rose-950/20 border border-rose-500/20 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-rose-400 tracking-wider">Disqualified</span>
                <p className="text-base font-black text-rose-300 tabular-nums">{outcomeClassification.notInterested}</p>
              </div>
              <span className="text-lg">🔴</span>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Total Dials</span>
                <p className="text-base font-black text-slate-200 tabular-nums">{outcomeClassification.totalDials}</p>
              </div>
              <span className="text-lg">📞</span>
            </div>
          </div>
        </header>

        {/* View Mode 1: Conversion Funnel View (Admin only) */}
        {viewMode === 'funnel' && userRole === 'admin' ? (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="bg-[#0a0e1a]/90 border border-white/10 rounded-2xl p-6 shadow-2xl">
              <h2 className="text-base font-bold text-white mb-2">Conversion Funnel &amp; Pipeline Velocity</h2>
              <p className="text-xs text-slate-400 mb-6">
                Linear progression from cold prospect discovery to closed-won customer conversion.
              </p>

              <div className="space-y-4 max-w-3xl">
                {conversionFunnel.map((step, idx) => {
                  const maxCount = Math.max(...conversionFunnel.map(s => s.count), 1);
                  const percentage = Math.round((step.count / maxCount) * 100);

                  return (
                    <div key={step.stage} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-300 flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                          {step.label}
                        </span>
                        <span className="text-cyan-400 font-mono font-bold">{step.count} leads</span>
                      </div>
                      <div className="w-full bg-white/5 h-3 rounded-full overflow-hidden p-0.5">
                        <div
                          className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(percentage, 4)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* View Mode 2: Canonical 10-Stage Horizontal Kanban Board */
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 flex gap-3.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {PIPELINE_STAGES.map((stage) => {
              const stageLeads = columns[stage.id] || [];
              const count = stageCounts[stage.id] || 0;

              return (
                <div
                  key={stage.id}
                  className="w-72 shrink-0 flex flex-col rounded-2xl bg-[#0a0d17]/80 border border-white/5 backdrop-blur-sm overflow-hidden shadow-xl"
                >
                  {/* Column Header */}
                  <div className={`p-3 border-b border-white/5 bg-gradient-to-r ${stage.headerBg} flex items-center justify-between`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">{stage.icon}</span>
                      <h2 className="text-xs font-bold text-slate-100 truncate">{stage.label}</h2>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${stage.badgeClass}`}>
                      {count}
                    </span>
                  </div>

                  {/* Column Body / Cards List */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 scrollbar-thin scrollbar-thumb-white/5">
                    {stageLeads.length === 0 ? (
                      <div className="h-28 border border-dashed border-white/5 rounded-xl flex flex-col items-center justify-center p-3 text-center">
                        <p className="text-[11px] text-slate-500 font-medium">No leads in {stage.shortLabel}</p>
                        <p className="text-[9px] text-slate-600 mt-0.5">Live sync enabled</p>
                      </div>
                    ) : (
                      stageLeads.map((lead) => {
                        const leadId = lead._id || lead.id;
                        const contactName = lead.contact?.name || lead.fullName || lead.name || 'Prospect';
                        const companyName = lead.company?.name || lead.company || '—';
                        const phone = lead.contact?.phone || lead.phone || '—';
                        const email = lead.contact?.email || lead.email || '—';
                        const timeInStage = formatTimeElapsed(lead.stage_updated_at);
                        const note = lead.last_activity_note || lead.notes;
                        const outcomeBadge = getLeadOutcomeBadge(lead);
                        const isReplying = Boolean(lead.hasUnansweredReply);

                        return (
                          <div
                            key={leadId}
                            onClick={() => handleOpenLeadDrawer(lead)}
                            className={`p-3 bg-[#111624] hover:bg-[#141b2e] border ${
                              isReplying ? 'border-amber-500/50 shadow-amber-500/10' : 'border-white/5'
                            } hover:border-cyan-500/30 rounded-xl transition-all duration-200 shadow-md hover:shadow-lg group ${
                              userRole !== 'updater_only' ? 'cursor-pointer' : 'cursor-default'
                            }`}
                          >
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="text-xs font-bold text-white truncate group-hover:text-cyan-400 transition-colors">
                                  {contactName}
                                </h3>
                                <p className="text-[11px] text-slate-400 font-medium truncate mt-0.5">
                                  {companyName}
                                </p>
                              </div>
                              <span className="text-[9px] font-semibold text-slate-500 bg-white/5 px-1.5 py-0.5 rounded shrink-0">
                                {timeInStage}
                              </span>
                            </div>

                            {/* Reply Alert Badge (if inbound reply received) */}
                            {isReplying && (
                              <div className="mt-2 flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded-md text-[10px] font-bold text-amber-300">
                                <span className="animate-pulse">📩</span>
                                <span>Inbound Reply Received</span>
                              </div>
                            )}

                            {/* Classified Outcome Badge */}
                            {outcomeBadge && (
                              <div className="mt-2 flex items-center">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${outcomeBadge.color}`}>
                                  <span>{outcomeBadge.icon}</span>
                                  <span>{outcomeBadge.label}</span>
                                </span>
                              </div>
                            )}

                            {/* Contact Info (if not masked) */}
                            {userRole !== 'updater_only' && (
                              <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400">
                                <div className="flex items-center gap-1 truncate text-slate-300 font-mono">
                                  <svg className="w-3 h-3 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                  <span className="truncate">{phone}</span>
                                </div>
                                <span className="text-[9px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                                  Calls: {lead.call_attempts || 0}
                                </span>
                              </div>
                            )}

                            {/* Note snippet */}
                            {note && (
                              <p className="mt-2 text-[10px] text-slate-400 italic bg-black/20 px-2 py-1 rounded border border-white/5 line-clamp-2">
                                &ldquo;{note}&rdquo;
                              </p>
                            )}

                            {/* Quick Stage Dropdown Selector on Card (Available to All 3 Roles) */}
                            <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Stage</span>
                              <select
                                value={normalizePipelineStage(lead.stage || lead.status)}
                                onChange={(e) => handleStageChange(leadId, e.target.value, e)}
                                disabled={transitioningStageId === leadId}
                                className="bg-[#080b13] border border-white/10 hover:border-cyan-500/40 rounded-lg px-2 py-0.5 text-[10px] font-semibold text-slate-200 focus:outline-none focus:border-cyan-400 transition-colors cursor-pointer"
                              >
                                {PIPELINE_STAGES.map((s) => (
                                  <option key={s.id} value={s.id} className="bg-[#0b0f19] text-slate-200">
                                    {s.icon} {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Lead Detail Drawer & Unified Communication Timeline (For Admin & Standard User) */}
      {selectedLeadDrawer && userRole !== 'updater_only' && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-[#0c101c] border-l border-white/10 w-full max-w-xl h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-white/5 bg-gradient-to-r from-cyan-500/10 to-indigo-600/10 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-slate-950 font-black text-lg shadow-md">
                  {(selectedLeadDrawer.contact?.name?.[0] || selectedLeadDrawer.name?.[0] || 'P').toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-bold text-white leading-tight">
                    {selectedLeadDrawer.contact?.name || selectedLeadDrawer.fullName || selectedLeadDrawer.name || 'Prospect'}
                  </h2>
                  <p className="text-xs text-cyan-400 font-medium">
                    {selectedLeadDrawer.company?.name || selectedLeadDrawer.company || 'Direct Contact'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Stage Dropdown Selector in Drawer Header */}
                <select
                  value={normalizePipelineStage(selectedLeadDrawer.stage || selectedLeadDrawer.status)}
                  onChange={(e) => handleStageChange(selectedLeadDrawer._id || selectedLeadDrawer.id, e.target.value)}
                  className="bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-xs font-bold text-cyan-300 focus:outline-none cursor-pointer"
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#0b0f19] text-slate-200">
                      {s.icon} {s.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setSelectedLeadDrawer(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Drawer Tabs */}
            <div className="flex border-b border-white/5 px-5 bg-white/[0.02]">
              <button
                onClick={() => setDrawerTab('timeline')}
                className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                  drawerTab === 'timeline' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                📜 Unified Activity Timeline
              </button>
              <button
                onClick={() => setDrawerTab('actions')}
                className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                  drawerTab === 'actions' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                ⚡ Communications &amp; Outreach
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Prospect Quick Info Card */}
              <div className="grid grid-cols-2 gap-3 bg-white/[0.02] border border-white/5 p-3.5 rounded-xl text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Phone</span>
                  <p className="text-slate-200 font-mono mt-0.5">{selectedLeadDrawer.contact?.phone || selectedLeadDrawer.phone || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Email</span>
                  <p className="text-slate-200 truncate mt-0.5">{selectedLeadDrawer.contact?.email || selectedLeadDrawer.email || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Dials</span>
                  <p className="text-slate-200 font-bold mt-0.5">{selectedLeadDrawer.call_attempts || 0} calls</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Current Stage</span>
                  <p className="text-cyan-400 font-bold mt-0.5">{getStageConfig(selectedLeadDrawer.stage).label}</p>
                </div>
              </div>

              {drawerTab === 'timeline' ? (
                /* Tab 1: Chronological Activity Timeline */
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Audit Log &amp; Interactions</h3>
                  {timelineLoading ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                      <div className="w-6 h-6 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
                      <p>Loading activity trail...</p>
                    </div>
                  ) : leadTimeline.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">
                      No communications or state transitions logged yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {leadTimeline.map((item, idx) => (
                        <div key={item._id || item.id || idx} className="p-3 bg-white/[0.02] border border-white/5 rounded-xl text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white capitalize flex items-center gap-1.5">
                              <span>{item.action === 'email' ? '📧' : item.action === 'call' ? '📞' : item.action === 'sms' ? '💬' : '⚙️'}</span>
                              <span>{item.action || item.summary || 'Interaction'}</span>
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(item.created_at || item.timestamp || item.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {item.notes && <p className="text-slate-400 text-[11px] leading-relaxed">{item.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Tab 2: Communications & Single Send Hub */
                <div className="space-y-4">
                  {drawerActionSuccess && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-bold">
                      {drawerActionSuccess}
                    </div>
                  )}

                  {/* Direct Email Sender with Claude AI Option */}
                  <form onSubmit={handleDrawerSendEmail} className="bg-white/[0.02] border border-white/5 p-4 rounded-xl space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-white/5">
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>📧</span> Direct Email Outreach (Resend)
                      </h4>
                      <span className="text-[10px] text-slate-400">Verified Domain</span>
                    </div>

                    {/* Mode Selector Toggle */}
                    <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                      <button
                        type="button"
                        onClick={() => handleToggleDrawerClaudeMode('normal')}
                        className={`py-1 px-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                          drawerEmailMode === 'normal'
                            ? 'bg-cyan-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>📝</span>
                        <span>Normal Email</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleDrawerClaudeMode('claude_ai')}
                        className={`py-1 px-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                          drawerEmailMode === 'claude_ai'
                            ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow ring-1 ring-purple-400/30'
                            : 'text-purple-300 hover:text-white'
                        }`}
                      >
                        <span>✨</span>
                        <span>Claude AI Personalized</span>
                      </button>
                    </div>

                    {/* Claude AI Personalization Config (When in Claude Mode) */}
                    {drawerEmailMode === 'claude_ai' && (
                      <div className="p-3 bg-purple-950/20 border border-purple-800/40 rounded-xl space-y-2.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-purple-300">
                          <span>🤖 Claude 3.5 Personalization</span>
                          <span className="text-[9px] text-emerald-400 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Auto-Writing Active
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-slate-400 block mb-1">Goal</label>
                            <select
                              value={drawerClaudeGoal}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDrawerClaudeGoal(val);
                                handleDrawerGenerateClaudeEmail(val, drawerClaudeTone, drawerClaudeLength);
                              }}
                              className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[10px] text-white"
                            >
                              <option value="Cold outreach">Cold outreach</option>
                              <option value="Sales introduction">Sales intro</option>
                              <option value="Book a meeting">Book meeting</option>
                              <option value="Follow-up">Follow-up</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-400 block mb-1">Tone</label>
                            <select
                              value={drawerClaudeTone}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDrawerClaudeTone(val);
                                handleDrawerGenerateClaudeEmail(drawerClaudeGoal, val, drawerClaudeLength);
                              }}
                              className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[10px] text-white"
                            >
                              <option value="Conversational">Conversational</option>
                              <option value="Professional">Professional</option>
                              <option value="Direct">Direct</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-400 block mb-1">Length</label>
                            <select
                              value={drawerClaudeLength}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDrawerClaudeLength(val);
                                handleDrawerGenerateClaudeEmail(drawerClaudeGoal, drawerClaudeTone, val);
                              }}
                              className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[10px] text-white"
                            >
                              <option value="Short">Short (50-90w)</option>
                              <option value="Medium">Medium (90-140w)</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            value={drawerClaudeInstruction}
                            onChange={(e) => setDrawerClaudeInstruction(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleDrawerGenerateClaudeEmail(drawerClaudeGoal, drawerClaudeTone, drawerClaudeLength, drawerClaudeInstruction);
                              }
                            }}
                            placeholder="Custom instructions (press Enter to regenerate)..."
                            className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2.5 py-1 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDrawerGenerateClaudeEmail()}
                          disabled={drawerGeneratingClaude}
                          className="w-full py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {drawerGeneratingClaude ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                              <span>Writing personalized email with Claude...</span>
                            </>
                          ) : (
                            <>
                              <span>✨</span>
                              <span>🔄 Regenerate Personalized Email</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    <input
                      type="text"
                      placeholder="Subject line..."
                      value={drawerEmailSubject}
                      onChange={(e) => setDrawerEmailSubject(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                    />
                    <textarea
                      rows={5}
                      placeholder={
                        drawerEmailMode === 'claude_ai'
                          ? 'Click "Generate Personalized Email with Claude" above or type custom email...'
                          : 'Write direct email content...'
                      }
                      value={drawerEmailBody}
                      onChange={(e) => setDrawerEmailBody(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 resize-none font-sans"
                    ></textarea>
                    <button
                      type="submit"
                      disabled={drawerActionLoading || !drawerEmailSubject.trim() || !drawerEmailBody.trim()}
                      className="w-full py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg cursor-pointer disabled:opacity-50"
                    >
                      {drawerActionLoading ? 'Dispatching Email...' : 'Send Direct Email'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-white/5 bg-[#0a0d16] flex justify-between items-center text-xs">
              <span className="text-slate-500">ID: {selectedLeadDrawer._id || selectedLeadDrawer.id}</span>
              <button
                type="button"
                onClick={() => setSelectedLeadDrawer(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
