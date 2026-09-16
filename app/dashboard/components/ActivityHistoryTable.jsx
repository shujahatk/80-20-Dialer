'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/apiClient';
import UserDetailModal from './UserDetailModal';
import CommunicationDetailModal from './CommunicationDetailModal';

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

export default function ActivityHistoryTable({ preselectedUser = null }) {
  // Filter States
  const [dateRange, setDateRange] = useState('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedUser, setSelectedUser] = useState(preselectedUser || 'all');
  const [selectedChannel, setSelectedChannel] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  // Data States
  const [activities, setActivities] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Modal States
  const [inspectUser, setInspectUser] = useState(null);
  const [inspectActivity, setInspectActivity] = useState(null);

  // Load Salespeople for the dropdown filter
  useEffect(() => {
    apiRequest('/api/manager/users')
      .then(res => {
        if (res.success && Array.isArray(res.data)) {
          const reps = res.data.filter(u => u.approved !== false);
          setSalespeople(reps);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch Activity Records
  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      let queryParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        dateRange
      });

      if (selectedUser && selectedUser !== 'all') queryParams.append('userId', selectedUser);
      if (selectedChannel && selectedChannel !== 'all') queryParams.append('channel', selectedChannel);
      if (selectedStatus && selectedStatus !== 'all') queryParams.append('status', selectedStatus);
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());
      if (dateRange === 'custom') {
        if (customStart) queryParams.append('startDate', customStart);
        if (customEnd) queryParams.append('endDate', customEnd);
      }

      const res = await apiRequest(`/api/manager/activity?${queryParams.toString()}`);
      if (res.success && Array.isArray(res.data)) {
        setActivities(res.data);
        setTotal(res.total || 0);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load activity history:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, dateRange, customStart, customEnd, selectedUser, selectedChannel, selectedStatus, searchQuery]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Handle CSV Export
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      let queryParams = new URLSearchParams({
        export: 'csv',
        dateRange
      });

      if (selectedUser && selectedUser !== 'all') queryParams.append('userId', selectedUser);
      if (selectedChannel && selectedChannel !== 'all') queryParams.append('channel', selectedChannel);
      if (selectedStatus && selectedStatus !== 'all') queryParams.append('status', selectedStatus);
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());
      if (dateRange === 'custom') {
        if (customStart) queryParams.append('startDate', customStart);
        if (customEnd) queryParams.append('endDate', customEnd);
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
      const response = await fetch(`/api/manager/activity?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Export failed.');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `activity_history_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(err.message || 'Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  const getChannelBadge = (ch) => {
    const c = String(ch || '').toLowerCase();
    if (c === 'call' || c === 'phone') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Call</span>;
    }
    if (c === 'email') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">Email</span>;
    }
    if (c === 'sms') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">SMS</span>;
    }
    if (c === 'whatsapp') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">WhatsApp</span>;
    }
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Stage</span>;
  };

  const getStatusBadge = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('connected') || s.includes('delivered') || s.includes('booked')) {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{status}</span>;
    }
    if (s.includes('replied') || s.includes('interested')) {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">{status}</span>;
    }
    if (s.includes('no answer') || s.includes('busy') || s.includes('failed')) {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">{status}</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">{status || 'Completed'}</span>;
  };

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 space-y-5 shadow-lg shadow-black/20">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <h3 className="text-base font-bold text-white tracking-tight">
              User Activity &amp; Communication History
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Complete immutable audit trail of all calls, emails, SMS, and pipeline stage changes.
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={exporting || activities.length === 0}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-cyan-500/20 transition-all cursor-pointer shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{exporting ? 'Exporting...' : 'Export Filtered CSV'}</span>
        </button>
      </div>

      {/* Multi-Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        {/* Date Range Selector */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Date Range</label>
          <select
            value={dateRange}
            onChange={(e) => { setDateRange(e.target.value); setPage(1); }}
            className="w-full bg-[#07090e] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* User / Salesperson Selector */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Salesperson</label>
          <select
            value={selectedUser}
            onChange={(e) => { setSelectedUser(e.target.value); setPage(1); }}
            className="w-full bg-[#07090e] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="all">All Salespeople</option>
            {salespeople.map(sp => (
              <option key={sp._id || sp.id} value={sp._id || sp.id}>
                {safeText(sp.name, 'Salesperson')} ({safeText(sp.email, 'no-email')})
              </option>
            ))}
          </select>
        </div>

        {/* Channel Selector */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => { setSelectedChannel(e.target.value); setPage(1); }}
            className="w-full bg-[#07090e] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="all">All Channels</option>
            <option value="call">Phone Calls</option>
            <option value="email">Emails</option>
            <option value="sms">SMS Texts</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="stage">Stage Changes</option>
          </select>
        </div>

        {/* Status Selector */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Status</label>
          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
            className="w-full bg-[#07090e] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="connected">Connected / Answered</option>
            <option value="no-answer">No Answer / Busy</option>
            <option value="delivered">Delivered</option>
            <option value="replied">Replied</option>
            <option value="failed">Failed</option>
            <option value="meeting_booked">Meeting Booked</option>
          </select>
        </div>

        {/* Search Input */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Search Records</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="Search lead, company, rep..."
            className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Custom Date Pickers (if selected) */}
      {dateRange === 'custom' && (
        <div className="flex items-center gap-3 p-3 bg-[#07090e] rounded-xl border border-white/5 text-xs">
          <span className="text-slate-400 font-medium">Custom Range:</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => { setCustomStart(e.target.value); setPage(1); }}
            className="bg-[#121624] border border-white/10 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"
          />
          <span className="text-slate-500">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }}
            className="bg-[#121624] border border-white/10 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"
          />
        </div>
      )}

      {/* Main Activity Table */}
      <div className="overflow-x-auto border border-white/5 rounded-xl bg-[#07090e]">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-slate-400 border-b border-white/5 font-semibold">
            <tr>
              <th className="p-3">Date / Time</th>
              <th className="p-3">User</th>
              <th className="p-3">Lead</th>
              <th className="p-3">Company</th>
              <th className="p-3">Channel</th>
              <th className="p-3">Action</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">
                  <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading activity history...
                </td>
              </tr>
            ) : activities.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No activity records match the selected filters.
                </td>
              </tr>
            ) : (
              activities.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setInspectActivity(item)}
                  className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                >
                  <td className="p-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.userId) setInspectUser(item.userId);
                      }}
                      className="flex items-center gap-1.5 font-bold text-cyan-300 hover:text-cyan-200 transition-colors group-hover:underline text-left cursor-pointer"
                      title="Click to view salesperson profile & breakdown"
                    >
                      <div className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center text-[10px] text-slate-300">
                        {safeText(item.userName, 'U')[0]?.toUpperCase() || 'U'}
                      </div>
                      <span>{safeText(item.userName, 'Salesperson')}</span>
                    </button>
                  </td>
                  <td className="p-3 font-medium text-white truncate max-w-[140px]">
                    {safeText(item.leadName, 'Contact')}
                  </td>
                  <td className="p-3 text-slate-400 truncate max-w-[140px]">
                    {safeText(item.leadCompany, '—')}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {getChannelBadge(safeText(item.channel, 'call'))}
                  </td>
                  <td className="p-3 font-medium text-slate-200 whitespace-nowrap">
                    {safeText(item.action, 'Action')}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {getStatusBadge(safeText(item.status, 'Completed'))}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold text-slate-200 whitespace-nowrap">
                    {safeText(item.result, '—')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
        <div>
          Showing <span className="text-white font-semibold">{activities.length}</span> of <span className="text-white font-semibold">{total}</span> records
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white font-medium transition-colors cursor-pointer"
          >
            ← Previous
          </button>
          <span className="font-mono text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white font-medium transition-colors cursor-pointer"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Salesperson Detail Drilldown Modal */}
      {inspectUser && (
        <UserDetailModal
          isOpen={Boolean(inspectUser)}
          userId={inspectUser}
          onClose={() => setInspectUser(null)}
        />
      )}

      {/* Communication Inspector Detail Modal */}
      {inspectActivity && (
        <CommunicationDetailModal
          isOpen={Boolean(inspectActivity)}
          activity={inspectActivity}
          onClose={() => setInspectActivity(null)}
        />
      )}
    </div>
  );
}
