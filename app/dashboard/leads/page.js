"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { authenticatedFetch } from "@/lib/apiClient";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import AdminHeader from '../components/AdminHeader';
import { useRealtimePipeline } from '@/hooks/useRealtimePipeline';

const TARGET_FIELD_OPTIONS = [
  { value: 'ignore', label: '— Ignore This Column —' },
  { value: 'name', label: 'Full Name' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'email', label: 'Email Address' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'company', label: 'Company Name' },
  { value: 'position', label: 'Job Title / Position' },
  { value: 'website', label: 'Company Website' },
  { value: 'niche', label: 'Industry / Niche' },
  { value: 'city', label: 'City' },
  { value: 'region', label: 'State / Region' },
  { value: 'country', label: 'Country' },
  { value: 'timezone', label: 'Timezone' },
  { value: 'priority', label: 'Priority Score' },
  { value: 'list', label: 'Lead List Name' },
  { value: 'source', label: 'Lead Source' }
];

export default function LeadManagementHub() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('unassigned'); // 'unassigned' | 'upload' | 'all'

  // Data states
  const [salesReps, setSalesReps] = useState([]);
  const [unassignedLeads, setUnassignedLeads] = useState([]);
  const [allLeads, setAllLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selection state for bulk actions
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [dispatchTargetUserId, setDispatchTargetUserId] = useState('');
  const [dispatching, setDispatching] = useState(false);

  // Deletion Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState(null);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Banner / Notification states
  const [notification, setNotification] = useState({ message: '', type: '' });

  // Universal CSV Upload & Preview state
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadAssigneeId, setUploadAssigneeId] = useState('pool');
  const [duplicateStrategy, setDuplicateStrategy] = useState('skip');
  const [defaultListName, setDefaultListName] = useState('');
  const [manualMappings, setManualMappings] = useState({});
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');

  function showNotification(message, type = 'success') {
    setNotification({ message, type });
    if (type === 'success') {
      setTimeout(() => {
        setNotification(prev => prev.message === message ? { message: '', type: '' } : prev);
      }, 5000);
    }
  }

  useAuthenticatedEffect((sessionUser) => {
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!token || !storedUser) {
      router.push('/login');
      return;
    }
    const u = sessionUser;
    if (!['owner', 'manager', 'admin'].includes(u.role)) {
      router.push('/workstation');
      return;
    }
    setUser(u);
    fetchData();

    // Background sync (every 4s)
    const interval = setInterval(() => {
      fetchDataSilent();
    }, 4000);
    return () => clearInterval(interval);
  }, [router]);

  useRealtimePipeline(() => {
    fetchDataSilent();
  });

  async function apiRequest(url, method = 'GET', body = null, isFormData = false) {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await authenticatedFetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'API request failed.');
    return data;
  }

  async function fetchData() {
    setLoading(true);
    try {
      const [usersRes, unassignedRes, allRes] = await Promise.all([
        apiRequest('/api/manager/users').catch(() => ({ success: false })),
        apiRequest('/api/manager/leads?filter=unassigned').catch(() => ({ success: false })),
        apiRequest('/api/manager/leads?filter=all').catch(() => ({ success: false }))
      ]);

      if (usersRes.success && usersRes.data) {
        const activeReps = usersRes.data.filter(u => u.approved !== false && u.active !== false);
        setSalesReps(activeReps);
      }
      if (unassignedRes.success && unassignedRes.data) setUnassignedLeads(unassignedRes.data);
      if (allRes.success && allRes.data) setAllLeads(allRes.data);
    } catch (err) {
      console.error('Failed to load lead hub data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDataSilent() {
    try {
      const [usersRes, unassignedRes, allRes] = await Promise.all([
        apiRequest('/api/manager/users').catch(() => ({ success: false })),
        apiRequest('/api/manager/leads?filter=unassigned').catch(() => ({ success: false })),
        apiRequest('/api/manager/leads?filter=all').catch(() => ({ success: false }))
      ]);

      if (usersRes.success && usersRes.data) {
        const activeReps = usersRes.data.filter(u => u.approved !== false && u.active !== false);
        setSalesReps(activeReps);
      }
      if (unassignedRes.success && unassignedRes.data) setUnassignedLeads(unassignedRes.data);
      if (allRes.success && allRes.data) setAllLeads(allRes.data);
    } catch (err) {}
  }

  // Filtered Lists
  const filteredUnassigned = useMemo(() => {
    if (!searchQuery) return unassignedLeads;
    const q = searchQuery.toLowerCase();
    return unassignedLeads.filter(l =>
      (l.contact?.name || l.name || '').toLowerCase().includes(q) ||
      (l.company?.name || l.company || '').toLowerCase().includes(q) ||
      (l.contact?.email || l.email || '').toLowerCase().includes(q) ||
      (l.contact?.phone || l.phone || '').toLowerCase().includes(q)
    );
  }, [unassignedLeads, searchQuery]);

  const filteredAllLeads = useMemo(() => {
    if (!searchQuery) return allLeads;
    const q = searchQuery.toLowerCase();
    return allLeads.filter(l =>
      (l.contact?.name || l.name || '').toLowerCase().includes(q) ||
      (l.company?.name || l.company || '').toLowerCase().includes(q) ||
      (l.contact?.email || l.email || '').toLowerCase().includes(q) ||
      (l.contact?.phone || l.phone || '').toLowerCase().includes(q)
    );
  }, [allLeads, searchQuery]);

  const currentDisplayedLeads = activeTab === 'unassigned' ? filteredUnassigned : filteredAllLeads;

  function handleSelectAll(e) {
    if (e.target.checked) {
      const ids = currentDisplayedLeads.map(l => l._id || l.id);
      setSelectedLeadIds(ids);
    } else {
      setSelectedLeadIds([]);
    }
  }

  function handleSelectRow(id) {
    setSelectedLeadIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  }

  // Delete Action Modals
  function openSingleDeleteModal(lead) {
    setLeadToDelete(lead);
    setIsBulkDelete(false);
    setDeleteModalOpen(true);
  }

  function openBulkDeleteModal() {
    if (selectedLeadIds.length === 0) {
      showNotification('Please select at least one lead to delete.', 'error');
      return;
    }
    setLeadToDelete(null);
    setIsBulkDelete(true);
    setDeleteModalOpen(true);
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      if (isBulkDelete) {
        const res = await apiRequest('/api/manager/leads/delete', 'POST', {
          leadIds: selectedLeadIds
        });

        if (res.success) {
          const removedIds = new Set(selectedLeadIds);
          setUnassignedLeads(prev => prev.filter(l => !removedIds.has(l._id || l.id)));
          setAllLeads(prev => prev.filter(l => !removedIds.has(l._id || l.id)));
          showNotification(`🗑️ Successfully deleted ${res.data?.deletedCount || selectedLeadIds.length} lead(s) permanently.`, 'success');
          setSelectedLeadIds([]);
          setDeleteModalOpen(false);
        }
      } else if (leadToDelete) {
        const leadId = leadToDelete._id || leadToDelete.id;
        const res = await apiRequest(`/api/manager/leads/${leadId}`, 'DELETE');

        if (res.success) {
          setUnassignedLeads(prev => prev.filter(l => (l._id || l.id) !== leadId));
          setAllLeads(prev => prev.filter(l => (l._id || l.id) !== leadId));
          setSelectedLeadIds(prev => prev.filter(id => id !== leadId));
          showNotification(`🗑️ Lead '${leadToDelete.contact?.name || leadToDelete.name || 'Lead'}' was permanently deleted.`, 'success');
          setDeleteModalOpen(false);
          setLeadToDelete(null);
        }
      }
    } catch (err) {
      showNotification(err.message || 'Failed to delete lead(s).', 'error');
    } finally {
      setDeleting(false);
    }
  }

  // Bulk Dispatch
  async function handleBulkDispatch() {
    if (selectedLeadIds.length === 0) {
      showNotification('Please select at least one lead to dispatch.', 'error');
      return;
    }
    if (!dispatchTargetUserId) {
      showNotification('Please select a target Sales Representative or Pool option.', 'error');
      return;
    }

    setDispatching(true);
    const targetRep = salesReps.find(r => (r._id || r.id) === dispatchTargetUserId);
    const targetName = targetRep ? `${targetRep.name} (${targetRep.email})` : 'Selected Destination';

    try {
      const res = await apiRequest('/api/manager/leads/assign', 'POST', {
        leadIds: selectedLeadIds,
        targetUserId: dispatchTargetUserId
      });

      if (res.success) {
        const assignedIds = new Set(selectedLeadIds);
        setUnassignedLeads(prev => prev.filter(l => !assignedIds.has(l._id || l.id)));
        showNotification(`⚡ Successfully dispatched ${selectedLeadIds.length} lead(s) directly to ${targetName}!`, 'success');
        setSelectedLeadIds([]);
        const allRes = await apiRequest('/api/manager/leads?filter=all').catch(() => ({ success: false }));
        if (allRes.success && allRes.data) setAllLeads(allRes.data);
      }
    } catch (err) {
      showNotification(err.message || 'Failed to dispatch leads.', 'error');
    } finally {
      setDispatching(false);
    }
  }

  // CSV File Selection & Auto Preview
  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    setSelectedFile(file || null);
    setPreviewData(null);
    setUploadResult(null);
    setUploadError('');
    setManualMappings({});

    if (file) {
      await generateCsvPreview(file, {});
    }
  }

  // Generate CSV Preview & Column Mapping Analysis
  async function generateCsvPreview(file, overrides = {}) {
    setPreviewing(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('preview', 'true');
      formData.append('duplicateStrategy', duplicateStrategy);
      formData.append('defaultList', defaultListName);
      if (Object.keys(overrides).length > 0) {
        formData.append('manualOverrides', JSON.stringify(overrides));
      }

      const res = await apiRequest('/api/manager/leads/upload', 'POST', formData, true);
      if (res.success && res.data) {
        setPreviewData(res.data);
        // Initialize manual mapping state with detected mapping
        const initialMap = {};
        if (Array.isArray(res.data.headerSummary)) {
          for (const item of res.data.headerSummary) {
            initialMap[item.rawHeader] = item.mappedField || 'ignore';
          }
        }
        setManualMappings(initialMap);
      }
    } catch (err) {
      setUploadError(err.message || 'Could not analyze CSV file.');
    } finally {
      setPreviewing(false);
    }
  }

  // Handle Manual Mapping Change
  function handleMappingChange(rawHeader, newTargetField) {
    const updated = { ...manualMappings, [rawHeader]: newTargetField };
    setManualMappings(updated);
    if (selectedFile) {
      generateCsvPreview(selectedFile, updated);
    }
  }

  // Execute Final CSV Import
  async function handleFinalImport() {
    if (!selectedFile) {
      setUploadError('Please select a CSV file to import.');
      return;
    }

    setUploading(true);
    setUploadError('');
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('assignToUserId', uploadAssigneeId);
      formData.append('duplicateStrategy', duplicateStrategy);
      formData.append('defaultList', defaultListName);
      formData.append('manualOverrides', JSON.stringify(manualMappings));

      const res = await apiRequest('/api/manager/leads/upload', 'POST', formData, true);
      if (res.success) {
        setUploadResult(res.data);
        showNotification(`🎉 Successfully imported ${res.data?.importedCount || 0} leads!`, 'success');
        setPreviewData(null);
        setSelectedFile(null);
        // Navigate user to the tab where the imported leads reside
        if (uploadAssigneeId && uploadAssigneeId !== 'pool') {
          setActiveTab('all');
        } else {
          setActiveTab('unassigned');
        }
        fetchData();
      }
    } catch (err) {
      setUploadError(err.message || 'CSV upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-100 font-sans overflow-hidden">
      {/* 1. Collapsible Sidebar */}
      <CollapsibleSidebar
        activeTab="leads"
        user={user}
        onlineCount={salesReps.length}
        setActiveTab={(tab) => router.push(`/dashboard?tab=${tab}`)}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Admin Header */}
        <AdminHeader
          user={user}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          alerts={[]}
          onRefresh={fetchData}
        />

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Notification Banner */}
          {notification.message && (
            <div
              className={`p-4 rounded-xl border flex items-center justify-between text-xs font-medium transition-all shadow-md ${
                notification.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{notification.type === 'error' ? '⚠️' : '✅'}</span>
                <span>{notification.message}</span>
              </div>
              <button
                onClick={() => setNotification({ message: '', type: '' })}
                className="text-slate-400 hover:text-white font-bold ml-4 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Header Title Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#121624] border border-white/6 p-5 rounded-2xl shadow-lg shadow-black/20">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>🎯 Universal Lead Importer & Dispatch Hub</span>
                <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  Universal CSV Normalizer
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Upload CSVs from Apollo, SalesQL, LinkedIn, HubSpot, or any custom vendor. Auto-detects columns, skips duplicates, and normalizes contact records.
              </p>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 bg-[#07090e] p-1 rounded-xl border border-white/8 shrink-0">
              <button
                onClick={() => { setActiveTab('unassigned'); setSelectedLeadIds([]); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'unassigned'
                    ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📥 Unassigned Pool ({unassignedLeads.length})
              </button>
              <button
                onClick={() => { setActiveTab('upload'); setSelectedLeadIds([]); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'upload'
                    ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📤 Universal CSV Importer
              </button>
              <button
                onClick={() => { setActiveTab('all'); setSelectedLeadIds([]); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📋 All System Leads ({allLeads.length})
              </button>
            </div>
          </div>

          {/* TAB 1: UNASSIGNED LEAD POOL & BULK DISPATCH / DELETE */}
          {activeTab === 'unassigned' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-white/5">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Unassigned Lead Pool</span>
                    {filteredUnassigned.length > 0 && (
                      <span className="text-xs text-slate-400 font-normal">
                        ({filteredUnassigned.length} leads in view)
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Select leads to dispatch directly to a rep&apos;s queue or permanently delete unneeded records.
                  </p>
                </div>

                {/* Bulk Controls */}
                <div className="flex flex-wrap items-center gap-3 bg-[#07090e] p-2 rounded-xl border border-white/10">
                  <select
                    value={dispatchTargetUserId}
                    onChange={e => setDispatchTargetUserId(e.target.value)}
                    className="bg-[#121624] border border-white/10 text-xs text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500 font-medium cursor-pointer"
                  >
                    <option value="">-- Choose Sales Rep --</option>
                    <optgroup label="Active Sales Representatives">
                      {salesReps.map(rep => (
                        <option key={rep._id || rep.id} value={rep._id || rep.id}>
                          👤 {rep.name} ({rep.email}) - {rep.role}
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  <button
                    onClick={handleBulkDispatch}
                    disabled={dispatching || selectedLeadIds.length === 0}
                    className="bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs px-4 py-1.5 rounded-lg shadow-md shadow-cyan-500/20 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <span>⚡ Dispatch Selected</span>
                    {selectedLeadIds.length > 0 && (
                      <span className="bg-white/20 px-1.5 py-0.5 rounded-md text-[10px]">
                        {selectedLeadIds.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={openBulkDeleteModal}
                    disabled={selectedLeadIds.length === 0}
                    className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-rose-200 disabled:opacity-30 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    title="Permanently delete selected leads"
                  >
                    <span>🗑️ Delete Selected</span>
                    {selectedLeadIds.length > 0 && (
                      <span className="bg-rose-500/30 px-1.5 py-0.5 rounded-md text-[10px] text-rose-200">
                        {selectedLeadIds.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Pool Leads Table */}
              <div className="overflow-x-auto border border-white/10 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          onChange={handleSelectAll}
                          checked={filteredUnassigned.length > 0 && selectedLeadIds.length === filteredUnassigned.length}
                          className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                        />
                      </th>
                      <th className="p-3">Lead Name</th>
                      <th className="p-3">Company</th>
                      <th className="p-3">Email Address</th>
                      <th className="p-3">Phone Number</th>
                      <th className="p-3">Geography</th>
                      <th className="p-3 text-center">Priority</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {loading ? (
                      <tr><td colSpan={8} className="p-6 text-center text-slate-400">Loading unassigned pool leads...</td></tr>
                    ) : filteredUnassigned.length === 0 ? (
                      <tr><td colSpan={8} className="p-6 text-center text-slate-500">No unassigned leads in pool. Upload a CSV to allocate.</td></tr>
                    ) : (
                      filteredUnassigned.map(lead => {
                        const id = lead._id || lead.id;
                        const isSelected = selectedLeadIds.includes(id);
                        return (
                          <tr key={id} className={`hover:bg-white/[0.03] transition-colors ${isSelected ? 'bg-cyan-500/5' : ''}`}>
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleSelectRow(id)}
                                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                              />
                            </td>
                            <td className="p-3 font-semibold text-white">{lead.contact?.name || lead.name || 'N/A'}</td>
                            <td className="p-3">{lead.company?.name || (typeof lead.company === 'string' ? lead.company : '—')}</td>
                            <td className="p-3 font-mono text-slate-300">{lead.contact?.email || lead.email || '—'}</td>
                            <td className="p-3 font-mono text-slate-300">{lead.contact?.phone || lead.phone || '—'}</td>
                            <td className="p-3">{lead.city || lead.geography?.city || '—'}, {lead.country || lead.geography?.country || '—'}</td>
                            <td className="p-3 text-center font-bold text-amber-400">⭐ {lead.priority || 0}</td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => openSingleDeleteModal(lead)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1"
                                title="Permanently Delete Lead"
                              >
                                <span>🗑️</span>
                                <span>Delete</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: UNIVERSAL CSV IMPORTER WITH AUTO-MAPPING & PREVIEW */}
          {activeTab === 'upload' && (
            <div className="space-y-6 max-w-4xl">
              {/* Upload Card */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-5 shadow-lg shadow-black/20">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>📤 Smart CSV Lead Importer</span>
                    <span className="text-[11px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                      Zero-Formatting Required
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Accepts any CSV regardless of column order, header casing, delimiter (comma, semicolon, tab), or platform export structure (Apollo, SalesQL, HubSpot, Google Sheets, etc.).
                  </p>
                </div>

                {uploadError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center justify-between">
                    <span>⚠️ {uploadError}</span>
                    <button onClick={() => setUploadError('')} className="text-rose-400 hover:text-white font-bold ml-2">✕</button>
                  </div>
                )}

                {uploadResult && (
                  <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm text-emerald-400 flex items-center gap-2">
                        <span>🎉 Import Successfully Completed!</span>
                      </p>
                      <span className="bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                        {uploadResult.destination}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="bg-black/30 border border-white/5 p-2.5 rounded-xl">
                        <span className="text-slate-400 text-[10px] block uppercase">Total Rows</span>
                        <span className="text-base font-bold text-white">{uploadResult.total || 0}</span>
                      </div>
                      <div className="bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded-xl">
                        <span className="text-emerald-400 text-[10px] block uppercase">Imported</span>
                        <span className="text-base font-bold text-emerald-300">{uploadResult.importedCount || 0}</span>
                      </div>
                      <div className="bg-amber-950/40 border border-amber-500/30 p-2.5 rounded-xl">
                        <span className="text-amber-400 text-[10px] block uppercase">Duplicates Skipped</span>
                        <span className="text-base font-bold text-amber-300">{uploadResult.duplicates || 0}</span>
                      </div>
                      <div className="bg-rose-950/40 border border-rose-500/30 p-2.5 rounded-xl">
                        <span className="text-rose-400 text-[10px] block uppercase">Invalid Rows</span>
                        <span className="text-base font-bold text-rose-300">{uploadResult.invalid || 0}</span>
                      </div>
                    </div>

                    {uploadResult.duplicateList?.length > 0 && (
                      <div className="bg-black/20 p-3 rounded-xl border border-amber-500/20 text-[11px] text-amber-200/90 space-y-1">
                        <p className="font-semibold text-amber-300">Sample Duplicate Records Skipped:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                          {uploadResult.duplicateList.slice(0, 5).map((d, i) => (
                            <li key={i}>Row {d.row}: {d.name} ({d.email || d.phone}) — {d.reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Upload Settings Form */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      1. Select CSV File *
                    </label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileChange}
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Supports any delimiter, first/last name splitting or full name, international phone numbers, and arbitrary column ordering.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Destination Allocation */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        2. Destination Target *
                      </label>
                      <select
                        value={uploadAssigneeId}
                        onChange={e => setUploadAssigneeId(e.target.value)}
                        className="w-full bg-[#07090e] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer font-medium"
                      >
                        <option value="round_robin">🔄 Smart Round-Robin (Balanced Distribution)</option>
                        <option value="pool">📥 Unassigned Global Pool (Allocate Later)</option>
                        <optgroup label="Direct Salesperson Queue Dispatch">
                          {salesReps.map(rep => (
                            <option key={rep._id || rep.id} value={rep._id || rep.id}>
                              👤 {rep.name} ({rep.email}) - {rep.role}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    {/* Duplicate Strategy */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        3. Duplicate Handling *
                      </label>
                      <select
                        value={duplicateStrategy}
                        onChange={e => {
                          setDuplicateStrategy(e.target.value);
                          if (selectedFile) generateCsvPreview(selectedFile, manualMappings);
                        }}
                        className="w-full bg-[#07090e] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer font-medium"
                      >
                        <option value="skip">🛡️ Skip Duplicates (Safe Deduplication)</option>
                        <option value="import_anyway">⚠️ Import Duplicates Anyway</option>
                      </select>
                    </div>

                    {/* Default List Tag */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        4. Optional List Tag
                      </label>
                      <input
                        type="text"
                        value={defaultListName}
                        onChange={e => setDefaultListName(e.target.value)}
                        placeholder="e.g. Q4 Florida Leads"
                        className="w-full bg-[#07090e] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview & Mapping Step */}
              {previewing && (
                <div className="p-8 text-center bg-[#121624] border border-white/6 rounded-2xl">
                  <span className="animate-spin text-2xl inline-block mb-2">⚡</span>
                  <p className="text-sm font-semibold text-white">Analyzing CSV headers, delimiters, and deduplication...</p>
                </div>
              )}

              {previewData && !previewing && (
                <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-5 shadow-lg shadow-black/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <span>🔍 CSV Analysis & Column Mapping</span>
                        <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded-md">
                          Delimiter: &apos;{previewData.delimiter === '\t' ? 'TAB' : previewData.delimiter}&apos;
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        Review detected field matches. You can adjust column mappings below before confirming import.
                      </p>
                    </div>

                    {/* Pre-import Statistics Badges */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-semibold">
                        ✅ {previewData.summary?.validRows || 0} Valid Leads
                      </span>
                      {previewData.summary?.duplicates > 0 && (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-lg font-semibold">
                          ⚠️ {previewData.summary?.duplicates} Duplicates
                        </span>
                      )}
                      {previewData.summary?.invalid > 0 && (
                        <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2.5 py-1 rounded-lg font-semibold">
                          ❌ {previewData.summary?.invalid} Invalid
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Header Mapping Table */}
                  <div className="overflow-x-auto border border-white/10 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/5 text-slate-400">
                        <tr>
                          <th className="p-3">CSV Column Header</th>
                          <th className="p-3">Normalized Pattern</th>
                          <th className="p-3">Mapped System Field</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {previewData.headerSummary?.map((item, idx) => {
                          const currentMapped = manualMappings[item.rawHeader] || item.mappedField || 'ignore';
                          const isIgnored = currentMapped === 'ignore';
                          return (
                            <tr key={idx} className={`hover:bg-white/[0.03] ${isIgnored ? 'opacity-60' : ''}`}>
                              <td className="p-3 font-semibold text-white">{item.rawHeader}</td>
                              <td className="p-3 font-mono text-[11px] text-slate-400">{item.normalizedHeader || '—'}</td>
                              <td className="p-3">
                                <select
                                  value={currentMapped}
                                  onChange={e => handleMappingChange(item.rawHeader, e.target.value)}
                                  className="bg-[#07090e] border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium cursor-pointer"
                                >
                                  {TARGET_FIELD_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-3">
                                {isIgnored ? (
                                  <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full font-medium">
                                    Safely Ignored
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                                    Mapped to {currentMapped}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Sample Normalized Leads Preview */}
                  {previewData.sampleRows?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Sample Extracted Leads (First {previewData.sampleRows.length} Rows)
                      </h4>
                      <div className="overflow-x-auto border border-white/10 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-white/5 text-slate-400">
                            <tr>
                              <th className="p-2.5">Name</th>
                              <th className="p-2.5">Email</th>
                              <th className="p-2.5">Phone</th>
                              <th className="p-2.5">Company</th>
                              <th className="p-2.5">Position / Niche</th>
                              <th className="p-2.5">Geography</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-slate-300">
                            {previewData.sampleRows.map((lead, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="p-2.5 font-semibold text-white">{lead.name || 'N/A'}</td>
                                <td className="p-2.5 font-mono text-slate-300">{lead.email || '—'}</td>
                                <td className="p-2.5 font-mono text-slate-300">{lead.phone || '—'}</td>
                                <td className="p-2.5">{lead.company?.name || (typeof lead.company === 'string' ? lead.company : '—')}</td>
                                <td className="p-2.5 text-slate-400">{lead.position || lead.niche || '—'}</td>
                                <td className="p-2.5">{[lead.city, lead.country].filter(Boolean).join(', ') || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Confirm Import Action Button */}
                  <div className="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => { setSelectedFile(null); setPreviewData(null); }}
                      disabled={uploading}
                      className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={handleFinalImport}
                      disabled={uploading || (previewData.summary?.validRows || 0) === 0}
                      className="bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 cursor-pointer transition-all flex items-center gap-2"
                    >
                      {uploading ? (
                        <>
                          <span className="animate-spin text-sm">⏳</span>
                          <span>Importing Leads...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡ Confirm & Import {previewData.summary?.validRows || 0} Valid Leads</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ALL SYSTEM LEADS MASTER AUDIT */}
          {activeTab === 'all' && (
            <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/5">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>All System Leads Master Audit</span>
                    <span className="text-xs text-slate-400 font-normal">({filteredAllLeads.length} total)</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Comprehensive master overview of all leads, assignments, statuses, and administrative deletion controls.
                  </p>
                </div>

                {selectedLeadIds.length > 0 && (
                  <div className="flex items-center gap-3 bg-[#07090e] p-2 rounded-xl border border-white/10">
                    <span className="text-xs font-semibold text-slate-300">
                      {selectedLeadIds.length} lead(s) selected
                    </span>
                    <button
                      onClick={openBulkDeleteModal}
                      className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-rose-200 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>🗑️ Delete Selected</span>
                      <span className="bg-rose-500/30 px-1.5 py-0.5 rounded-md text-[10px] text-rose-200">
                        {selectedLeadIds.length}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto border border-white/10 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          onChange={handleSelectAll}
                          checked={filteredAllLeads.length > 0 && selectedLeadIds.length === filteredAllLeads.length}
                          className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                        />
                      </th>
                      <th className="p-3">Lead Name</th>
                      <th className="p-3">Company</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Status / Stage</th>
                      <th className="p-3">Current Assignment</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {loading ? (
                      <tr><td colSpan={7} className="p-6 text-center text-slate-400">Loading all system leads...</td></tr>
                    ) : filteredAllLeads.length === 0 ? (
                      <tr><td colSpan={7} className="p-6 text-center text-slate-500">No leads recorded in system.</td></tr>
                    ) : (
                      filteredAllLeads.map(lead => {
                        const id = lead._id || lead.id;
                        const isSelected = selectedLeadIds.includes(id);
                        return (
                          <tr key={id} className={`hover:bg-white/[0.03] transition-colors ${isSelected ? 'bg-cyan-500/5' : ''}`}>
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleSelectRow(id)}
                                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                              />
                            </td>
                            <td className="p-3 font-semibold text-white">{lead.contact?.name || lead.name || 'N/A'}</td>
                            <td className="p-3">{lead.company?.name || (typeof lead.company === 'string' ? lead.company : '—')}</td>
                            <td className="p-3 font-mono">{lead.contact?.email || lead.email || lead.phone || '—'}</td>
                            <td className="p-3 capitalize">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                lead.assigned_to ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {lead.status || lead.stage || (lead.assigned_to ? 'assigned' : 'new')}
                              </span>
                            </td>
                            <td className="p-3 font-medium text-cyan-400">
                              {lead.assignedUser ? `👤 ${lead.assignedUser.name} (${lead.assignedUser.email})` : '📥 Unassigned Pool'}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => openSingleDeleteModal(lead)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1"
                                title="Permanently Delete Lead"
                              >
                                <span>🗑️</span>
                                <span>Delete</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* CONFIRMATION MODAL: PERMANENT LEAD DELETION */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#121624] border border-rose-500/30 w-full max-w-md rounded-2xl shadow-2xl shadow-black/80 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 text-lg">
                ⚠️
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {isBulkDelete ? 'Permanently Delete Selected Leads' : 'Permanently Delete Lead'}
                </h3>
                <p className="text-xs text-rose-400/90 font-medium">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="bg-[#07090e] border border-white/10 rounded-xl p-4 space-y-2 text-xs text-slate-300">
              {isBulkDelete ? (
                <>
                  <p className="text-white font-semibold">
                    You have selected <span className="text-rose-400 font-bold text-sm">{selectedLeadIds.length}</span> lead(s) for permanent deletion.
                  </p>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    All selected records will be erased from the database, queues, campaigns, and pipeline views.
                  </p>
                </>
              ) : leadToDelete ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Lead Name:</span>
                    <span className="font-semibold text-white">{leadToDelete.contact?.name || leadToDelete.name || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Company:</span>
                    <span className="text-slate-200">{leadToDelete.company?.name || (typeof leadToDelete.company === 'string' ? leadToDelete.company : '—')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Contact:</span>
                    <span className="font-mono text-slate-300">{leadToDelete.contact?.email || leadToDelete.email || leadToDelete.contact?.phone || leadToDelete.phone || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current Status:</span>
                    <span className="capitalize text-cyan-400">{leadToDelete.status || leadToDelete.stage || 'new'}</span>
                  </div>
                </>
              ) : null}
            </div>

            <p className="text-[11px] text-slate-400 leading-normal">
              Permanently delete this lead? This action cannot be undone. All active locks and queue assignments for this record will be safely invalidated.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setDeleteModalOpen(false); setLeadToDelete(null); }}
                disabled={deleting}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {deleting ? (
                  <>
                    <span className="animate-spin text-sm">⏳</span>
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <span>🗑️</span>
                    <span>{isBulkDelete ? `Delete ${selectedLeadIds.length} Leads` : 'Confirm Delete'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
