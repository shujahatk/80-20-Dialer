"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';
import BlastEngineSettingsCard from '@/components/BlastEngineSettingsCard';

export default function ManagerBlastsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Active Tab: 'composer' | 'campaigns' | 'ai-usage' | 'settings'
  const [activeTab, setActiveTab] = useState('composer');

  // Wizard state: 1: Recipients, 2: Claude AI Config / Content, 3: AI Review / Test, 4: Dispatch
  const [step, setStep] = useState(1);

  // Data states
  const [leads, setLeads] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [aiUsageStats, setAiUsageStats] = useState(null);

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('default');

  // Mode Selection: 'ai_personalized' | 'standard'
  const [emailMode, setEmailMode] = useState('ai_personalized');

  // Claude AI Personalization Configuration
  const [emailGoal, setEmailGoal] = useState('Cold outreach');
  const [tone, setTone] = useState('Professional');
  const [emailLength, setEmailLength] = useState('Short');
  const [userInstructions, setUserInstructions] = useState('');
  const [generateAiSubjects, setGenerateAiSubjects] = useState(true);
  const [offerDescription, setOfferDescription] = useState(
    'Automated outbound sales dialer and email pipeline to accelerate qualified demo bookings'
  );

  // Claude AI Generation & Review State
  const [aiDrafts, setAiDrafts] = useState([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [aiError, setAiError] = useState('');
  const [showCostWarning, setShowCostWarning] = useState(false);

  // Per-Lead Single Regeneration Modal State
  const [activeRegenLead, setActiveRegenLead] = useState(null);
  const [customRegenInstruction, setCustomRegenInstruction] = useState('');
  const [isRegeneratingSingle, setIsRegeneratingSingle] = useState(false);

  // Inline Editing State for Drafts
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Recipient Filters
  const [assignedFilter, setAssignedFilter] = useState('all'); // 'all' | repId | 'unassigned'
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [leadSelectionMap, setLeadSelectionMap] = useState({});

  // Test Email State
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState({ success: null, message: '' });

  // Creation & Dispatch Progress State
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [dispatchProgress, setDispatchProgress] = useState({ sent: 0, total: 0, completed: false });

  // Active Telemetry Campaign Modal
  const [selectedCampaign, setSelectedCampaign] = useState(null);



  async function fetchData() {
    setLoading(true);
    try {
      const [leadsRes, campRes, usersRes, aiRes] = await Promise.all([
        apiRequest('/api/leads', 'GET').catch(() => ({ success: false })),
        apiRequest('/api/manager/blasts', 'GET').catch(() => ({ success: false })),
        apiRequest('/api/manager/users', 'GET').catch(() => ({ success: false })),
        apiRequest('/api/ai/personalize/usage', 'GET').catch(() => ({ success: false }))
      ]);

      if (leadsRes.success && Array.isArray(leadsRes.data)) {
        setLeads(leadsRes.data);
        const map = {};
        leadsRes.data.forEach(l => {
          map[l._id || l.id] = true;
        });
        setLeadSelectionMap(map);
      }

      if (campRes.success && Array.isArray(campRes.data)) {
        setCampaigns(campRes.data);
      }

      if (usersRes.success && Array.isArray(usersRes.data)) {
        setUsersList(usersRes.data);
      }

      if (aiRes.success && aiRes.data) {
        setAiUsageStats(aiRes.data);
      }

      setInboxes([
        {
          _id: 'default',
          name: 'Primary Outbound Pool (Resend)',
          fromEmail: 'outreach@8020acquisition.com',
          fromName: '80/20 Acquisition',
          monthlyLimit: 50000,
          dailyLimit: 'Unlimited'
        }
      ]);
    } catch (err) {
      console.error('Failed to load manager blast data:', err);
    } finally {
      setLoading(false);
    }
  }

  useAuthenticatedEffect((sessionUser) => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) {
      router.push('/login');
      return;
    }

    try {
      const parsed = sessionUser;
      if (parsed.role === 'salesperson') {
        router.push('/workstation');
        return;
      }
      setUser(parsed);
      setTestEmail(parsed.email || '');
    } catch {
      router.push('/login');
      return;
    }

    fetchData();
  }, [router]);

  async function fetchCampaigns() {
    try {
      const res = await apiRequest('/api/manager/blasts', 'GET');
      if (res.success && Array.isArray(res.data)) {
        setCampaigns(res.data);
      }
    } catch (e) {
      console.warn('Error fetching campaigns:', e);
    }
  }

  async function fetchAiUsage() {
    try {
      const res = await apiRequest('/api/ai/personalize/usage', 'GET');
      if (res.success && res.data) {
        setAiUsageStats(res.data);
      }
    } catch (e) {
      console.warn('Error fetching AI usage:', e);
    }
  }

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      const name = l.contact?.name || l.name || '';
      const email = l.contact?.email || l.email || '';
      const company = l.company?.name || l.companyName || '';
      const assigned = l.assignedTo || l.assigned_to;

      if (assignedFilter !== 'all') {
        if (assignedFilter === 'unassigned') {
          if (assigned) return false;
        } else {
          if (String(assigned) !== String(assignedFilter)) return false;
        }
      }

      if (statusFilter !== 'all' && l.status !== statusFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          name.toLowerCase().includes(q) ||
          email.toLowerCase().includes(q) ||
          company.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [leads, assignedFilter, statusFilter, searchQuery]);

  // Recipient Stats
  const recipientStats = useMemo(() => {
    const selected = filteredLeads.filter(l => leadSelectionMap[l._id || l.id]);
    let eligible = 0;
    let suppressed = 0;
    let missingEmail = 0;

    selected.forEach(l => {
      const email = l.contact?.email || l.email;
      if (!email || !email.includes('@')) {
        missingEmail++;
      } else if (l.suppression?.email) {
        suppressed++;
      } else {
        eligible++;
      }
    });

    return {
      totalSelected: selected.length,
      eligible,
      suppressed,
      missingEmail,
      excluded: leads.length - selected.length
    };
  }, [filteredLeads, leadSelectionMap, leads.length]);

  function handleSelectAll(checked) {
    const newMap = { ...leadSelectionMap };
    filteredLeads.forEach(l => {
      newMap[l._id || l.id] = checked;
    });
    setLeadSelectionMap(newMap);
  }

  function handleToggleLead(id) {
    setLeadSelectionMap(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  }

  // --- Claude AI Batch Personalization Handler ---
  async function handleStartAiGeneration() {
    const selectedLeadIds = filteredLeads
      .filter(l => leadSelectionMap[l._id || l.id] && !l.suppression?.email && (l.email || l.contact?.email))
      .map(l => l._id || l.id);

    if (selectedLeadIds.length === 0) {
      setSubmitError('Please select at least one eligible lead with a valid email address.');
      return;
    }

    if (selectedLeadIds.length > 50 && !showCostWarning) {
      setShowCostWarning(true);
      return;
    }
    setShowCostWarning(false);

    setGeneratingAi(true);
    setAiError('');
    setAiProgress({ current: 0, total: selectedLeadIds.length });

    try {
      const res = await apiRequest('/api/ai/personalize/batch', 'POST', {
        leadIds: selectedLeadIds,
        goal: emailGoal,
        tone,
        length: emailLength,
        instructions: userInstructions,
        generateSubject: generateAiSubjects,
        offer: offerDescription,
        campaignId: `camp_${Date.now()}`
      });

      if (res.success && Array.isArray(res.drafts)) {
        setAiDrafts(res.drafts);
        setStep(3); // Advance to AI Review screen
        fetchAiUsage();
      } else {
        setAiError(res.message || 'Failed to generate personalized emails.');
      }
    } catch (err) {
      setAiError(err.message || 'Failed to communicate with Claude AI service.');
    } finally {
      setGeneratingAi(false);
    }
  }

  // --- Per-Lead Single Regeneration Handler ---
  async function handleRegenerateSingle() {
    if (!activeRegenLead) return;
    setIsRegeneratingSingle(true);
    try {
      const res = await apiRequest('/api/ai/personalize/regenerate', 'POST', {
        draftId: activeRegenLead._id || activeRegenLead.id,
        leadId: activeRegenLead.leadId,
        customInstruction: customRegenInstruction,
        goal: emailGoal,
        tone,
        length: emailLength,
        generateSubject: generateAiSubjects,
        offer: offerDescription
      });

      if (res.success && res.draft) {
        setAiDrafts(prev =>
          prev.map(d =>
            (d._id === activeRegenLead._id || d.leadId === activeRegenLead.leadId ? res.draft : d)
          )
        );
        setActiveRegenLead(null);
        setCustomRegenInstruction('');
        fetchAiUsage();
      } else {
        alert(res.message || 'Regeneration failed.');
      }
    } catch (err) {
      alert(err.message || 'Regeneration error.');
    } finally {
      setIsRegeneratingSingle(false);
    }
  }

  // Approve / Skip Drafts
  function handleToggleApproveDraft(draftId) {
    setAiDrafts(prev =>
      prev.map(d => {
        if (d._id === draftId || d.id === draftId) {
          const nextStatus = d.status === 'approved' ? 'generated' : 'approved';
          return { ...d, status: nextStatus };
        }
        return d;
      })
    );
  }

  function handleSkipDraft(draftId) {
    setAiDrafts(prev =>
      prev.map(d => {
        if (d._id === draftId || d.id === draftId) {
          return { ...d, status: 'skipped' };
        }
        return d;
      })
    );
  }

  function handleApproveAllDrafts() {
    setAiDrafts(prev =>
      prev.map(d =>
        d.status !== 'skipped' && d.status !== 'generation_failed' ? { ...d, status: 'approved' } : d
      )
    );
  }

  // Inline Draft Editing
  function startEditingDraft(draft) {
    setEditingDraftId(draft._id || draft.id);
    setEditSubject(draft.subject || '');
    setEditBody(draft.body || '');
  }

  function saveEditingDraft() {
    if (!editingDraftId) return;
    setAiDrafts(prev =>
      prev.map(d => {
        if (d._id === editingDraftId || d.id === editingDraftId) {
          return { ...d, subject: editSubject, body: editBody, status: 'approved' };
        }
        return d;
      })
    );
    setEditingDraftId(null);
  }

  // --- Campaign Launch & Dispatch Handler ---
  async function handleLaunchCampaign() {
    setSubmitting(true);
    setSubmitError('');

    try {
      if (emailMode === 'ai_personalized') {
        const approvedDrafts = aiDrafts.filter(d => d.status === 'approved' || d.status === 'generated');
        if (approvedDrafts.length === 0) {
          setSubmitError('Please approve at least one generated email before launching.');
          setSubmitting(false);
          return;
        }

        const res = await apiRequest('/api/ai/personalize/approve', 'POST', {
          action: 'dispatch_approved',
          drafts: approvedDrafts
        });

        if (res.success) {
          setDispatchProgress({
            sent: res.sentCount || approvedDrafts.length,
            total: approvedDrafts.length,
            completed: true
          });
          setStep(4);
          fetchCampaigns();
        } else {
          setSubmitError(res.message || 'Failed to dispatch AI personalized emails.');
        }
      } else {
        // Standard Campaign Launch
        const selectedLeadIds = filteredLeads
          .filter(l => leadSelectionMap[l._id || l.id] && !l.suppression?.email && (l.email || l.contact?.email))
          .map(l => l._id || l.id);

        if (selectedLeadIds.length === 0) {
          setSubmitError('No eligible leads selected.');
          setSubmitting(false);
          return;
        }

        const res = await apiRequest('/api/manager/blasts', 'POST', {
          name: campaignName || `Admin Campaign - ${new Date().toLocaleDateString()}`,
          description,
          type: 'email',
          templateSubject: templateSubject || 'Outbound Collaboration',
          templateBody:
            templateBody ||
            'Hello {{firstName}},\n\nI wanted to reach out regarding our outbound acquisition platform.',
          useAiPersonalization: false,
          leadIds: selectedLeadIds,
          sendingInboxId: selectedInboxId
        });

        if (res.success) {
          setDispatchProgress({
            sent: res.data.stats?.sent || 0,
            total: res.data.stats?.total || selectedLeadIds.length,
            completed: true
          });
          setStep(4);
          fetchCampaigns();
        } else {
          setSubmitError(res.error || res.message || 'Failed to dispatch blast campaign.');
        }
      }
    } catch (err) {
      setSubmitError(err.message || 'An error occurred during campaign dispatch.');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Test Email Send ---
  async function handleSendTestEmail() {
    if (!testEmail || !testEmail.includes('@')) {
      setTestResult({ success: false, message: 'Please provide a valid test email address.' });
      return;
    }

    setSendingTest(true);
    setTestResult({ success: null, message: '' });

    try {
      const res = await apiRequest('/api/workstation/blasts/test-send', 'POST', {
        testEmail,
        subject: templateSubject || (aiDrafts[0]?.subject) || 'Sample Outbound Test Email',
        templateBody:
          templateBody ||
          (aiDrafts[0]?.body) ||
          'Hi {{firstName}}, this is a live test email from 80/20 Outbound Engine.',
        useAiPersonalization: emailMode === 'ai_personalized',
        tone
      });

      if (res.success) {
        setTestResult({ success: true, message: `✓ Test email successfully sent to ${testEmail}` });
      } else {
        setTestResult({
          success: false,
          message: res.error?.message || res.message || 'Failed to dispatch test email.'
        });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Test email failed.' });
    } finally {
      setSendingTest(false);
    }
  }

  // Live Sample Preview for Standard Mode
  const samplePreview = useMemo(() => {
    const sampleLead = filteredLeads[0] || {
      contact: { name: 'Alex Johnson', email: 'alex@example.com' },
      company: { name: 'Acme Growth Labs' },
      industry: 'Software'
    };

    const firstName = sampleLead.contact?.name?.split(' ')[0] || sampleLead.name?.split(' ')[0] || 'Alex';
    const company = sampleLead.company?.name || sampleLead.companyName || 'Acme Growth Labs';
    const industry = sampleLead.industry || 'Technology';

    let subj = templateSubject || 'Quick question for {{firstName}} re: {{company}}';
    let bdy =
      templateBody ||
      'Hi {{firstName}},\n\nI noticed {{company}} is scaling rapidly in the {{industry}} space. Wanted to connect regarding automated outbound acquisition.\n\nBest,\n' +
        (user?.name || 'Admin Team');

    subj = subj.replace(/{{firstName}}/g, firstName).replace(/{{company}}/g, company).replace(/{{industry}}/g, industry);
    bdy = bdy.replace(/{{firstName}}/g, firstName).replace(/{{company}}/g, company).replace(/{{industry}}/g, industry);

    return { subject: subj, body: bdy, sampleLead };
  }, [filteredLeads, templateSubject, templateBody, user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#07090e] text-slate-400 font-sans">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Loading Outbound Blast Engine...</p>
      </div>
    );
  }

  const aiGenerationsCount = aiUsageStats?.totalGenerations ?? aiUsageStats?.totalGenerated ?? aiDrafts.length;
  const aiTokensCount = aiUsageStats?.totalTokens ?? (aiDrafts.length * 450);
  const aiCostDisplay = aiUsageStats?.totalEstimatedCost ?? (aiUsageStats?.estimatedCost ? `$${aiUsageStats.estimatedCost}` : `$${(aiDrafts.length * 0.0035).toFixed(4)}`);

  return (
    <div className="flex flex-col min-h-screen bg-[#07090e] text-slate-100 font-sans selection:bg-cyan-500/20">
      {/* Top Admin Header */}
      <header className="bg-[#0b0e17] border-b border-white/5 px-6 h-16 flex items-center justify-between sticky top-0 z-30 shadow-lg shadow-black/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="font-black text-white text-sm tracking-tight">80</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white tracking-tight">80/20 Outbound Engine</span>
              <span className="text-[10px] text-cyan-400 font-semibold bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Admin Console
              </span>
            </div>
            <p className="text-[11px] text-slate-400">High-throughput campaign manager &amp; Claude AI writing center</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-medium">Pool: 50,000 / mo</span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400 font-semibold">Unlimited Daily</span>
          </div>

          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-semibold transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Dashboard
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2.5">
              <span>🚀</span> Campaign Blast &amp; Claude AI Center
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Dispatch multi-channel bulk blasts or individualized AI-personalized emails powered by Claude 3.5 Sonnet.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-[#121624] p-1.5 rounded-2xl border border-white/10 self-start sm:self-auto overflow-x-auto">
            <button
              onClick={() => setActiveTab('composer')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'composer'
                  ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>✏️</span> New Campaign
            </button>
            <button
              onClick={() => {
                setActiveTab('campaigns');
                fetchCampaigns();
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'campaigns'
                  ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>📋</span> Dispatched ({campaigns.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('ai-usage');
                fetchAiUsage();
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'ai-usage'
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>🤖</span> Claude AI Telemetry
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>⚡</span> Engine Settings
            </button>
          </div>
        </div>

        {/* TAB 1: CAMPAIGN COMPOSER & CLAUDE AI */}
        {activeTab === 'composer' && (
          <div className="bg-[#121624] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
            {/* Wizard Step Progress Indicator */}
            <div className="grid grid-cols-4 gap-3 text-center pb-5 border-b border-white/5">
              {[
                { num: 1, label: '1. Select Recipients' },
                { num: 2, label: emailMode === 'ai_personalized' ? '2. Claude AI Config' : '2. Template & Message' },
                { num: 3, label: emailMode === 'ai_personalized' ? '3. Claude Drafts & Test' : '3. Live Preview & Test' },
                { num: 4, label: '4. Dispatch & Execution' }
              ].map(s => (
                <div
                  key={s.num}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    step === s.num
                      ? 'bg-cyan-500/15 border-cyan-500 text-cyan-400 shadow-md shadow-cyan-500/10'
                      : step > s.num
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-[#07090e] border-white/5 text-slate-500'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      step === s.num
                        ? 'bg-cyan-400 text-slate-950'
                        : step > s.num
                        ? 'bg-emerald-400 text-slate-950'
                        : 'bg-white/10 text-slate-400'
                    }`}
                  >
                    {step > s.num ? '✓' : s.num}
                  </span>
                  <span className="hidden md:inline">{s.label}</span>
                </div>
              ))}
            </div>

            {/* STEP 1: SELECT RECIPIENTS */}
            {step === 1 && (
              <div className="space-y-6">
                {/* Campaign Mode Selection */}
                <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>🎯</span> Select Campaign Sending Mode
                    </h3>
                    <p className="text-xs text-slate-400">
                      Choose between automated 1-on-1 Claude AI personalization or high-volume standard email blasts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div
                      onClick={() => setEmailMode('ai_personalized')}
                      className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                        emailMode === 'ai_personalized'
                          ? 'bg-cyan-500/10 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                          : 'bg-[#121624] border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-lg shrink-0">
                          🤖
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">Claude AI Personalized Outreach</span>
                            <span className="bg-purple-500/20 text-purple-300 text-[10px] px-2 py-0.5 rounded-full font-bold border border-purple-500/30">
                              Claude 3.5 Sonnet
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Generates tailored, unique subject lines and personalized body copy for every individual lead based on their company, title, and industry.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={() => setEmailMode('standard')}
                      className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                        emailMode === 'standard'
                          ? 'bg-cyan-500/10 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                          : 'bg-[#121624] border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-lg shrink-0">
                          ⚡
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">Standard Outbound Blast</span>
                            <span className="bg-cyan-500/20 text-cyan-300 text-[10px] px-2 py-0.5 rounded-full font-bold border border-cyan-500/30">
                              High Speed
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Dispatches a unified template with dynamic tokens (<code className="text-cyan-400">{'{{firstName}}'}</code>, <code className="text-cyan-400">{'{{company}}'}</code>) across thousands of leads.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filter Controls */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Filter by Sales Rep Assignee
                    </label>
                    <select
                      value={assignedFilter}
                      onChange={e => setAssignedFilter(e.target.value)}
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="all">All Sales Representatives ({leads.length} leads)</option>
                      <option value="unassigned">Unassigned Leads Only</option>
                      {usersList.map(u => (
                        <option key={u._id || u.id} value={u._id || u.id}>
                          {u.name} ({u.email}) — {u.role}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Filter by Pipeline Stage
                    </label>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="all">All Stages</option>
                      <option value="NEW">NEW</option>
                      <option value="CONTACTED">CONTACTED</option>
                      <option value="QUALIFIED">QUALIFIED</option>
                      <option value="MEETING_BOOKED">MEETING_BOOKED</option>
                      <option value="UNRESPONSIVE">UNRESPONSIVE</option>
                      <option value="CLOSED_WON">CLOSED_WON</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Search Leads
                    </label>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search name, company, or email..."
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                {/* Recipient Deliverability Audit Card */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#07090e] border border-white/8 rounded-2xl p-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Total Selected</span>
                    <span className="text-lg font-black text-white">{recipientStats.totalSelected}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Deliverable (Ready)</span>
                    <span className="text-lg font-black text-emerald-400">{recipientStats.eligible}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-amber-400">Missing Email</span>
                    <span className="text-lg font-black text-amber-400">{recipientStats.missingEmail}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-rose-400">Suppressed</span>
                    <span className="text-lg font-black text-rose-400">{recipientStats.suppressed}</span>
                  </div>
                </div>

                {/* Leads Selection Table */}
                <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#07090e]">
                  <div className="flex items-center justify-between p-3.5 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={filteredLeads.length > 0 && filteredLeads.every(l => leadSelectionMap[l._id || l.id])}
                        onChange={e => handleSelectAll(e.target.checked)}
                        className="rounded border-white/20 bg-black/40 text-cyan-500 focus:ring-0 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-300">
                        {filteredLeads.length} Leads Displayed ({recipientStats.totalSelected} Selected)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSelectAll(true)}
                        className="text-[11px] text-cyan-400 hover:underline font-semibold"
                      >
                        Select All
                      </button>
                      <span className="text-slate-600">•</span>
                      <button
                        onClick={() => handleSelectAll(false)}
                        className="text-[11px] text-slate-400 hover:underline font-semibold"
                      >
                        Clear Selection
                      </button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                    {filteredLeads.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        No leads match the selected filter criteria.
                      </div>
                    ) : (
                      filteredLeads.map(lead => {
                        const id = lead._id || lead.id;
                        const isSelected = !!leadSelectionMap[id];
                        const email = lead.contact?.email || lead.email;
                        const name = lead.contact?.name || lead.name || 'Unnamed Contact';
                        const company = lead.company?.name || lead.companyName || 'Unknown Company';
                        const isSuppressed = lead.suppression?.email;

                        return (
                          <div
                            key={id}
                            onClick={() => handleToggleLead(id)}
                            className={`flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] cursor-pointer transition-all ${
                              isSelected ? 'bg-cyan-500/[0.04]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="rounded border-white/20 bg-black/40 text-cyan-500 focus:ring-0 w-4 h-4 cursor-pointer"
                              />
                              <div className="truncate">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-200">{name}</span>
                                  <span className="text-[11px] text-slate-400">• {company}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 truncate">
                                  {email ? (
                                    <span className="text-slate-400">{email}</span>
                                  ) : (
                                    <span className="text-amber-500/80">No email address</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 font-mono">
                                {lead.status || 'NEW'}
                              </span>
                              {isSuppressed && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-semibold">
                                  Suppressed
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Step 1 Actions */}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xs text-slate-500 font-medium">
                    Ready to configure {recipientStats.eligible} deliverable outreach emails.
                  </span>
                  <button
                    onClick={() => {
                      if (recipientStats.eligible === 0) {
                        alert('Please select at least one deliverable lead with an email.');
                        return;
                      }
                      setStep(2);
                    }}
                    disabled={recipientStats.eligible === 0}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-black text-xs hover:opacity-90 disabled:opacity-40 transition-all shadow-lg shadow-cyan-500/20"
                  >
                    Continue to Configuration →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: CLAUDE AI CONFIG OR TEMPLATE */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Campaign Name
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    placeholder="e.g. Q4 Executive Decision-Maker Outreach"
                    className="w-full bg-[#07090e] border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* IF CLAUDE AI PERSONALIZED MODE */}
                {emailMode === 'ai_personalized' ? (
                  <div className="space-y-5 bg-[#07090e] border border-white/8 rounded-2xl p-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>🤖</span> Claude 3.5 Sonnet Writing Strategy
                        </h3>
                        <p className="text-xs text-slate-400">
                          Configure tone, goal, length, and strategic value proposition for AI email synthesis.
                        </p>
                      </div>
                      <span className="text-[10px] bg-purple-500/20 text-purple-300 font-mono px-2.5 py-1 rounded-full border border-purple-500/30">
                        Anthropic Claude 3.5
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                          Outreach Goal
                        </label>
                        <select
                          value={emailGoal}
                          onChange={e => setEmailGoal(e.target.value)}
                          className="w-full bg-[#121624] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="Cold outreach">Cold Outreach</option>
                          <option value="Meeting booking">Book Discovery Meeting</option>
                          <option value="Product demo">Product Demo Invitation</option>
                          <option value="Follow-up">Multi-touch Follow-Up</option>
                          <option value="Partnership">Strategic Partnership</option>
                          <option value="Re-engagement">Re-engage Cold Lead</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                          Writing Tone
                        </label>
                        <select
                          value={tone}
                          onChange={e => setTone(e.target.value)}
                          className="w-full bg-[#121624] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="Professional">Professional &amp; Authoritative</option>
                          <option value="Casual">Casual &amp; Conversational</option>
                          <option value="Direct">Direct &amp; Concise (No fluff)</option>
                          <option value="Friendly">Warm &amp; Friendly</option>
                          <option value="Urgent">Urgent &amp; Action-Oriented</option>
                          <option value="Consultative">Consultative &amp; Advisory</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                          Email Length
                        </label>
                        <select
                          value={emailLength}
                          onChange={e => setEmailLength(e.target.value)}
                          className="w-full bg-[#121624] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="Short">Short &amp; Punchy (50-75 words)</option>
                          <option value="Medium">Medium &amp; Contextual (100-150 words)</option>
                          <option value="Detailed">Detailed &amp; Value-Rich (175-250 words)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Target Offer &amp; Core Value Proposition
                      </label>
                      <input
                        type="text"
                        value={offerDescription}
                        onChange={e => setOfferDescription(e.target.value)}
                        placeholder="e.g. Automated outbound sales dialer and email pipeline to accelerate qualified demo bookings"
                        className="w-full bg-[#121624] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Custom AI Directives &amp; Angles (Optional)
                      </label>
                      <textarea
                        rows={3}
                        value={userInstructions}
                        onChange={e => setUserInstructions(e.target.value)}
                        placeholder="e.g. Focus on eliminating SDR manual entry fatigue. Mention their company name naturally. End with an open-ended question asking if they have 10 mins this Thursday."
                        className="w-full bg-[#121624] border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-mono"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="aiSubj"
                        checked={generateAiSubjects}
                        onChange={e => setGenerateAiSubjects(e.target.checked)}
                        className="rounded border-white/20 bg-black/40 text-purple-500 focus:ring-0 w-4 h-4 cursor-pointer"
                      />
                      <label htmlFor="aiSubj" className="text-xs text-slate-300 font-semibold cursor-pointer">
                        Synthesize customized, high-open subject lines for each lead
                      </label>
                    </div>

                    {showCostWarning && (
                      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between">
                        <span>
                          ⚠️ You are generating AI personalized emails for <strong>{recipientStats.eligible} leads</strong>.
                        </span>
                        <button
                          onClick={handleStartAiGeneration}
                          className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs"
                        >
                          Confirm &amp; Proceed
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 bg-[#07090e] border border-white/8 rounded-2xl p-6">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Template Subject Line
                      </label>
                      <input
                        type="text"
                        value={templateSubject}
                        onChange={e => setTemplateSubject(e.target.value)}
                        placeholder="e.g. Quick question for {{firstName}} re: {{company}}"
                        className="w-full bg-[#121624] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Email Body (HTML / Text)
                        </label>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="text-slate-500">Insert tag:</span>
                          <button
                            type="button"
                            onClick={() => setTemplateBody(prev => prev + ' {{firstName}}')}
                            className="bg-white/5 hover:bg-white/10 text-cyan-400 px-2 py-0.5 rounded font-mono"
                          >
                            {'{{firstName}}'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTemplateBody(prev => prev + ' {{company}}')}
                            className="bg-white/5 hover:bg-white/10 text-cyan-400 px-2 py-0.5 rounded font-mono"
                          >
                            {'{{company}}'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTemplateBody(prev => prev + ' {{industry}}')}
                            className="bg-white/5 hover:bg-white/10 text-cyan-400 px-2 py-0.5 rounded font-mono"
                          >
                            {'{{industry}}'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={7}
                        value={templateBody}
                        onChange={e => setTemplateBody(e.target.value)}
                        placeholder="Hello {{firstName}},\n\nI noticed {{company}} has been expanding in the industry..."
                        className="w-full bg-[#121624] border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Step 2 Actions */}
                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:text-white text-xs font-semibold"
                  >
                    ← Back to Recipients
                  </button>

                  {emailMode === 'ai_personalized' ? (
                    <button
                      onClick={handleStartAiGeneration}
                      disabled={generatingAi}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-black text-xs hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2"
                    >
                      {generatingAi ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Generating Claude AI Drafts...</span>
                        </>
                      ) : (
                        <span>Generate {recipientStats.eligible} AI Emails with Claude →</span>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => setStep(3)}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-black text-xs hover:opacity-90 transition-all shadow-lg shadow-cyan-500/20"
                    >
                      Preview &amp; Test Email →
                    </button>
                  )}
                </div>

                {aiError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
                    {aiError}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: CLAUDE DRAFT REVIEW & TEST EMAIL */}
            {step === 3 && (
              <div className="space-y-6">
                {emailMode === 'ai_personalized' ? (
                  <div className="space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#07090e] border border-white/8 rounded-2xl p-4">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>📋</span> Claude AI Draft Review ({aiDrafts.length} generated)
                        </h3>
                        <p className="text-xs text-slate-400">
                          Review, edit inline, skip, or regenerate individual drafts before final delivery.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleApproveAllDrafts}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs font-bold transition-all"
                        >
                          ✓ Approve All Generated
                        </button>
                      </div>
                    </div>

                    {/* Draft Cards List */}
                    <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                      {aiDrafts.map((draft, idx) => {
                        const isEditing = editingDraftId === (draft._id || draft.id);
                        const isApproved = draft.status === 'approved';
                        const isSkipped = draft.status === 'skipped';

                        return (
                          <div
                            key={draft._id || draft.id || idx}
                            className={`border rounded-2xl p-4 transition-all ${
                              isSkipped
                                ? 'bg-slate-900/30 border-white/5 opacity-50'
                                : isApproved
                                ? 'bg-[#0b101d] border-emerald-500/40 shadow-sm'
                                : 'bg-[#07090e] border-white/10'
                            }`}
                          >
                            <div className="flex items-center justify-between pb-3 border-b border-white/5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">
                                  {draft.leadName || draft.leadEmail}
                                </span>
                                {draft.company && (
                                  <span className="text-[11px] text-slate-400">• {typeof draft.company === 'string' ? draft.company : (draft.company?.name || '')}</span>
                                )}
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                    isApproved
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : isSkipped
                                      ? 'bg-slate-800 text-slate-400'
                                      : 'bg-purple-500/20 text-purple-300'
                                  }`}
                                >
                                  {draft.status || 'Generated'}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setActiveRegenLead(draft);
                                    setCustomRegenInstruction('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-purple-400 text-xs font-semibold"
                                  title="Regenerate with custom AI prompt"
                                >
                                  🔄 Re-prompt
                                </button>
                                <button
                                  onClick={() => (isEditing ? saveEditingDraft() : startEditingDraft(draft))}
                                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-400 text-xs font-semibold"
                                >
                                  {isEditing ? 'Save' : '✏️ Edit'}
                                </button>
                                <button
                                  onClick={() => handleToggleApproveDraft(draft._id || draft.id)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                    isApproved
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                      : 'bg-white/5 text-slate-300 hover:text-emerald-400'
                                  }`}
                                >
                                  {isApproved ? '✓ Approved' : 'Approve'}
                                </button>
                                <button
                                  onClick={() => handleSkipDraft(draft._id || draft.id)}
                                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 text-xs"
                                  title="Skip this lead"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 space-y-2">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={editSubject}
                                    onChange={e => setEditSubject(e.target.value)}
                                    className="w-full bg-[#121624] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                                  />
                                  <textarea
                                    rows={4}
                                    value={editBody}
                                    onChange={e => setEditBody(e.target.value)}
                                    className="w-full bg-[#121624] border border-white/10 rounded-lg p-2.5 text-xs text-slate-200 resize-none font-mono"
                                  />
                                </div>
                              ) : (
                                <>
                                  <div className="text-xs font-bold text-cyan-300">
                                    Subject: <span className="text-slate-200 font-normal">{draft.subject}</span>
                                  </div>
                                  <div className="text-xs text-slate-300 whitespace-pre-wrap font-sans bg-black/20 p-3 rounded-xl border border-white/5 leading-relaxed">
                                    {draft.body}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 bg-[#07090e] border border-white/8 rounded-2xl p-6">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>👁️</span> Live Template Sample Preview
                    </h3>
                    <div className="bg-[#121624] border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="text-xs font-bold text-cyan-400">
                        Subject: <span className="text-white font-normal">{samplePreview.subject}</span>
                      </div>
                      <div className="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed border-t border-white/5 pt-3">
                        {samplePreview.body}
                      </div>
                    </div>
                  </div>
                )}

                {/* Send Live Test Email to Admin Box */}
                <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <span>📬</span> Dispatch Live Verification Test Email
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Send a rendered test sample directly to your email inbox to verify layout and SPF/DKIM delivery.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={e => setTestEmail(e.target.value)}
                      placeholder="admin@8020acquisition.com"
                      className="bg-[#121624] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 w-60"
                    />
                    <button
                      onClick={handleSendTestEmail}
                      disabled={sendingTest}
                      className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs disabled:opacity-50 transition-all shrink-0"
                    >
                      {sendingTest ? 'Sending...' : 'Send Test'}
                    </button>
                  </div>
                </div>

                {testResult.message && (
                  <div
                    className={`p-3 rounded-xl text-xs font-semibold ${
                      testResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                    }`}
                  >
                    {testResult.message}
                  </div>
                )}

                {/* Step 3 Actions */}
                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:text-white text-xs font-semibold"
                  >
                    ← Back to Config
                  </button>

                  <button
                    onClick={handleLaunchCampaign}
                    disabled={submitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-black text-xs hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                        <span>Dispatching Campaign Queue...</span>
                      </>
                    ) : (
                      <span>🚀 Launch &amp; Dispatch Campaign Now →</span>
                    )}
                  </button>
                </div>

                {submitError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
                    {submitError}
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: DISPATCH & EXECUTION PROGRESS */}
            {step === 4 && (
              <div className="space-y-6 py-8 text-center max-w-lg mx-auto">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white text-2xl mx-auto shadow-xl shadow-emerald-500/20 animate-bounce">
                  ✓
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-black text-white">Campaign Dispatched Successfully!</h3>
                  <p className="text-xs text-slate-400">
                    Your campaign has been queued. Open campaign progress to monitor delivery.
                  </p>
                </div>

                <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 grid grid-cols-2 gap-4 text-left">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500">Messages Dispatched</span>
                    <p className="text-lg font-black text-cyan-400">{dispatchProgress.sent}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500">Sender Identity</span>
                    <p className="text-xs font-semibold text-slate-200 truncate">outreach@8020acquisition.com</p>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      setStep(1);
                      setActiveTab('campaigns');
                      fetchCampaigns();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all"
                  >
                    View Campaign Telemetry
                  </button>
                  <button
                    onClick={() => {
                      setStep(1);
                      setAiDrafts([]);
                      setCampaignName('');
                      setTemplateSubject('');
                      setTemplateBody('');
                    }}
                    className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black transition-all shadow-lg shadow-cyan-500/20"
                  >
                    Create Another Blast
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DISPATCHED CAMPAIGNS & TELEMETRY */}
        {activeTab === 'campaigns' && (
          <div className="bg-[#121624] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📋</span> Dispatched Outbound Campaigns ({campaigns.length})
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time status tracking, recipient breakdown, and engagement metrics.
                </p>
              </div>
              <button
                onClick={fetchCampaigns}
                className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold"
              >
                🔄 Refresh
              </button>
            </div>

            {campaigns.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500 border border-white/5 rounded-2xl bg-[#07090e]">
                No campaigns dispatched yet. Switch to the <strong>New Campaign</strong> tab to launch your first blast.
              </div>
            ) : (
              <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#07090e] divide-y divide-white/5">
                {campaigns.map(camp => {
                  const id = camp._id || camp.id;
                  const total = camp.stats?.total || camp.leadIds?.length || 0;
                  const sent = camp.stats?.sent || total;
                  const failed = camp.stats?.failed || 0;

                  return (
                    <div key={id} className="p-4 hover:bg-white/[0.02] flex items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate">{camp.name || 'Unnamed Campaign'}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              camp.status === 'completed' || camp.status === 'running'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-cyan-500/20 text-cyan-400'
                            }`}
                          >
                            {camp.status || 'Dispatched'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">
                          Subject: {camp.templateSubject || camp.subject || 'Personalized AI Subject'}
                        </p>
                        <div className="text-[10px] text-slate-500">
                          Dispatched: {camp.createdAt ? new Date(camp.createdAt).toLocaleString() : '—'}
                        </div>
                      </div>

                      <div className="flex items-center gap-6 shrink-0 text-right">
                        <div>
                          <div className="text-xs font-bold text-slate-200">
                            {sent} / {total}
                          </div>
                          <div className="text-[10px] text-slate-500">Sent / Total</div>
                        </div>

                        {failed > 0 && (
                          <div>
                            <div className="text-xs font-bold text-rose-400">{failed}</div>
                            <div className="text-[10px] text-rose-500">Failed</div>
                          </div>
                        )}

                        <button
                          onClick={() => setSelectedCampaign(camp)}
                          className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-400 text-xs font-semibold"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CLAUDE AI TELEMETRY & USAGE */}
        {activeTab === 'ai-usage' && (
          <div className="bg-[#121624] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🤖</span> Anthropic Claude 3.5 Sonnet Usage Telemetry
                </h3>
                <p className="text-xs text-slate-400">
                  Monitor token consumption, real-time AI email generation costs, and quota efficiency.
                </p>
              </div>
              <span className="text-xs font-mono text-purple-400 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">
                Model: claude-3-5-sonnet-20241022
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-500">Total AI Emails Generated</span>
                <p className="text-2xl font-black text-purple-400">
                  {aiGenerationsCount}
                </p>
                <p className="text-[10px] text-slate-500">Individualized personalizations</p>
              </div>

              <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-500">Estimated Tokens Consumed</span>
                <p className="text-2xl font-black text-cyan-400">
                  {(aiTokensCount || 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-500">Prompt &amp; completion tokens</p>
              </div>

              <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-500">Estimated API Cost</span>
                <p className="text-2xl font-black text-emerald-400">
                  {aiCostDisplay}
                </p>
                <p className="text-[10px] text-slate-500">Calculated at Sonnet 3.5 tiered rates</p>
              </div>
            </div>

            <div className="bg-[#07090e] border border-white/8 rounded-2xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-white">AI Personalization Best Practices</h4>
              <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
                <li>Keep custom prompts concise to maximize Sonnet 3.5 speed and token economics.</li>
                <li>Verify company and industry fields on leads for highest contextual relevance.</li>
                <li>Use the Per-Lead Re-prompt button in review screen to dial in specific edge-case prospects.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 4: ENGINE SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <BlastEngineSettingsCard />
          </div>
        )}
      </main>

      {/* SINGLE LEAD RE-PROMPT MODAL */}
      {activeRegenLead && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121624] border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🔄</span> Re-generate with Claude AI
              </h3>
              <button
                onClick={() => setActiveRegenLead(null)}
                className="text-slate-500 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-400">
              Custom instructions for{' '}
              <strong className="text-slate-200">{activeRegenLead.leadName || activeRegenLead.leadEmail}</strong>
              {activeRegenLead.company ? ` (${typeof activeRegenLead.company === 'string' ? activeRegenLead.company : (activeRegenLead.company?.name || '')})` : ''}:
            </div>

            <textarea
              rows={4}
              value={customRegenInstruction}
              onChange={e => setCustomRegenInstruction(e.target.value)}
              placeholder="e.g. Make it much shorter (under 40 words), emphasize rapid onboarding, and use a friendly conversational tone."
              className="w-full bg-[#07090e] border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-mono"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setActiveRegenLead(null)}
                className="px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:text-white text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerateSingle}
                disabled={isRegeneratingSingle}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold text-xs disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {isRegeneratingSingle ? 'Generating...' : 'Regenerate Draft →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CAMPAIGN DETAILS MODAL */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121624] border border-white/10 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📋</span> Campaign Details: {selectedCampaign.name}
              </h3>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="text-slate-500 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div>
                <span className="font-bold text-slate-400">Subject: </span>
                <span>{selectedCampaign.templateSubject || selectedCampaign.subject}</span>
              </div>
              <div>
                <span className="font-bold text-slate-400">Status: </span>
                <span className="capitalize">{selectedCampaign.status}</span>
              </div>
              <div>
                <span className="font-bold text-slate-400">Recipients Count: </span>
                <span>{selectedCampaign.leadIds?.length || selectedCampaign.stats?.total || 0} leads</span>
              </div>
              <div className="border-t border-white/5 pt-3">
                <span className="font-bold text-slate-400 block mb-1">Body Template:</span>
                <div className="bg-[#07090e] p-3 rounded-xl border border-white/5 font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedCampaign.templateBody || selectedCampaign.body || '(Dynamic AI generated bodies)'}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedCampaign(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
