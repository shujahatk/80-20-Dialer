"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

export default function ManagerBlastsComposer() {
  const router = useRouter();
  const [user, setUser] = useState(() => {
    // Only access localStorage on the client
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
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const leadsRef = useRef(false); // ref to avoid setState-in-effect

  // Leads list and selection state
  const [leads, setLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadSelectionMap, setLeadSelectionMap] = useState({}); // leadId -> boolean

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState('email'); // email | sms
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [useAiPersonalization, setUseAiPersonalization] = useState(true);

  // Wizard state: 'compose' | 'recipients' | 'confirm' | 'progress'
  const [step, setStep] = useState('compose'); 

  // Campaign progress polling
  const [activeCampaignId, setActiveCampaignId] = useState('');
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  const fetchLeads = async () => {
    setLoadingLeads(true);
    try {
      const res = await apiRequest('/api/leads', 'GET');
      if (res.success && res.data) {
        setLeads(res.data);
        // Pre-select all leads by default
        const initialMap = {};
        res.data.forEach(l => {
          initialMap[l._id] = true;
        });
        setLeadSelectionMap(initialMap);
      }
    } catch (e) {
      console.error('Failed to load leads', e);
    } finally {
      setLoadingLeads(false);
    }
  };

  const fetchCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const res = await apiRequest('/api/manager/blasts', 'GET');
      if (res.success && res.data) {
        setCampaigns(res.data);
      }
    } catch (e) {
      console.error('Failed to load campaigns', e);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) {
      router.push('/login');
      return;
    }
    // User set via initial state; only fetch leads and campaigns if not already fetched
    if (!leadsRef.current) {
      leadsRef.current = true;
      fetchLeads();
      fetchCampaigns();
    }
    setLoading(false);
  }, []);

  // Filter leads dynamically based on search query and status filter
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      const name = l.contact?.name || '';
      const email = l.contact?.email || '';
      const phone = l.contact?.phone || '';
      const status = l.status || '';

      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            phone.includes(searchQuery);

      const matchesStatus = statusFilter ? status === statusFilter : true;

      return matchesSearch && matchesStatus;
    });
  }, [leads, searchQuery, statusFilter]);

  // Selected leads list helper
  const selectedLeadsList = useMemo(() => {
    return leads.filter(l => leadSelectionMap[l._id]);
  }, [leads, leadSelectionMap]);

  // Suppressed/opted-out count among selected leads
  const suppressedCount = useMemo(() => {
    return selectedLeadsList.filter(l => {
      if (campaignType === 'email') return l.suppression?.email;
      if (campaignType === 'sms') return l.suppression?.sms;
      return false;
    }).length;
  }, [selectedLeadsList, campaignType]);

  // Handle select all currently filtered leads
  const handleSelectAllFiltered = () => {
    const updatedMap = { ...leadSelectionMap };
    filteredLeads.forEach(l => {
      updatedMap[l._id] = true;
    });
    setLeadSelectionMap(updatedMap);
  };

  // Handle deselect all currently filtered leads
  const handleDeselectAllFiltered = () => {
    const updatedMap = { ...leadSelectionMap };
    filteredLeads.forEach(l => {
      updatedMap[l._id] = false;
    });
    setLeadSelectionMap(updatedMap);
  };

  // Toggle selection for a single lead
  const handleToggleLead = (id) => {
    setLeadSelectionMap(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Live preview personalization helper
  const livePreview = useMemo(() => {
    // Pick the first selected lead as sample, or fallback to the first overall lead, or a mock lead
    const sampleLead = selectedLeadsList[0] || leads[0] || {
      contact: { name: 'John Doe', email: 'john@example.com', phone: '+123456789' },
      company: { name: 'Acme Corp' }
    };

    const firstName = sampleLead.contact?.name || 'John';
    const company = sampleLead.company?.name || 'Acme Corp';

    let previewSubject = subject;
    let previewBody = body;

    if (previewSubject) {
      previewSubject = previewSubject.replace(/{{firstName}}/g, firstName);
      previewSubject = previewSubject.replace(/{{company}}/g, company);
    }

    if (previewBody) {
      previewBody = previewBody.replace(/{{firstName}}/g, firstName);
      previewBody = previewBody.replace(/{{company}}/g, company);
    }

    return {
      subject: previewSubject || '(No Subject Line)',
      body: previewBody || '(Empty Message Body)',
      sampleName: firstName,
      sampleCompany: company
    };
  }, [selectedLeadsList, leads, subject, body]);

  // Queue and start the blast campaign
  const handleQueueCampaign = async () => {
    if (!campaignName.trim()) {
      alert('Campaign name is required.');
      return;
    }

    if (selectedLeadsList.length === 0) {
      alert('Please select at least one recipient.');
      return;
    }

    try {
      const res = await apiRequest('/api/manager/blasts', 'POST', {
        name: campaignName,
        type: campaignType,
        templateSubject: campaignType === 'email' ? subject : '',
        templateBody: body,
        useAiPersonalization: useAiPersonalization,
        leadIds: selectedLeadsList.map(l => l._id),
        status: 'queued' // queue immediately
      });

      if (res.success && res.data) {
        const campId = res.data._id;
        setActiveCampaignId(campId);
        setStep('progress');
        pollCampaignProgress(campId);
        fetchCampaigns();
      } else {
        alert(res.message || 'Failed to queue campaign.');
      }
    } catch (err) {
      alert(err.message || 'Failed to queue campaign.');
    }
  };

  // Poll progress from endpoint
  const pollCampaignProgress = (id) => {
    if (!id) return;
    if (pollingInterval) clearInterval(pollingInterval);

    const interval = setInterval(async () => {
      try {
        const res = await apiRequest(`/api/manager/blasts/${id}`, 'GET');
        if (res.success && res.data) {
          setActiveCampaign(res.data);
          setProgress(res.data.stats || { sent: 0, failed: 0, skipped: 0, total: 0 });

          if (res.data.status === 'completed' || res.data.status === 'cancelled') {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('Progress polling stopped:', err);
        clearInterval(interval);
      }
    }, 3000);

    setPollingInterval(interval);
  };

  const [progress, setProgress] = useState({ sent: 0, failed: 0, skipped: 0, total: 0 });

  // Cancel running/queued campaign
  const handleCancelCampaign = async () => {
    if (!confirm('Are you sure you want to cancel this campaign?')) return;
    try {
      const res = await apiRequest(`/api/manager/blasts/${activeCampaignId}/cancel`, 'POST');
      if (res.success) {
        // Poll once immediately to refresh status
        const refresh = await apiRequest(`/api/manager/blasts/${activeCampaignId}`, 'GET');
        if (refresh.success && refresh.data) {
          setActiveCampaign(refresh.data);
        }
        clearInterval(pollingInterval);
        alert('Campaign cancelled.');
      } else {
        alert(res.message || 'Failed to cancel campaign.');
      }
    } catch (err) {
      alert(err.message || 'Failed to cancel campaign.');
    }
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0c12] text-slate-400">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs">Loading campaign composer...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-[#0a0c12] font-sans min-h-screen text-slate-100" style={{fontFamily:"'Inter',system-ui,sans-serif"}}>
      {/* Header */}
      <header className="bg-[#0d0f18]/90 backdrop-blur-md border-b border-white/5 px-6 h-14 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="font-black text-white text-xs tracking-tight">80</span>
          </div>
          <span className="font-semibold text-sm text-white">Blast Campaign Composer</span>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl transition-all"
        >
          Back to Dashboard
        </button>
      </header>

      {/* Main Container */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-hidden">
        
        {/* LEFT COLUMN: Main Wizard (8 cols) */}
        <main className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto pr-2" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
          
          {/* Progress Steps Header */}
          <div className="flex items-center justify-between bg-white/[0.02] border border-white/5 rounded-2xl p-4 shrink-0">
            {['compose', 'recipients', 'confirm', 'progress'].map((s, idx) => {
              const active = step === s;
              const isPast = ['compose', 'recipients', 'confirm', 'progress'].indexOf(step) > idx;
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    active ? 'bg-cyan-500 text-slate-950 font-black shadow-lg shadow-cyan-500/20' :
                    isPast ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-500'
                  }`}>
                    {idx + 1}
                  </div>
                  <span className={`text-xs font-bold capitalize hidden md:inline ${active ? 'text-cyan-400' : isPast ? 'text-slate-300' : 'text-slate-600'}`}>
                    {s}
                  </span>
                  {idx < 3 && <div className="w-8 h-px bg-white/5 hidden md:block" />}
                </div>
              );
            })}
          </div>

          {/* Wizard Panels */}
          {step === 'compose' && (
            <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-bold text-white">Step 1: Compose Blast Message</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Campaign Name</label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. Q3 Inbound Sequence"
                    className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl p-3 text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Message Type</label>
                  <div className="flex gap-4">
                    {['email', 'sms'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setCampaignType(t)}
                        className={`flex-1 py-3 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all ${
                          campaignType === t
                            ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400 font-bold'
                            : 'bg-transparent border-white/5 text-slate-400 hover:bg-white/5'
                        }`}
                      >
                        {t === 'email' ? '📧 Email' : '💬 SMS'}
                      </button>
                    ))}
                  </div>
                </div>

                {campaignType === 'email' && (
                  <div>
                    <label className="block text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Email Subject</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g. Quick question for {{firstName}}"
                      className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl p-3 text-slate-200 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs text-slate-500 font-semibold uppercase tracking-wider">Template Body</label>
                    <span className="text-[10px] text-indigo-400 font-semibold bg-indigo-500/10 px-2 py-0.5 rounded-full">
                      Supports tags: {"{{firstName}}"}, {"{{company}}"}
                    </span>
                  </div>
                  <textarea
                    rows={12}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={campaignType === 'email' ? "Hi {{firstName}},\n\nI noticed you work at {{company}}..." : "Hi {{firstName}}, are you free for a call?"}
                    className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl p-3 text-slate-200 focus:outline-none min-h-[240px] resize-y"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
                  <div>
                    <span className="text-xs font-bold text-cyan-400 block">✨ AI Personalization per Lead (Claude API)</span>
                    <span className="text-[10px] text-slate-400">Generate a unique, personalized message body for each lead based on their company, position, and notes.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseAiPersonalization(!useAiPersonalization)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      useAiPersonalization
                        ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                        : 'bg-white/5 text-slate-400 border border-white/10'
                    }`}
                  >
                    {useAiPersonalization ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep('recipients')}
                  disabled={!campaignName.trim() || !body.trim() || (campaignType === 'email' && !subject.trim())}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 disabled:opacity-40 transition-all"
                >
                  Continue to Recipients
                </button>
              </div>
            </div>
          )}

          {step === 'recipients' && (
            <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Step 2: Select Recipients</h2>
                  <p className="text-xs text-slate-500 mt-1">Currently selected: {selectedLeadsList.length} of {leads.length} leads</p>
                </div>
                
                {/* Checkbox buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllFiltered}
                    className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 px-3 py-2 rounded-xl transition-all"
                  >
                    Select All Filtered
                  </button>
                  <button
                    onClick={handleDeselectAllFiltered}
                    className="text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-2 rounded-xl transition-all"
                  >
                    Deselect All Filtered
                  </button>
                </div>
              </div>

              {/* Filters panel */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                <input
                  type="text"
                  placeholder="Search name, email, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl px-3 py-2 text-slate-200 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs bg-[#0a0c12] border border-white/8 rounded-xl px-3 py-2 text-slate-400 focus:outline-none cursor-pointer"
                >
                  <option value="">All Statuses</option>
                  <option value="new">New</option>
                  <option value="callback">Callback</option>
                  <option value="interested">Interested</option>
                  <option value="meeting-booked">Meeting Booked</option>
                  <option value="not-interested">Not Interested</option>
                  <option value="dnc">DNC / Suppressed</option>
                </select>
              </div>

              {/* Leads list table */}
              <div className="border border-white/5 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                {loadingLeads ? (
                  <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : filteredLeads.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">No leads found matching current filters.</div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-white/[0.04] border-b border-white/5 text-slate-400 font-semibold">
                        <th className="p-3 w-10">Select</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Company</th>
                        <th className="p-3">Email</th>
                        <th className="p-3">Phone</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredLeads.map(l => {
                        const isSelected = !!leadSelectionMap[l._id];
                        const isSuppressed = campaignType === 'email' ? l.suppression?.email : l.suppression?.sms;
                        return (
                          <tr key={l._id} className={`hover:bg-white/[0.02] ${isSuppressed ? 'opacity-50' : ''}`}>
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleLead(l._id)}
                                className="cursor-pointer"
                              />
                            </td>
                            <td className="p-3 font-semibold text-slate-200">
                              <div className="flex items-center gap-1.5">
                                <span>{l.contact?.name}</span>
                                {isSuppressed && (
                                  <span className="text-[8px] bg-red-500/10 text-red-400 border border-red-500/20 px-1 rounded uppercase tracking-wider font-bold">
                                    Suppressed
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-slate-400">{l.company?.name}</td>
                            <td className="p-3 text-slate-400">{l.contact?.email || '—'}</td>
                            <td className="p-3 text-slate-400 tabular-nums">{l.contact?.phone || '—'}</td>
                            <td className="p-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                l.status === 'interested' ? 'bg-emerald-500/10 text-emerald-400' :
                                l.status === 'callback' ? 'bg-amber-500/10 text-amber-400' :
                                'bg-white/5 text-slate-400'
                              }`}>{l.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex justify-between mt-4">
                <button
                  onClick={() => setStep('compose')}
                  className="px-4 py-2 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold hover:bg-white/5 transition-all"
                >
                  Back to Compose
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={selectedLeadsList.length === 0}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 disabled:opacity-40 transition-all"
                >
                  Continue to Confirmation
                </button>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-6 space-y-6">
              <h2 className="text-lg font-bold text-white">Step 3: Review & Confirm Launch</h2>

              <div className="space-y-4 bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                <div className="grid grid-cols-3 gap-4 border-b border-white/5 pb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Campaign Name</span>
                    <p className="font-bold text-slate-200 mt-1">{campaignName}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Channel Type</span>
                    <p className="font-bold text-slate-200 mt-1 uppercase">{campaignType}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">AI Personalization</span>
                    <p className="font-bold text-cyan-400 mt-1">{useAiPersonalization ? '✨ Active (Claude API)' : 'Off (Static Template)'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 border-b border-white/5 pb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Total Selected</span>
                    <p className="text-lg font-black text-white mt-1 tabular-nums">{selectedLeadsList.length}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Will Skip (Opted-Out)</span>
                    <p className="text-lg font-black text-amber-400 mt-1 tabular-nums">{suppressedCount}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Will Send</span>
                    <p className="text-lg font-black text-cyan-400 mt-1 tabular-nums">
                      {Math.max(0, selectedLeadsList.length - suppressedCount)}
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Compliance Notification</span>
                  <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400 flex gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    <span>
                      Opt-out check is active. Skip counts are calculated from Lead.suppression metadata values. Suppressed leads will be skipped automatically by the worker.
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('recipients')}
                  className="px-4 py-2 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold hover:bg-white/5 transition-all"
                >
                  Back to Recipients
                </button>
                <button
                  onClick={handleQueueCampaign}
                  className="bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 transition-all"
                >
                  Queue Blast Campaign
                </button>
              </div>
            </div>
          )}

          {step === 'progress' && activeCampaign && (
            <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-6 space-y-6">
              <div>
                <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider bg-cyan-500/10 px-2.5 py-1 rounded-full">
                  Status: {activeCampaign.status}
                </span>
                <h2 className="text-xl font-bold text-white mt-3">{activeCampaign.name} Progress</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Sending Progress</span>
                    <span className="font-semibold tabular-nums">
                      {progress.total > 0 ? Math.round(((progress.sent + progress.skipped + progress.failed) / progress.total) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-white/5 border border-white/10 rounded-full overflow-hidden flex">
                    <div
                      className="bg-emerald-500 h-full transition-all duration-300"
                      style={{ width: progress.total > 0 ? `${(progress.sent / progress.total) * 100}%` : '0%' }}
                      title="Sent"
                    />
                    <div
                      className="bg-amber-500 h-full transition-all duration-300"
                      style={{ width: progress.total > 0 ? `${(progress.skipped / progress.total) * 100}%` : '0%' }}
                      title="Skipped"
                    />
                    <div
                      className="bg-red-500 h-full transition-all duration-300"
                      style={{ width: progress.total > 0 ? `${(progress.failed / progress.total) * 100}%` : '0%' }}
                      title="Failed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 text-center bg-[#0d0f18]/40 border border-white/5 rounded-2xl p-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Total</span>
                    <p className="text-lg font-black text-white mt-1 tabular-nums">{progress.total}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-emerald-400">Sent</span>
                    <p className="text-lg font-black text-emerald-400 mt-1 tabular-nums">{progress.sent}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-amber-400">Skipped</span>
                    <p className="text-lg font-black text-amber-400 mt-1 tabular-nums">{progress.skipped}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-red-400">Failed</span>
                    <p className="text-lg font-black text-red-400 mt-1 tabular-nums">{progress.failed}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                {activeCampaign.status !== 'completed' && activeCampaign.status !== 'cancelled' ? (
                  <button
                    onClick={handleCancelCampaign}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl text-xs font-bold shadow-lg shadow-red-500/10 transition-all"
                  >
                    Cancel Mid-Run
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setStep('compose');
                      setCampaignName('');
                      setSubject('');
                      setBody('');
                      setActiveCampaignId('');
                      setActiveCampaign(null);
                      setProgress({ sent: 0, failed: 0, skipped: 0, total: 0 });
                    }}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 py-3 rounded-xl text-xs font-bold transition-all"
                  >
                    Compose Another Campaign
                  </button>
                )}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT COLUMN: Sidebar (Live Preview & Past Blasts) (4 cols) */}
        <aside className="lg:col-span-4 flex flex-col gap-4 overflow-y-auto" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
          
          {/* Live Preview Panel */}
          <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-5 flex flex-col shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Live Personalization Preview</h3>
            
            <div className="border border-white/5 bg-[#0a0c12]/40 rounded-xl p-4 flex flex-col gap-3">
              <div className="text-[10px] text-slate-500 flex items-center justify-between pb-2 border-b border-white/5">
                <span>Sample Lead: {livePreview.sampleName}</span>
                <span>Company: {livePreview.sampleCompany}</span>
              </div>
              
              {campaignType === 'email' && (
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Subject</span>
                  <p className="text-xs font-bold text-slate-200 mt-1 break-words">{livePreview.subject}</p>
                </div>
              )}

              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Body Message</span>
                <p className="text-xs text-slate-300 mt-1 whitespace-pre-wrap break-words">{livePreview.body}</p>
              </div>
            </div>
          </div>

          {/* Past Campaigns */}
          <div className="bg-white/[0.03] border border-white/7 rounded-2xl p-5 flex-col flex-1" style={{minHeight:'250px'}}>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Past campaigns</h3>
            
            {loadingCampaigns ? (
              <div className="flex justify-center p-6"><div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : campaigns.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-6">No past campaigns found.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
                {campaigns.map(c => (
                  <button
                    key={c._id}
                    onClick={() => {
                      setActiveCampaignId(c._id);
                      setActiveCampaign(c);
                      setStep('progress');
                      pollCampaignProgress(c._id);
                    }}
                    className="w-full text-left p-3 rounded-xl border border-white/5 hover:border-white/10 bg-transparent hover:bg-white/[0.02] transition-all flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-200 truncate">{c.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        c.status === 'cancelled' ? 'bg-white/5 text-slate-500' :
                        'bg-cyan-500/10 text-cyan-400'
                      }`}>{c.status}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                      <span>{c.type === 'email' ? '📧 Email' : '💬 SMS'} · {c.leadIds?.length || 0} leads</span>
                      <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}