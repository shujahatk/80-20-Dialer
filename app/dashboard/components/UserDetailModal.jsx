'use client';

import React, { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/apiClient';

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

export default function UserDetailModal({ isOpen, userId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !userId) {
      setData(null);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    apiRequest(`/api/manager/users/${userId}/activity`)
      .then(res => {
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.message || 'Could not load salesperson activity.');
        }
      })
      .catch(err => {
        setError(err.message || 'Failed to load user breakdown.');
      })
      .finally(() => setLoading(false));
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const user = data?.user || {};
  const stats = data?.stats || {};
  const recentActivity = data?.recentActivity || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-2xl bg-[#0f1422] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center font-bold text-base text-white shadow-md shadow-cyan-500/20">
              {safeText(user.name, 'U')[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  {safeText(user.name, 'Salesperson Profile')}
                </h3>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {safeText(user.role, 'Salesperson')}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{safeText(user.email, '')}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {loading && (
            <div className="py-12 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-400">Loading performance breakdown...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Comprehensive KPI Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Calls Metric Card */}
                <div className="p-3.5 bg-[#07090e] border border-white/5 rounded-xl space-y-2">
                  <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Voice Calls</span>
                  <div className="text-xl font-black text-white">{stats.calls?.total || 0}</div>
                  <div className="text-[11px] text-slate-400 space-y-0.5 border-t border-white/5 pt-1.5">
                    <div className="flex justify-between">
                      <span>Answered:</span>
                      <strong className="text-emerald-400 font-mono">{stats.calls?.answered || 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>No Answer:</span>
                      <strong className="text-slate-400 font-mono">{stats.calls?.noAnswer || 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Talk Time:</span>
                      <strong className="text-cyan-400 font-mono">{stats.calls?.talkTimeFormatted || '0m'}</strong>
                    </div>
                  </div>
                </div>

                {/* Email Metric Card */}
                <div className="p-3.5 bg-[#07090e] border border-white/5 rounded-xl space-y-2">
                  <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Email Outbound</span>
                  <div className="text-xl font-black text-white">{stats.emails?.sent || 0}</div>
                  <div className="text-[11px] text-slate-400 space-y-0.5 border-t border-white/5 pt-1.5">
                    <div className="flex justify-between">
                      <span>Delivered:</span>
                      <strong className="text-emerald-400 font-mono">{stats.emails?.delivered || 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Replies:</span>
                      <strong className="text-cyan-400 font-mono">{stats.emails?.replies || 0}</strong>
                    </div>
                  </div>
                </div>

                {/* SMS Metric Card */}
                <div className="p-3.5 bg-[#07090e] border border-white/5 rounded-xl space-y-2">
                  <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">SMS / Messaging</span>
                  <div className="text-xl font-black text-white">{stats.sms?.sent || 0}</div>
                  <div className="text-[11px] text-slate-400 space-y-0.5 border-t border-white/5 pt-1.5">
                    <div className="flex justify-between">
                      <span>Delivered:</span>
                      <strong className="text-emerald-400 font-mono">{stats.sms?.delivered || 0}</strong>
                    </div>
                  </div>
                </div>

                {/* Meetings Booked Card */}
                <div className="p-3.5 bg-gradient-to-br from-[#07090e] to-emerald-950/20 border border-emerald-500/20 rounded-xl space-y-2">
                  <span className="text-[10px] font-bold uppercase text-emerald-400 tracking-wider">Meetings Booked</span>
                  <div className="text-xl font-black text-emerald-300 font-mono">{stats.meetingsBooked || 0}</div>
                  <div className="text-[10px] text-emerald-400/70 border-t border-white/5 pt-1.5 font-medium">
                    High-value conversions
                  </div>
                </div>
              </div>

              {/* Rep Recent Activity Table */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Recent Activity Timeline</h4>
                  <span className="text-[10px] text-slate-500">Last 50 Events</span>
                </div>

                <div className="overflow-x-auto border border-white/5 rounded-xl bg-[#07090e]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 text-slate-400">
                      <tr>
                        <th className="p-2.5">Time</th>
                        <th className="p-2.5">Lead / Contact</th>
                        <th className="p-2.5">Company</th>
                        <th className="p-2.5">Action</th>
                        <th className="p-2.5 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {recentActivity.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-slate-500">
                            No recent activity found for this user.
                          </td>
                        </tr>
                      ) : (
                        recentActivity.map((act) => (
                          <tr key={act.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="p-2.5 font-mono text-[11px] text-slate-400">{safeText(act.time)}</td>
                            <td className="p-2.5 font-semibold text-white truncate max-w-[140px]">{safeText(act.leadName, 'Contact')}</td>
                            <td className="p-2.5 text-slate-400 truncate max-w-[140px]">{safeText(act.company, '—')}</td>
                            <td className="p-2.5">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                act.channel === 'call' ? 'text-cyan-400' :
                                act.channel === 'email' ? 'text-purple-400' :
                                act.channel === 'sms' ? 'text-indigo-400' : 'text-slate-300'
                              }`}>
                                {safeText(act.action, 'Action')}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-mono text-[11px] font-semibold text-slate-200">{safeText(act.result, 'Done')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors cursor-pointer"
          >
            Close View
          </button>
        </div>
      </div>
    </div>
  );
}
