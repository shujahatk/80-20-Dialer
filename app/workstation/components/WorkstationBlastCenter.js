"use client";

import { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '@/lib/apiClient';

export default function WorkstationBlastCenter({ user }) {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);
  const [leads, setLeads] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [activeTab, setActiveTab] = useState('composer'); // 'composer' | 'my-campaigns' | 'telemetry' | 'ai-usage'

  // Wizard state: 1: Recipients & Mode, 2: Content/AI Config, 3: AI Review / Test, 4: Confirm & Launch
  const [step, setStep] = useState(1);

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('default');

  // Mode Selection: 'standard' | 'ai_personalized'
  const [emailMode, setEmailMode] = useState('standard');

  // AI Personalization Configuration
  const [emailGoal, setEmailGoal] = useState('Cold outreach');
  const [tone, setTone] = useState('Professional');
  const [emailLength, setEmailLength] = useState('Short');
  const [userInstructions, setUserInstructions] = useState('');
  const [generateAiSubjects, setGenerateAiSubjects] = useState(true);
  const [offerDescription, setOfferDescription] = useState('Automated outbound sales dialer and email pipeline to accelerate demo bookings');

  // AI Generation & Review State
  const [aiDrafts, setAiDrafts] = useState([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [aiError, setAiError] = useState('');
  const [showCostWarning, setShowCostWarning] = useState(false);

  // Per-Lead Regeneration Modal State
  const [activeRegenLead, setActiveRegenLead] = useState(null);
  const [customRegenInstruction, setCustomRegenInstruction] = useState('');
  const [isRegeneratingSingle, setIsRegeneratingSingle] = useState(false);

  // Editing state for drafts in review screen
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Filters for recipient selection
  const [recipientScope, setRecipientScope] = useState('my-leads'); // 'my-leads' | 'all'
  const [statusFilter, setStatusFilter] = useState('all');
  const [leadSelectionMap, setLeadSelectionMap] = useState({});

  // Test Email state
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState({ success: null, message: '' });

  // Creation & Launch State
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [dispatchProgress, setDispatchProgress] = useState({ sent: 0, total: 0, completed: false });

  // Active Telemetry Campaign & AI Stats
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [aiUsageStats, setAiUsageStats] = useState(null);

  useEffect(() => {
    if (user?.email) {
      setTestEmail(user.email);
    }
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const leadRes = await apiRequest('/api/leads', 'GET');
      if (leadRes.success && leadRes.data) {
        setLeads(leadRes.data);
        const map = {};
        leadRes.data.forEach(l => { map[l._id || l.id] = true; });
        setLeadSelectionMap(map);
      }

      setInboxes([
        { _id: 'default', name: 'Default Outbound Identity', fromEmail: 'outreach@8020acquisition.com', fromName: '80/20 Acquisition', dailyLimit: 500, sentToday: 12 }
      ]);

      fetchCampaigns();
      fetchAiUsage();
    } catch (err) {
      console.error('Failed to load workstation blast data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await apiRequest('/api/workstation/blasts', 'GET');
      if (res.success && res.data) {
        setCampaigns(res.data);
      }
    } catch (e) {
      console.error('Error loading campaigns:', e);
    }
  };

  const fetchAiUsage = async () => {
    try {
      const res = await apiRequest('/api/ai/personalize/usage', 'GET');
      if (res.success && res.data) {
        setAiUsageStats(res.data);
      }
    } catch (e) {
      console.error('Error loading AI usage:', e);
    }
  };

  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      const leadId = lead._id || lead.id;
      if (recipientScope === 'my-leads' && user) {
        const assigned = lead.assignedTo || lead.assigned_to;
        if (assigned && assigned !== user._id && assigned !== user.id) {
          return false;
        }
      }
      if (statusFilter !== 'all' && lead.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [leads, recipientScope, statusFilter, user]);

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

  const handleSelectAll = (checked) => {
    const newMap = { ...leadSelectionMap };
    filteredLeads.forEach(l => { newMap[l._id || l.id] = checked; });
    setLeadSelectionMap(newMap);
  };

  // --- AI Batch Personalization Handler ---
  const handleStartAiGeneration = async () => {
    const selectedLeadIds = filteredLeads
      .filter(l => leadSelectionMap[l._id || l.id] && !l.suppression?.email && (l.email || l.contact?.email))
      .map(l => l._id || l.id);

    if (selectedLeadIds.length === 0) {
      setSubmitError('Please select at least one valid lead with an email address.');
      return;
    }

    // Cost safeguard warning for > 25 leads
    if (selectedLeadIds.length > 25 && !showCostWarning) {
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

      if (res.success && res.drafts) {
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
  };

  // --- Per-Lead Regeneration Handler ---
  const handleRegenerateSingle = async () => {
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
        setAiDrafts(prev => prev.map(d => (d._id === activeRegenLead._id || d.leadId === activeRegenLead.leadId ? res.draft : d)));
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
  };

  // --- Approve / Skip Individual Drafts ---
  const handleToggleApproveDraft = (draftId) => {
    setAiDrafts(prev => prev.map(d => {
      if (d._id === draftId || d.id === draftId) {
        const nextStatus = d.status === 'approved' ? 'generated' : 'approved';
        return { ...d, status: nextStatus };
      }
      return d;
    }));
  };

  const handleSkipDraft = (draftId) => {
    setAiDrafts(prev => prev.map(d => {
      if (d._id === draftId || d.id === draftId) {
        return { ...d, status: 'skipped' };
      }
      return d;
    }));
  };

  const handleApproveAllDrafts = () => {
    setAiDrafts(prev => prev.map(d => d.status !== 'skipped' && d.status !== 'generation_failed' ? { ...d, status: 'approved' } : d));
  };

  // --- Inline Editing of Drafts ---
  const startEditingDraft = (draft) => {
    setEditingDraftId(draft._id || draft.id);
    setEditSubject(draft.subject || '');
    setEditBody(draft.body || '');
  };

  const saveEditingDraft = () => {
    if (!editingDraftId) return;
    setAiDrafts(prev => prev.map(d => {
      if (d._id === editingDraftId || d.id === editingDraftId) {
        return { ...d, subject: editSubject, body: editBody, status: 'approved' };
      }
      return d;
    }));
    setEditingDraftId(null);
  };

  // --- Launch & Dispatch Final Emails ---
  const handleLaunchCampaign = async () => {
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
          setDispatchProgress({ sent: res.sentCount || approvedDrafts.length, total: approvedDrafts.length, completed: true });
          setStep(4);
          fetchCampaigns();
        } else {
          setSubmitError(res.message || 'Failed to dispatch AI personalized emails.');
        }
      } else {
        // Standard Email Campaign Creation
        const selectedLeadIds = filteredLeads
          .filter(l => leadSelectionMap[l._id || l.id] && !l.suppression?.email && (l.email || l.contact?.email))
          .map(l => l._id || l.id);

        if (selectedLeadIds.length === 0) {
          setSubmitError('No eligible leads selected.');
          setSubmitting(false);
          return;
        }

        const res = await apiRequest('/api/workstation/blasts', 'POST', {
          name: campaignName || `Standard Campaign - ${new Date().toLocaleDateString()}`,
          description,
          type: 'email',
          templateSubject: templateSubject || 'Outbound Collaboration',
          templateBody: templateBody || 'Hello {{firstName}},\n\nI wanted to reach out regarding our outbound acquisition platform.',
          useAiPersonalization: false,
          leadIds: selectedLeadIds,
          sendingInboxId: selectedInboxId
        });

        if (res.success) {
          setDispatchProgress({ sent: selectedLeadIds.length, total: selectedLeadIds.length, completed: true });
          setStep(4);
          fetchCampaigns();
        } else {
          setSubmitError(res.error?.message || 'Failed to create standard blast campaign.');
        }
      }
    } catch (err) {
      setSubmitError(err.message || 'An error occurred during campaign launch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) return;
    setSendingTest(true);
    setTestResult({ success: null, message: '' });
    try {
      const res = await apiRequest('/api/workstation/blasts/test-send', 'POST', {
        testEmail,
        subject: templateSubject || 'Sample Test Subject',
        templateBody: templateBody || 'Hi {{firstName}}, this is a test email from 80/20 Outbound.',
        useAiPersonalization: emailMode === 'ai_personalized',
        tone
      });
      if (res.success) {
        setTestResult({ success: true, message: `✓ Test email sent to ${testEmail}` });
      } else {
        setTestResult({ success: false, message: res.error?.message || 'Failed to send test email.' });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Test send failed.' });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🚀</span> Outbound Campaign Engine
          </h2>
          <p className="text-sm text-slate-400">
            Dispatch high-velocity standard email blasts or individualized AI-personalized cold outreach.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('composer')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'composer' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            ✏️ New Campaign
          </button>
          <button
            onClick={() => { setActiveTab('my-campaigns'); fetchCampaigns(); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'my-campaigns' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            📋 Dispatched Campaigns ({campaigns.length})
          </button>
          <button
            onClick={() => { setActiveTab('ai-usage'); fetchAiUsage(); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'ai-usage' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🤖 Claude AI Usage
          </button>
        </div>
      </div>

      {/* Tab 1: Composer & Wizard */}
      {activeTab === 'composer' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
          {/* Wizard Step Indicator */}
          <div className="grid grid-cols-4 gap-3 text-center pb-4 border-b border-slate-800">
            {[
              { num: 1, label: '1. Select Recipients' },
              { num: 2, label: emailMode === 'ai_personalized' ? '2. Claude AI Config' : '2. Template & Content' },
              { num: 3, label: emailMode === 'ai_personalized' ? '3. AI Review & Edit' : '3. Preview & Test' },
              { num: 4, label: '4. Dispatch & Results' }
            ].map(s => (
              <div
                key={s.num}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                  step === s.num
                    ? 'bg-sky-600/20 border-sky-500 text-sky-400 shadow-sm'
                    : step > s.num
                    ? 'bg-slate-800/60 border-slate-700 text-emerald-400'
                    : 'bg-slate-900/40 border-slate-800 text-slate-500'
                }`}
              >
                {s.label}
              </div>
            ))}
          </div>

          {/* STEP 1: Select Recipients & Mode */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Mode Selection Box */}
              <div>
                <label className="block text-sm font-semibold text-white mb-2">
                  Choose Email Delivery Mode <span className="text-rose-400">*</span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    onClick={() => setEmailMode('standard')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      emailMode === 'standard'
                        ? 'bg-sky-950/40 border-sky-500 ring-1 ring-sky-500 text-white'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="emailMode"
                        checked={emailMode === 'standard'}
                        onChange={() => setEmailMode('standard')}
                        className="text-sky-500"
                      />
                      <div>
                        <div className="font-bold text-white text-sm">Option A — Standard Email Blast</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Sends standard template-based emails. <strong>Zero Claude API calls (0 token cost)</strong>.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={() => setEmailMode('ai_personalized')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      emailMode === 'ai_personalized'
                        ? 'bg-purple-950/40 border-purple-500 ring-1 ring-purple-500 text-white'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="emailMode"
                        checked={emailMode === 'ai_personalized'}
                        onChange={() => setEmailMode('ai_personalized')}
                        className="text-purple-500"
                      />
                      <div>
                        <div className="font-bold text-white text-sm flex items-center gap-1.5">
                          <span>Option B — AI Personalized Email (Claude)</span>
                          <span className="bg-purple-500/20 text-purple-300 text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30">Claude 3.5</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Generates individualized, high-converting cold outreach tailored to each prospect's company and role with mandatory review before sending.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recipient Selection Controls */}
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleSelectAll(true)}
                      className="text-xs px-2.5 py-1 bg-slate-700 text-slate-200 hover:bg-slate-600 rounded transition-all"
                    >
                      Select All Filtered ({filteredLeads.length})
                    </button>
                    <button
                      onClick={() => handleSelectAll(false)}
                      className="text-xs px-2.5 py-1 bg-slate-800 text-slate-400 hover:text-white rounded border border-slate-700 transition-all"
                    >
                      Deselect All
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <select
                      value={recipientScope}
                      onChange={(e) => setRecipientScope(e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5"
                    >
                      <option value="my-leads">My Assigned Leads</option>
                      <option value="all">All Available Leads</option>
                    </select>

                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5"
                    >
                      <option value="all">All Stages</option>
                      <option value="NEW">New Leads</option>
                      <option value="CONTACTED">Contacted</option>
                      <option value="FOLLOW_UP">Follow Up</option>
                      <option value="ENGAGED">Engaged</option>
                    </select>
                  </div>
                </div>

                {/* Recipient Metrics */}
                <div className="grid grid-cols-4 gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-center">
                  <div>
                    <div className="text-lg font-bold text-white">{recipientStats.totalSelected}</div>
                    <div className="text-[11px] text-slate-400">Total Selected</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-emerald-400">{recipientStats.eligible}</div>
                    <div className="text-[11px] text-slate-400">Eligible to Send</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-rose-400">{recipientStats.suppressed}</div>
                    <div className="text-[11px] text-slate-400">Opted-Out / Suppressed</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-amber-400">{recipientStats.missingEmail}</div>
                    <div className="text-[11px] text-slate-400">Missing Email</div>
                  </div>
                </div>

                {/* Lead Table preview */}
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-700/60">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-700">
                      <tr>
                        <th className="p-2.5 w-10 text-center">Select</th>
                        <th className="p-2.5">Prospect Name</th>
                        <th className="p-2.5">Company</th>
                        <th className="p-2.5">Email</th>
                        <th className="p-2.5">Stage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredLeads.map(lead => {
                        const id = lead._id || lead.id;
                        const isSelected = Boolean(leadSelectionMap[id]);
                        const email = lead.contact?.email || lead.email;
                        return (
                          <tr key={id} className="hover:bg-slate-800/40">
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => setLeadSelectionMap(prev => ({ ...prev, [id]: e.target.checked }))}
                                className="rounded text-sky-500"
                              />
                            </td>
                            <td className="p-2.5 font-medium text-white">
                              {typeof lead.name === 'string' ? lead.name : (lead.contact?.name || lead.name?.name || 'N/A')}
                            </td>
                            <td className="p-2.5 text-slate-400">
                              {typeof lead.company === 'string' ? lead.company : (lead.company?.name || '—')}
                            </td>
                            <td className="p-2.5">{email || <span className="text-rose-400">Missing</span>}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-sky-400">
                                {lead.stage || 'NEW'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  disabled={recipientStats.eligible === 0}
                  onClick={() => setStep(2)}
                  className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-lg transition-all"
                >
                  Continue to {emailMode === 'ai_personalized' ? 'Claude AI Setup' : 'Template Setup'} →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Content or Claude AI Configuration */}
          {step === 2 && (
            <div className="space-y-6">
              {emailMode === 'ai_personalized' ? (
                /* AI Personalization Config Panel */
                <div className="space-y-5">
                  <div className="bg-purple-950/20 border border-purple-800/40 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-purple-300 flex items-center gap-2">
                        <span>🤖</span> Claude AI Personalization Engine
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Each prospect ({recipientStats.eligible} selected) will receive an individualized email adhering to strict anti-hallucination rules.
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold px-2.5 py-1 bg-purple-900/60 text-purple-200 border border-purple-700 rounded-lg">
                        Opt-In Mode: Active
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Email Goal */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Goal</label>
                      <select
                        value={emailGoal}
                        onChange={(e) => setEmailGoal(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        <option value="Cold outreach">Cold outreach</option>
                        <option value="Sales introduction">Sales introduction</option>
                        <option value="Follow-up">Follow-up</option>
                        <option value="Book a meeting">Book a meeting</option>
                        <option value="Product/service introduction">Product/service introduction</option>
                        <option value="Partnership">Partnership</option>
                        <option value="Lead re-engagement">Lead re-engagement</option>
                      </select>
                    </div>

                    {/* Tone */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tone</label>
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        <option value="Professional">Professional</option>
                        <option value="Friendly">Friendly</option>
                        <option value="Conversational">Conversational</option>
                        <option value="Direct">Direct</option>
                        <option value="Consultative">Consultative</option>
                      </select>
                    </div>

                    {/* Email Length */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Length</label>
                      <select
                        value={emailLength}
                        onChange={(e) => setEmailLength(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        <option value="Short">Short (50-90 words, Default)</option>
                        <option value="Medium">Medium (90-140 words)</option>
                        <option value="Detailed">Detailed (140-200 words)</option>
                      </select>
                    </div>
                  </div>

                  {/* Value Prop Offer */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Offer / Value Proposition</label>
                    <input
                      type="text"
                      value={offerDescription}
                      onChange={(e) => setOfferDescription(e.target.value)}
                      placeholder="e.g. Automated outbound dialer and email pipeline..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    />
                  </div>

                  {/* User Instructions */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      User Instructions (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={userInstructions}
                      onChange={(e) => setUserInstructions(e.target.value)}
                      placeholder="Tell Claude anything specific you want included in these emails (e.g. 'Mention our automated outbound platform and ask if they are currently looking for a solution to improve sales outreach')."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    />
                  </div>

                  {/* AI Subject Lines Toggle */}
                  <div className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/60 rounded-lg">
                    <input
                      type="checkbox"
                      id="aiSubj"
                      checked={generateAiSubjects}
                      onChange={(e) => setGenerateAiSubjects(e.target.checked)}
                      className="rounded text-purple-500"
                    />
                    <label htmlFor="aiSubj" className="text-xs text-slate-300 cursor-pointer">
                      <strong>Generate AI Subject Lines</strong> (Generates unique, non-clickbait subject lines under 7 words for each prospect)
                    </label>
                  </div>

                  {aiError && (
                    <div className="p-3 bg-rose-900/30 border border-rose-700 text-rose-300 text-xs rounded-lg">
                      {aiError}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex justify-between items-center pt-4">
                    <button
                      onClick={() => setStep(1)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                    >
                      ← Back to Recipients
                    </button>
                    <button
                      disabled={generatingAi}
                      onClick={handleStartAiGeneration}
                      className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-lg flex items-center gap-2"
                    >
                      {generatingAi ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          <span>Generating ({aiProgress.current}/{aiProgress.total})...</span>
                        </>
                      ) : (
                        <>
                          <span>✨</span>
                          <span>Generate Personalized Emails ({recipientStats.eligible})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                /* Standard Template Email Config */
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Campaign Name</label>
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="e.g. Q4 SaaS Growth Outreach"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Sending Identity</label>
                      <select
                        value={selectedInboxId}
                        onChange={(e) => setSelectedInboxId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        {inboxes.map(ib => (
                          <option key={ib._id} value={ib._id}>
                            {ib.fromName} &lt;{ib.fromEmail}&gt;
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Subject Line</label>
                    <input
                      type="text"
                      value={templateSubject}
                      onChange={(e) => setTemplateSubject(e.target.value)}
                      placeholder="e.g. Quick question regarding {{company}}"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Email Body Template (Available tags: <code className="text-sky-400">{'{{firstName}}'}</code>, <code className="text-sky-400">{'{{company}}'}</code>)
                    </label>
                    <textarea
                      rows={6}
                      value={templateBody}
                      onChange={(e) => setTemplateBody(e.target.value)}
                      placeholder="Hi {{firstName}},\n\nI was reviewing {{company}} and wanted to reach out regarding our outbound acquisition platform..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>

                  {/* Send Test Box */}
                  <div className="p-3 bg-slate-800/40 border border-slate-700 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="test@yourcompany.com"
                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-white"
                      />
                      <button
                        onClick={handleSendTestEmail}
                        disabled={sendingTest || !testEmail}
                        className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold rounded"
                      >
                        {sendingTest ? 'Sending...' : 'Send Test'}
                      </button>
                    </div>
                    {testResult.message && (
                      <span className={`text-xs ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {testResult.message}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-4">
                    <button
                      onClick={() => setStep(1)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                    >
                      ← Back to Recipients
                    </button>
                    <button
                      onClick={handleLaunchCampaign}
                      disabled={submitting || !templateSubject || !templateBody}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-lg"
                    >
                      {submitting ? 'Dispatching...' : `Dispatch Standard Emails (${recipientStats.eligible}) →`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: AI Review & Edit Screen */}
          {step === 3 && emailMode === 'ai_personalized' && (
            <div className="space-y-6">
              {/* Review Header Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-purple-950/30 border border-purple-800/40 rounded-xl">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>📋</span> AI Review & Edit Dashboard ({aiDrafts.length} Drafts)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Review, edit, or regenerate each email individually. Only approved drafts will be queued for dispatch.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleApproveAllDrafts}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md transition-all flex items-center gap-1.5"
                  >
                    <span>✓</span> Approve All ({aiDrafts.filter(d => d.status !== 'skipped' && d.status !== 'generation_failed').length})
                  </button>
                  <button
                    onClick={handleStartAiGeneration}
                    disabled={generatingAi}
                    className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all"
                  >
                    🔄 Regenerate All
                  </button>
                </div>
              </div>

              {/* Drafts Cards List */}
              <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
                {aiDrafts.map((draft, idx) => {
                  const draftId = draft._id || draft.id || `draft_${idx}`;
                  const isEditing = editingDraftId === draftId;
                  const isApproved = draft.status === 'approved';
                  const isSkipped = draft.status === 'skipped';
                  const isFailed = draft.status === 'generation_failed';

                  return (
                    <div
                      key={draftId}
                      className={`p-4 rounded-xl border transition-all ${
                        isApproved
                          ? 'bg-emerald-950/20 border-emerald-500/40 ring-1 ring-emerald-500/20'
                          : isSkipped
                          ? 'bg-slate-900/40 border-slate-800 opacity-60'
                          : isFailed
                          ? 'bg-rose-950/20 border-rose-700/50'
                          : 'bg-slate-800/40 border-slate-700/80 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-xs font-bold text-purple-300">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="font-bold text-white text-sm flex items-center gap-2">
                              <span>{typeof draft.lead?.name === 'string' ? draft.lead.name : (draft.lead?.contact?.name || draft.lead?.name?.name || 'Prospect')}</span>
                              <span className="text-xs font-normal text-slate-400">({typeof draft.lead?.company === 'string' ? draft.lead.company : (draft.lead?.company?.name || 'Company')})</span>
                            </div>
                            <div className="text-[11px] text-slate-500">{draft.lead?.email}</div>
                          </div>
                        </div>

                        {/* Status Badge & Actions */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isApproved
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : isSkipped
                                ? 'bg-slate-700 text-slate-400'
                                : isFailed
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {isApproved ? '✓ APPROVED' : isSkipped ? 'SKIPPED' : isFailed ? 'FAILED' : 'PENDING REVIEW'}
                          </span>

                          <button
                            onClick={() => {
                              setActiveRegenLead(draft);
                              setCustomRegenInstruction('');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-purple-300 hover:text-purple-200 text-xs font-semibold rounded transition-all flex items-center gap-1"
                          >
                            <span>🔄</span> Regenerate
                          </button>

                          <button
                            onClick={() => handleToggleApproveDraft(draftId)}
                            className={`px-2.5 py-1 text-xs font-bold rounded transition-all ${
                              isApproved
                                ? 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                            }`}
                          >
                            {isApproved ? 'Unapprove' : '✓ Approve'}
                          </button>

                          <button
                            onClick={() => handleSkipDraft(draftId)}
                            className="px-2 py-1 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 text-xs rounded border border-slate-700 transition-all"
                            title="Skip this lead"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Content Section */}
                      {isEditing ? (
                        <div className="space-y-3 pt-2">
                          <div>
                            <label className="text-[11px] font-semibold text-slate-400 block mb-1">Subject Line</label>
                            <input
                              type="text"
                              value={editSubject}
                              onChange={(e) => setEditSubject(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-slate-400 block mb-1">Email Body</label>
                            <textarea
                              rows={5}
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingDraftId(null)}
                              className="px-3 py-1 bg-slate-800 text-slate-400 text-xs rounded"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveEditingDraft}
                              className="px-4 py-1 bg-emerald-600 text-white text-xs font-bold rounded shadow"
                            >
                              Save & Approve
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                              <span>Subject:</span>
                              <span className="text-slate-200">{draft.subject || '—'}</span>
                            </div>
                            <button
                              onClick={() => startEditingDraft(draft)}
                              className="text-[11px] text-slate-400 hover:text-sky-300 underline"
                            >
                              Edit Copy
                            </button>
                          </div>
                          <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {draft.body || <span className="text-rose-400 italic">No body generated</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {submitError && (
                <div className="p-3 bg-rose-900/30 border border-rose-700 text-rose-300 text-xs rounded-lg">
                  {submitError}
                </div>
              )}

              {/* Bottom Navigation */}
              <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                >
                  ← Back to AI Config
                </button>
                <button
                  onClick={handleLaunchCampaign}
                  disabled={submitting || aiDrafts.filter(d => d.status === 'approved' || d.status === 'generated').length === 0}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-xl flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                      <span>Dispatching Approved Emails...</span>
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      <span>
                        Launch & Dispatch Approved Emails (
                        {aiDrafts.filter(d => d.status === 'approved' || d.status === 'generated').length}
                        )
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Campaign Dispatched Results */}
          {step === 4 && (
            <div className="space-y-6 text-center py-8">
              <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded-full flex items-center justify-center text-3xl mx-auto">
                ✓
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Campaign Dispatched Successfully!</h3>
                <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                  {dispatchProgress.sent} emails were queued and dispatched through the Resend outbound delivery engine with RFC 8058 deliverability headers.
                </p>
              </div>
              <div className="flex justify-center gap-4 pt-4">
                <button
                  onClick={() => {
                    setStep(1);
                    setAiDrafts([]);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg"
                >
                  Create Another Campaign
                </button>
                <button
                  onClick={() => setActiveTab('my-campaigns')}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow"
                >
                  View Campaigns List →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Dispatched Campaigns List */}
      {activeTab === 'my-campaigns' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Dispatched Campaigns</h3>
            <button
              onClick={fetchCampaigns}
              className="text-xs px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              Refresh
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No campaigns dispatched yet. Create your first campaign in the New Campaign tab.
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map(camp => (
                <div key={camp._id} className="p-4 bg-slate-800/40 border border-slate-700 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white text-sm">{camp.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Recipients: {camp.stats?.total || camp.leadIds?.length || 0} • Status: <span className="text-emerald-400">{camp.status}</span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Date(camp.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Claude AI Usage Telemetry */}
      {activeTab === 'ai-usage' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🤖</span> Claude AI Usage & Token Telemetry
            </h3>
            <p className="text-xs text-slate-400">
              Real-time audit log of Anthropic Claude token consumption, costs, and generation status.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/60 text-center">
              <div className="text-2xl font-bold text-white">{aiUsageStats?.totalGenerations || 0}</div>
              <div className="text-xs text-slate-400 mt-1">Total Emails Generated</div>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/60 text-center">
              <div className="text-2xl font-bold text-emerald-400">{aiUsageStats?.successfulGenerations || 0}</div>
              <div className="text-xs text-slate-400 mt-1">Successful (100%)</div>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/60 text-center">
              <div className="text-2xl font-bold text-purple-400">{aiUsageStats?.totalTokens?.toLocaleString() || 0}</div>
              <div className="text-xs text-slate-400 mt-1">Total Tokens Used</div>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/60 text-center">
              <div className="text-2xl font-bold text-amber-400">{aiUsageStats?.totalEstimatedCost || '$0.00'}</div>
              <div className="text-xs text-slate-400 mt-1">Estimated Cost</div>
            </div>
          </div>

          {/* Recent Generation Logs */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent AI API Calls</h4>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="p-2.5">Model</th>
                    <th className="p-2.5">Input Tokens</th>
                    <th className="p-2.5">Output Tokens</th>
                    <th className="p-2.5">Estimated Cost</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {aiUsageStats?.recentLogs?.map((log, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="p-2.5 text-purple-300 font-mono">{log.model}</td>
                      <td className="p-2.5">{log.inputTokens}</td>
                      <td className="p-2.5">{log.outputTokens}</td>
                      <td className="p-2.5 text-amber-300">${log.estimatedCost}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-500">{new Date(log.createdAt).toLocaleTimeString()}</td>
                    </tr>
                  )) || (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-500">No usage logs available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Single Lead Regeneration Modal */}
      {activeRegenLead && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🔄</span> Regenerate Email for {activeRegenLead.lead?.name || 'Prospect'}
            </h3>
            <p className="text-xs text-slate-400">
              Provide custom instructions for Claude (e.g. &quot;Make this more conversational, keep it under 50 words, and ask for a Tuesday call&quot;).
            </p>
            <textarea
              rows={3}
              value={customRegenInstruction}
              onChange={(e) => setCustomRegenInstruction(e.target.value)}
              placeholder="e.g. Highlight our CRM integration and make the tone more direct."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs text-white"
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setActiveRegenLead(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                disabled={isRegeneratingSingle}
                onClick={handleRegenerateSingle}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-2"
              >
                {isRegeneratingSingle ? 'Regenerating...' : '✨ Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cost Warning Safeguard Modal */}
      {showCostWarning && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/50 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 font-bold text-base">
              <span>⚠️</span> Large Batch AI Generation Warning
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              You are about to generate individualized emails for <strong>{recipientStats.eligible} leads</strong> using Anthropic Claude. This will consume API credits.
            </p>
            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => setShowCostWarning(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleStartAiGeneration}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg shadow-lg"
              >
                Continue & Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
