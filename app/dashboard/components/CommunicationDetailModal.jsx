'use client';

import React from 'react';

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

export default function CommunicationDetailModal({ isOpen, activity, onClose }) {
  if (!isOpen || !activity) return null;

  const details = activity.details || {};
  const isCall = activity.channel === 'call' || activity.action?.toLowerCase().includes('call');
  const isEmail = activity.channel === 'email' || activity.action?.toLowerCase().includes('email');
  const isSms = activity.channel === 'sms' || activity.channel === 'whatsapp' || activity.action?.toLowerCase().includes('sms');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-lg bg-[#0f1422] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <span className={`w-3 h-3 rounded-full ${
              isCall ? 'bg-cyan-400 shadow-cyan-400/50 shadow-sm' :
              isEmail ? 'bg-purple-400 shadow-purple-400/50 shadow-sm' :
              isSms ? 'bg-indigo-400 shadow-indigo-400/50 shadow-sm' :
              'bg-emerald-400 shadow-emerald-400/50 shadow-sm'
            }`} />
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Communication Inspector
              </h3>
              <p className="text-[11px] text-slate-400">
                {safeText(activity.action, 'Activity Record')} · {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : '—'}
              </p>
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

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Key Parties Card */}
          <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#07090e] rounded-xl border border-white/5 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Responsible Salesperson</span>
              <div className="font-semibold text-cyan-300 mt-0.5">{safeText(activity.userName, 'Sales Rep')}</div>
              <div className="text-[11px] text-slate-400 font-mono truncate">{safeText(activity.userEmail, '—')}</div>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Contact / Lead</span>
              <div className="font-semibold text-white mt-0.5">{safeText(activity.leadName, 'Contact')}</div>
              <div className="text-[11px] text-slate-400 truncate">{safeText(activity.leadCompany, 'Individual')}</div>
            </div>
          </div>

          {/* Status & Timing Metrics */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 bg-[#07090e] rounded-xl border border-white/5 text-center">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Channel</span>
              <span className="font-bold text-white text-xs uppercase mt-1 inline-block">{safeText(activity.channel, 'System')}</span>
            </div>
            <div className="p-3 bg-[#07090e] rounded-xl border border-white/5 text-center">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Status</span>
              <span className={`font-bold text-xs mt-1 inline-block ${
                activity.status === 'Connected' || activity.status === 'Delivered' ? 'text-emerald-400' :
                activity.status === 'Replied' ? 'text-cyan-400' :
                activity.status === 'No Answer' || activity.status === 'Failed' ? 'text-rose-400' :
                'text-amber-400'
              }`}>
                {safeText(activity.status, 'Completed')}
              </span>
            </div>
            <div className="p-3 bg-[#07090e] rounded-xl border border-white/5 text-center">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Duration / Result</span>
              <span className="font-mono font-bold text-white text-xs mt-1 inline-block">{safeText(activity.result, '—')}</span>
            </div>
          </div>

          {/* Call-Specific Details */}
          {isCall && (
            <div className="p-4 bg-[#07090e] rounded-xl border border-white/5 space-y-2.5 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Voice Telephony Metadata</div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Destination Phone:</span>
                <span className="font-mono text-slate-200">{activity.leadPhone || details.phone || '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Call Outcome:</span>
                <span className="text-slate-200 capitalize">{details.outcome || activity.status || 'Completed'}</span>
              </div>
              {details.callSid && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Provider Call SID:</span>
                  <span className="font-mono text-cyan-400 text-[11px] truncate max-w-[200px]">{details.callSid}</span>
                </div>
              )}
              {details.recordingUrl && (
                <div className="pt-2">
                  <span className="text-[11px] text-slate-400 block mb-1.5 font-semibold">Call Audio Recording:</span>
                  <audio controls className="w-full h-8 rounded-lg accent-cyan-500 bg-white/5">
                    <source src={details.recordingUrl} type="audio/mpeg" />
                    Your browser does not support audio recording playback.
                  </audio>
                </div>
              )}
            </div>
          )}

          {/* Email-Specific Details */}
          {isEmail && (
            <div className="p-4 bg-[#07090e] rounded-xl border border-white/5 space-y-2.5 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center justify-between">
                <span>Email Message Metadata</span>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                  details.emailType === 'blast' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                }`}>
                  {details.emailType === 'blast' ? 'Campaign Blast' : 'Individual 1:1'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Recipient:</span>
                <span className="font-mono text-slate-200">{activity.leadEmail || '—'}</span>
              </div>
              {details.messageSid && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Message ID:</span>
                  <span className="font-mono text-cyan-400 text-[11px] truncate max-w-[200px]">{details.messageSid}</span>
                </div>
              )}
            </div>
          )}

          {/* SMS-Specific Details */}
          {isSms && (
            <div className="p-4 bg-[#07090e] rounded-xl border border-white/5 space-y-2.5 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">SMS / Messaging Metadata</div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Phone Number:</span>
                <span className="font-mono text-slate-200">{activity.leadPhone || '—'}</span>
              </div>
              {details.messageSid && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Provider Message SID:</span>
                  <span className="font-mono text-cyan-400 text-[11px] truncate max-w-[200px]">{details.messageSid}</span>
                </div>
              )}
            </div>
          )}

          {/* Notes / Summary Section */}
          {activity.notes && (
            <div className="p-3.5 bg-[#07090e] rounded-xl border border-white/5 space-y-1 text-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Activity Notes / Summary</span>
              <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{activity.notes}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
