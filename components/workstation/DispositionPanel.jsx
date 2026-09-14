"use client";

import { useState } from 'react';
import { broadcastPipelineUpdate } from '@/hooks/useRealtimePipeline';

export default function DispositionPanel({ activeLead, onDispositionComplete }) {
  const [submitting, setSubmitting] = useState(false);
  const [activeOutcome, setActiveOutcome] = useState(null);
  const [dispositionNotes, setDispositionNotes] = useState('');
  const [disqualificationReason, setDisqualificationReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successBadge, setSuccessBadge] = useState('');

  if (!activeLead) {
    return (
      <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 text-center shadow-lg shadow-black/20">
        <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-white/5 flex items-center justify-center text-slate-500">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
        </div>
        <p className="text-xs font-semibold text-slate-400">1-Click Call Dispositions</p>
        <p className="text-[11px] text-slate-600 mt-1">Select a prospect from your queue to log 1-click outcomes</p>
      </div>
    );
  }

  const [showLossModal, setShowLossModal] = useState(false);

  const handleQuickDisposition = async (outcome) => {
    if (outcome === 'not_interested' && !disqualificationReason) {
      setShowLossModal(true);
      return;
    }

    setActiveOutcome(outcome);
    setSubmitting(true);
    setErrorMsg('');
    setSuccessBadge('');

    const token = localStorage.getItem('token');
    const leadId = activeLead._id || activeLead.id;

    try {
      const res = await fetch('/api/workstation/disposition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          leadId,
          outcome,
          notes: dispositionNotes || `1-Click Disposition: ${outcome}`,
          disqualificationReason: outcome === 'not_interested' ? (disqualificationReason || 'Other') : undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit disposition');
      }

      setSuccessBadge(`✓ ${outcome.replace('_', ' ').toUpperCase()} recorded!`);
      setDispositionNotes('');
      setDisqualificationReason('');
      setShowLossModal(false);

      broadcastPipelineUpdate(data.data || { _id: leadId, outcome });

      if (onDispositionComplete) {
        onDispositionComplete(data.data);
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessBadge(''), 3000);
    }
  };

  return (
    <div className="bg-[#121624] border border-white/6 rounded-2xl p-4 shadow-lg shadow-black/20 space-y-3.5">
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-cyan-500/15 flex items-center justify-center">
            <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">1-Click Call Dispositions</h3>
        </div>
        {successBadge ? (
          <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full animate-pulse">
            {successBadge}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 font-mono">
            Attempts: #{activeLead.call_attempts || 0}
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center gap-2">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 4 Distinct 1-Click Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => handleQuickDisposition('no_answer')}
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-sm shadow-amber-500/10"
        >
          <span>📞</span>
          <span>No Answer</span>
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => handleQuickDisposition('voicemail')}
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl text-xs font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-sm shadow-indigo-500/10"
        >
          <span>📼</span>
          <span>Voicemail</span>
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => handleQuickDisposition('meeting_booked')}
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-sm shadow-emerald-500/20"
        >
          <span>📅</span>
          <span>Meeting Booked</span>
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => handleQuickDisposition('not_interested')}
          className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-sm shadow-red-500/10"
        >
          <span>❌</span>
          <span>Not Interested</span>
        </button>
      </div>

      {/* Disqualification Reason Selector (Required on Not Interested) */}
      {showLossModal && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 space-y-2 animate-fade-in">
          <label className="block text-[10px] text-red-300 font-bold uppercase tracking-wider">
            Required: Disqualification Reason *
          </label>
          <select
            value={disqualificationReason}
            onChange={(e) => setDisqualificationReason(e.target.value)}
            className="w-full bg-[#080b12] border border-red-500/40 text-red-200 text-xs font-semibold rounded-lg p-2 focus:outline-none cursor-pointer"
          >
            <option value="">Select reason...</option>
            <option value="Too Expensive">💰 Too Expensive</option>
            <option value="Bad Contact Info">📵 Bad Contact Info</option>
            <option value="Competitor Selected">🏢 Competitor Selected</option>
            <option value="No Budget / Bad Timing">⏳ No Budget / Bad Timing</option>
            <option value="Other">❓ Other</option>
          </select>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowLossModal(false)}
              className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!disqualificationReason || submitting}
              onClick={() => handleQuickDisposition('not_interested')}
              className="px-3 py-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold text-xs rounded-lg shadow-sm shadow-red-500/20"
            >
              {submitting ? 'Saving...' : 'Confirm Not Interested'}
            </button>
          </div>
        </div>
      )}

      {/* Quick Notes Input */}
      <div>
        <input
          type="text"
          placeholder="Optional call note..."
          value={dispositionNotes}
          onChange={(e) => setDispositionNotes(e.target.value)}
          className="w-full text-xs bg-[#080b12] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2 text-white focus:outline-none placeholder:text-slate-600"
        />
      </div>
    </div>
  );
}
