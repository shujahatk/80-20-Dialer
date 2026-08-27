"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

export default function WorkstationBlastEmail() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Data states
  const [campaigns, setCampaigns] = useState([]);
  const [leads, setLeads] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [activeTab, setActiveTab] = useState('composer'); // 'composer' | 'my-campaigns' | 'telemetry'

  // Wizard state: 1: Campaign details, 2: Recipients, 3: AI & Test, 4: Confirm
  const [step, setStep] = useState(1);

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('default');
  const [useAiPersonalization, setUseAiPersonalization] = useState(true);
  const [tone, setTone] = useState('professional');
  const [salesObjective, setSalesObjective] = useState('');

  // Filters for recipient selection
  const [recipientScope, setRecipientScope] = useState('my-leads'); // 'my-leads' | 'assigned' | 'all'
  const [statusFilter, setStatusFilter] = useState('all');
  const [leadSelectionMap, setLeadSelectionMap] = useState({}); // leadId -> boolean

  // Test Email state
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState({ success: null, message: '' });

  // Creation & Launch State
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Active Telemetry Campaign
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);

  useEffect(() => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) {
      router.push('/login');
      return;
    }
    const parsedUser = JSON.parse(localUser);
    setUser(parsedUser);
    setTestEmail(parsedUser.email || '');

    fetchData();
  }, [router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Load Leads
      const leadRes = await apiRequest('/api/leads', 'GET');
      if (leadRes.success && leadRes.data) {
        setLeads(leadRes.data);
        const map = {};
        leadRes.data.forEach(l => { map[l._id] = true; });
        setLeadSelectionMap(map);
      }

      // Load Inboxes
      setInboxes([
        { _id: 'default', name: 'Default Outbound Identity', fromEmail: 'onboarding@resend.dev', fromName: 'Outbound Sales', dailyLimit: 500, sentToday: 12 }
      ]);

      // Load Existing Campaigns
      fetchCampaigns();
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

  // Filtered Leads calculation
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Scope filter
      if (recipientScope === 'my-leads' && user) {
        if (lead.assignedTo && lead.assignedTo !== user._id && lead.assignedTo?._id !== user._id) {
          return false;
        }
      }
      // Status filter
      if (statusFilter !== 'all' && lead.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [leads, recipientScope, statusFilter, user]);

  const recipientStats = useMemo(() => {
    const selected = filteredLeads.filter(l => leadSelectionMap[l._id]);
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
    filteredLeads.forEach(l => {
      newMap[l._id] = checked;
    });
    setLeadSelectionMap(newMap);
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) return;
    setSendingTest(true);
    setTestResult({ success: null, message: '' });
    try {
      const res = await apiRequest('/api/workstation/blasts/test-send', 'POST', {
        testEmail,
        subject: templateSubject || 'Sample Test Subject',
        templateBody: templateBody || 'Hello {{firstName}}, this is a test blast email.',
        useAiPersonalization,
        tone
      });
      if (res.success) {
        setTestResult({ success: true, message: `Test email sent to ${testEmail}!` });
      } else {
        setTestResult({ success: false, message: res.error?.message || 'Test email failed.' });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Error triggering test email.' });
    } finally {
      setSendingTest(false);
    }
  };

  const handleLaunchCampaign = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const selectedLeadIds = filteredLeads
        .filter(l => leadSelectionMap[l._id])
        .map(l => l._id);

      const res = await apiRequest('/api/workstation/blasts', 'POST', {
        name: campaignName,
        description,
        type: 'email',
        templateSubject,
        templateBody,
        sendingInboxId: selectedInboxId,
        tone,
        salesObjective,
        useAiPersonalization,
        leadIds: selectedLeadIds,
        status: 'queued'
      });

      if (res.success) {
        setShowConfirmModal(false);
        fetchCampaigns();
        setSelectedCampaignId(res.data._id);
        setActiveTab('telemetry');
        fetchTelemetry(res.data._id);
      } else {
        setSubmitError(res.error?.message || 'Failed to queue campaign.');
      }
    } catch (err) {
      setSubmitError(err.message || 'Server error queuing campaign.');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchTelemetry = async (campaignId) => {
    if (!campaignId) return;
    setLoadingTelemetry(true);
    try {
      const res = await apiRequest(`/api/workstation/blasts/${campaignId}`, 'GET');
      if (res.success && res.data) {
        setTelemetry(res.data);
      }
    } catch (e) {
      console.error('Failed to fetch telemetry:', e);
    } finally {
      setLoadingTelemetry(false);
    }
  };

  const handleToggleState = async (action) => {
    if (!selectedCampaignId) return;
    try {
      const res = await apiRequest(`/api/workstation/blasts/${selectedCampaignId}`, 'PUT', { action });
      if (res.success) {
        fetchTelemetry(selectedCampaignId);
        fetchCampaigns();
      }
    } catch (e) {
      alert('Failed to update campaign state: ' + e.message);
    }
  };

  const insertVariable = (varName) => {
    setTemplateBody(prev => prev + ` {{${varName}}}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0c12] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading Blast Workstation...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0c12] text-slate-100 font-sans flex flex-col">
      {/* Top Bar */}
      <header className="h-16 border-b border-white/10 bg-[#0d0f18]/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/workstation')}
            className="p-2 text-slate-400 hover:text-white bg-white/5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            ← Back to Workstation
          </button>
          <div className="h-4 w-px bg-white/10" />
          <h1 className="font-bold text-base text-white tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            Workstation Blast Email Center
          </h1>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('composer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'composer' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
            }`}
          >
            + Create Campaign
          </button>
          <button
            onClick={() => setActiveTab('my-campaigns')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'my-campaigns' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
            }`}
          >
            My Campaigns ({campaigns.length})
          </button>
          {selectedCampaignId && (
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'telemetry' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              Live Telemetry
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full">

        {/* TAB 1: COMPOSER WIZARD */}
        {activeTab === 'composer' && (
          <div className="space-y-6">
            {/* Step Navigation Bar */}
            <div className="flex items-center justify-between bg-[#121524] p-3 rounded-2xl border border-white/5">
              {[
                { s: 1, name: '1. Campaign & Content' },
                { s: 2, name: '2. Recipient Targeting' },
                { s: 3, name: '3. AI & Test Send' },
                { s: 4, name: '4. Review & Launch' }
              ].map(item => (
                <button
                  key={item.s}
                  onClick={() => setStep(item.s)}
                  className={`flex-1 py-2 px-3 text-center rounded-xl text-xs font-semibold transition-all ${
                    step === item.s
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {item.name}
                </button>
              ))}
            </div>

            {/* STEP 1: Campaign Details */}
            {step === 1 && (
              <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-5">
                <h2 className="text-lg font-bold text-white">Campaign & Messaging Details</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign Name *</label>
                    <input
                      type="text"
                      value={campaignName}
                      onChange={e => setCampaignName(e.target.value)}
                      placeholder="e.g., Q3 Outbound SaaS Outreach"
                      className="w-full bg-[#0a0c12] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Sending Identity / Inbox</label>
                    <select
                      value={selectedInboxId}
                      onChange={e => setSelectedInboxId(e.target.value)}
                      className="w-full bg-[#0a0c12] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    >
                      {inboxes.map(inbox => (
                        <option key={inbox._id} value={inbox._id}>
                          {inbox.name} ({inbox.fromEmail}) — Daily Limit: {inbox.dailyLimit}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Email Subject *</label>
                  <input
                    type="text"
                    value={templateSubject}
                    onChange={e => setTemplateSubject(e.target.value)}
                    placeholder="e.g., Quick question regarding {{company}}"
                    className="w-full bg-[#0a0c12] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-400">Email Body Template *</label>
                    <div className="flex gap-1 text-[11px]">
                      <span className="text-slate-500">Insert Variable:</span>
                      {['firstName', 'lastName', 'company', 'email', 'phone'].map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => insertVariable(v)}
                          className="bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20 hover:bg-cyan-500/20"
                        >
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    value={templateBody}
                    onChange={e => setTemplateBody(e.target.value)}
                    placeholder="Hi {{firstName}}, I noticed your work at {{company}}..."
                    className="w-full bg-[#0a0c12] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-cyan-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setStep(2)}
                    disabled={!campaignName || !templateSubject || !templateBody}
                    className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition-all"
                  >
                    Next: Recipient Targeting →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Recipient Targeting */}
            {step === 2 && (
              <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Target Recipients</h2>
                  <div className="flex items-center gap-3">
                    <select
                      value={recipientScope}
                      onChange={e => setRecipientScope(e.target.value)}
                      className="bg-[#0a0c12] border border-white/10 text-xs text-white rounded-lg px-2.5 py-1.5"
                    >
                      <option value="my-leads">My Leads Only</option>
                      <option value="all">All Assigned & Unassigned</option>
                    </select>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="bg-[#0a0c12] border border-white/10 text-xs text-white rounded-lg px-2.5 py-1.5"
                    >
                      <option value="all">All Statuses</option>
                      <option value="new">New Leads</option>
                      <option value="interested">Interested</option>
                      <option value="reply">Replied</option>
                      <option value="callback">Callback Scheduled</option>
                    </select>
                  </div>
                </div>

                {/* Stat Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[#0a0c12] p-3 rounded-xl border border-white/5">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Matching Leads</span>
                    <span className="text-lg font-bold text-white">{recipientStats.totalSelected}</span>
                  </div>
                  <div className="bg-[#0a0c12] p-3 rounded-xl border border-emerald-500/20">
                    <span className="text-[11px] text-emerald-400 uppercase tracking-wider block">Eligible Recipients</span>
                    <span className="text-lg font-bold text-emerald-400">{recipientStats.eligible}</span>
                  </div>
                  <div className="bg-[#0a0c12] p-3 rounded-xl border border-amber-500/20">
                    <span className="text-[11px] text-amber-400 uppercase tracking-wider block">Suppressed / Opt-Out</span>
                    <span className="text-lg font-bold text-amber-400">{recipientStats.suppressed}</span>
                  </div>
                  <div className="bg-[#0a0c12] p-3 rounded-xl border border-rose-500/20">
                    <span className="text-[11px] text-rose-400 uppercase tracking-wider block">Missing Email</span>
                    <span className="text-lg font-bold text-rose-400">{recipientStats.missingEmail}</span>
                  </div>
                </div>

                {/* Lead Table Selection */}
                <div className="border border-white/10 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-2.5 w-10 text-center">
                          <input
                            type="checkbox"
                            onChange={e => handleSelectAll(e.target.checked)}
                            checked={filteredLeads.length > 0 && filteredLeads.every(l => leadSelectionMap[l._id])}
                          />
                        </th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Company</th>
                        <th className="p-2.5">Email</th>
                        <th className="p-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {filteredLeads.map(lead => (
                        <tr key={lead._id} className="hover:bg-white/[0.02]">
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(leadSelectionMap[lead._id])}
                              onChange={e => setLeadSelectionMap({ ...leadSelectionMap, [lead._id]: e.target.checked })}
                            />
                          </td>
                          <td className="p-2.5 font-medium text-white">{lead.contact?.name || lead.name || 'N/A'}</td>
                          <td className="p-2.5">{lead.company?.name || lead.company || '—'}</td>
                          <td className="p-2.5">{lead.contact?.email || lead.email || 'No email'}</td>
                          <td className="p-2.5 capitalize">{lead.status || 'new'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-4 py-2 rounded-xl"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={recipientStats.eligible === 0}
                    className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20"
                  >
                    Next: AI & Test Send →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: AI & Test Send */}
            {step === 3 && (
              <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-5">
                <h2 className="text-lg font-bold text-white">AI Personalization & Test Email Dispatch</h2>

                <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/10 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAiPersonalization}
                      onChange={e => setUseAiPersonalization(e.target.checked)}
                      className="w-4 h-4 accent-cyan-500 rounded"
                    />
                    <span className="text-sm font-semibold text-white">Enable AI Message Personalization</span>
                  </label>
                  <p className="text-xs text-slate-400">
                    AI will automatically analyze recipient context and personalize intro lines & copy for max open/reply rates.
                  </p>

                  {useAiPersonalization && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">Tone</label>
                        <select
                          value={tone}
                          onChange={e => setTone(e.target.value)}
                          className="w-full bg-[#121524] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                        >
                          <option value="professional">Professional & Direct</option>
                          <option value="casual">Friendly & Conversational</option>
                          <option value="urgent">Urgent & Value-Focused</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">Sales Objective</label>
                        <input
                          type="text"
                          value={salesObjective}
                          onChange={e => setSalesObjective(e.target.value)}
                          placeholder="e.g., Book a demo call"
                          className="w-full bg-[#121524] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Test Send Section */}
                <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/10 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">Send Test Dispatch</h3>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={e => setTestEmail(e.target.value)}
                      placeholder="Enter test recipient email"
                      className="flex-1 bg-[#121524] border border-white/10 text-xs px-3 py-2 rounded-xl text-white"
                    />
                    <button
                      onClick={handleSendTestEmail}
                      disabled={sendingTest || !testEmail}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                    >
                      {sendingTest ? 'Sending...' : 'Dispatch Test Email'}
                    </button>
                  </div>
                  {testResult.message && (
                    <p className={`text-xs ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {testResult.message}
                    </p>
                  )}
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-4 py-2 rounded-xl"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setStep(4)}
                    className="bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20"
                  >
                    Review Campaign →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Review & Launch Confirmation */}
            {step === 4 && (
              <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-6">
                <h2 className="text-lg font-bold text-white">Campaign Summary & Final Launch Audit</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/5 space-y-2">
                    <span className="text-xs text-slate-500 font-semibold uppercase block">Campaign Info</span>
                    <p className="text-sm font-bold text-white">{campaignName}</p>
                    <p className="text-xs text-slate-400">Subject: {templateSubject}</p>
                    <p className="text-xs text-slate-400">AI Personalization: {useAiPersonalization ? 'Enabled' : 'Disabled'}</p>
                  </div>
                  <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/5 space-y-2">
                    <span className="text-xs text-slate-500 font-semibold uppercase block">Recipient Audit</span>
                    <p className="text-sm font-bold text-emerald-400">{recipientStats.eligible} Eligible Recipients</p>
                    <p className="text-xs text-slate-400">{recipientStats.suppressed} Suppressed / Opted-Out</p>
                    <p className="text-xs text-slate-400">{recipientStats.missingEmail} Invalid / Missing Address</p>
                  </div>
                </div>

                {submitError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs">
                    {submitError}
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(3)}
                    className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-4 py-2 rounded-xl"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => {
                      if (recipientStats.eligible > 100) {
                        setShowConfirmModal(true);
                      } else {
                        handleLaunchCampaign();
                      }
                    }}
                    disabled={submitting}
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/20 transition-all"
                  >
                    {submitting ? 'Queuing Blast...' : '🚀 Queue & Launch Blast Campaign'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MY CAMPAIGNS LIST */}
        {activeTab === 'my-campaigns' && (
          <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">My Workstation Blast Campaigns</h2>
            <div className="divide-y divide-white/5">
              {campaigns.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No blast campaigns created yet.</p>
              ) : (
                campaigns.map(c => (
                  <div key={c._id} className="py-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{c.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                          c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          c.status === 'processing' || c.status === 'queued' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                          c.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-slate-500/10 text-slate-400'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Subject: {c.templateSubject}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Created: {new Date(c.createdAt).toLocaleDateString()} | Total: {c.stats?.total || 0} | Sent: {c.stats?.sent || 0}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedCampaignId(c._id);
                        setActiveTab('telemetry');
                        fetchTelemetry(c._id);
                      }}
                      className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs px-3 py-1.5 rounded-lg border border-cyan-500/20 font-semibold"
                    >
                      View Live Telemetry →
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LIVE TELEMETRY DASHBOARD */}
        {activeTab === 'telemetry' && selectedCampaignId && (
          <div className="bg-[#121524] border border-white/10 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{telemetry?.campaign?.name || 'Campaign Telemetry'}</h2>
                <p className="text-xs text-slate-400">Campaign ID: {selectedCampaignId}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchTelemetry(selectedCampaignId)}
                  className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-3 py-1.5 rounded-lg"
                >
                  🔄 Refresh Status
                </button>
                {telemetry?.campaign?.status === 'processing' || telemetry?.campaign?.status === 'queued' ? (
                  <button
                    onClick={() => handleToggleState('pause')}
                    className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs px-3 py-1.5 rounded-lg font-semibold border border-amber-500/30"
                  >
                    Pause Campaign
                  </button>
                ) : telemetry?.campaign?.status === 'paused' ? (
                  <button
                    onClick={() => handleToggleState('resume')}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs px-3 py-1.5 rounded-lg font-semibold border border-emerald-500/30"
                  >
                    Resume Campaign
                  </button>
                ) : null}
                {telemetry?.campaign?.status !== 'cancelled' && telemetry?.campaign?.status !== 'completed' && (
                  <button
                    onClick={() => handleToggleState('cancel')}
                    className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-xs px-3 py-1.5 rounded-lg font-semibold border border-rose-500/30"
                  >
                    Cancel Campaign
                  </button>
                )}
              </div>
            </div>

            {/* Telemetry Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/5">
                <span className="text-xs text-slate-500 uppercase tracking-wider block">Total Recipients</span>
                <span className="text-xl font-bold text-white">{telemetry?.campaign?.stats?.total || 0}</span>
              </div>
              <div className="bg-[#0a0c12] p-4 rounded-xl border border-emerald-500/20">
                <span className="text-xs text-emerald-400 uppercase tracking-wider block">Sent Successfully</span>
                <span className="text-xl font-bold text-emerald-400">{telemetry?.campaign?.stats?.sent || 0}</span>
              </div>
              <div className="bg-[#0a0c12] p-4 rounded-xl border border-rose-500/20">
                <span className="text-xs text-rose-400 uppercase tracking-wider block">Failed</span>
                <span className="text-xl font-bold text-rose-400">{telemetry?.campaign?.stats?.failed || 0}</span>
              </div>
              <div className="bg-[#0a0c12] p-4 rounded-xl border border-amber-500/20">
                <span className="text-xs text-amber-400 uppercase tracking-wider block">Skipped / Suppressed</span>
                <span className="text-xl font-bold text-amber-400">{telemetry?.campaign?.stats?.skipped || 0}</span>
              </div>
            </div>

            {/* Execution Log stream */}
            <div className="bg-[#0a0c12] p-4 rounded-xl border border-white/10 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent Dispatch Stream</h3>
              <div className="max-h-60 overflow-y-auto space-y-2 font-mono text-xs text-slate-300">
                {telemetry?.recentLogs?.length === 0 ? (
                  <p className="text-slate-500">No dispatch logs recorded yet.</p>
                ) : (
                  telemetry?.recentLogs?.map(log => (
                    <div key={log._id} className="flex justify-between py-1 border-b border-white/5">
                      <span>{log.to}</span>
                      <span className={log.status === 'sent' ? 'text-emerald-400' : 'text-rose-400'}>
                        {log.status.toUpperCase()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Large Blasts */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121524] border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              ⚠️ Confirm Large Blast Campaign
            </h3>
            <p className="text-xs text-slate-300">
              You are about to launch a campaign to <strong className="text-emerald-400">{recipientStats.eligible} eligible leads</strong>.
            </p>
            <div className="bg-[#0a0c12] p-3 rounded-xl border border-white/5 text-xs space-y-1 text-slate-400">
              <p>• {recipientStats.suppressed} suppressed records skipped automatically.</p>
              <p>• Daily inbox quotas apply.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-4 py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleLaunchCampaign}
                disabled={submitting}
                className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs px-5 py-2 rounded-xl"
              >
                {submitting ? 'Launching...' : 'Yes, Launch Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
