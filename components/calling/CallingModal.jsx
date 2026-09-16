'use client';

import React, { useState, useEffect } from 'react';

export default function CallingModal({
  isOpen,
  lead,
  callState, // 'idle', 'initializing', 'dialing', 'ringing', 'connected', 'reconnecting', 'ending', 'ended', 'busy', 'no_answer', 'failed', 'canceled'
  duration = 0,
  isMuted = false,
  errorMessage = '',
  onToggleMute,
  onSendDigits,
  onEndCall,
  onClose,
  onOpenDisposition
}) {
  const [showDialpad, setShowDialpad] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dtmfLog, setDtmfLog] = useState('');

  // Reset local state when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setShowDialpad(false);
      setDtmfLog('');
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const phone = lead?.phone || lead?.contact?.phone || 'Unknown';
  const name = lead?.name || lead?.contact?.name || 'Unknown Contact';
  const company = lead?.company || lead?.organization || 'Individual Lead';
  const stage = lead?.stage || lead?.status || 'Lead';
  const timezone = lead?.geography?.timezone || lead?.timezone || null;

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyPhone = () => {
    if (phone) {
      navigator.clipboard?.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDtmfClick = (digit) => {
    setDtmfLog((prev) => prev + digit);
    if (onSendDigits) {
      onSendDigits(digit);
    }
  };

  const dtmfKeys = [
    { key: '1', sub: '' },
    { key: '2', sub: 'ABC' },
    { key: '3', sub: 'DEF' },
    { key: '4', sub: 'GHI' },
    { key: '5', sub: 'JKL' },
    { key: '6', sub: 'MNO' },
    { key: '7', sub: 'PQRS' },
    { key: '8', sub: 'TUV' },
    { key: '9', sub: 'WXYZ' },
    { key: '*', sub: '' },
    { key: '0', sub: '+' },
    { key: '#', sub: '' }
  ];

  // Helper status config
  const getStatusBadge = () => {
    switch (callState) {
      case 'initializing':
        return {
          label: 'Preparing call...',
          sub: 'Setting up audio session & security token',
          color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
          dot: 'bg-cyan-400 animate-pulse'
        };
      case 'dialing':
        return {
          label: 'Calling...',
          sub: 'Connecting to Twilio Voice Gateway',
          color: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
          dot: 'bg-cyan-400 animate-ping'
        };
      case 'ringing':
        return {
          label: 'Ringing...',
          sub: 'Waiting for remote party to answer',
          color: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
          dot: 'bg-amber-400 animate-ping'
        };
      case 'connected':
        return {
          label: isMuted ? 'Connected (Muted)' : 'Connected',
          sub: 'Live WebRTC audio stream active',
          color: isMuted ? 'text-amber-300 bg-amber-500/15 border-amber-500/30' : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
          dot: isMuted ? 'bg-amber-400' : 'bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse'
        };
      case 'reconnecting':
        return {
          label: 'Reconnecting...',
          sub: 'Restoring media connection',
          color: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
          dot: 'bg-amber-400 animate-pulse'
        };
      case 'ending':
        return {
          label: 'Ending Call...',
          sub: 'Terminating audio stream',
          color: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
          dot: 'bg-rose-400 animate-ping'
        };
      case 'ended':
        return {
          label: 'Call Ended',
          sub: `Final duration: ${formatTimer(duration)}`,
          color: 'text-slate-300 bg-slate-800/80 border-slate-700/50',
          dot: 'bg-slate-400'
        };
      case 'busy':
        return {
          label: 'Line Busy',
          sub: 'Recipient is currently on another call',
          color: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
          dot: 'bg-amber-400'
        };
      case 'no_answer':
        return {
          label: 'No Answer',
          sub: 'Call timed out with no response',
          color: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
          dot: 'bg-rose-400'
        };
      case 'canceled':
        return {
          label: 'Call Canceled',
          sub: 'Dialing was canceled before connect',
          color: 'text-slate-300 bg-slate-800/80 border-slate-700/50',
          dot: 'bg-slate-400'
        };
      case 'failed':
      default:
        return {
          label: 'Call Failed',
          sub: errorMessage || 'Could not establish connection',
          color: 'text-red-400 bg-red-500/15 border-red-500/30',
          dot: 'bg-red-500'
        };
    }
  };

  const status = getStatusBadge();
  const isTerminal = ['ended', 'busy', 'no_answer', 'failed', 'canceled'].includes(callState);
  const isActive = ['initializing', 'dialing', 'ringing', 'connected', 'reconnecting', 'ending'].includes(callState);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md bg-slate-900/95 border border-white/10 rounded-2xl shadow-2xl shadow-cyan-950/40 overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Top Glow Bar */}
        <div className={`h-1.5 w-full transition-colors duration-300 ${
          callState === 'connected' ? (isMuted ? 'bg-amber-500' : 'bg-emerald-500') :
          callState === 'ringing' ? 'bg-amber-400 animate-pulse' :
          callState === 'dialing' || callState === 'initializing' ? 'bg-cyan-400 animate-pulse' :
          isTerminal ? 'bg-slate-700' : 'bg-rose-500'
        }`} />

        {/* Header with Close */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-400">
              {stage}
            </span>
            {timezone && (
              <span className="text-[10px] text-slate-400 font-mono">
                {timezone}
              </span>
            )}
          </div>
          {isTerminal && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
              title="Close modal"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Lead Identity Body */}
        <div className="px-6 py-4 flex flex-col items-center text-center">
          {/* Avatar / Initials with Dynamic Ripple */}
          <div className="relative mb-3">
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center font-bold text-2xl border transition-all duration-300 ${
              callState === 'connected' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xl shadow-emerald-500/20' :
              callState === 'ringing' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xl shadow-amber-500/20' :
              callState === 'dialing' || callState === 'initializing' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xl shadow-cyan-500/20' :
              'bg-slate-800 text-slate-400 border-white/5'
            }`}>
              {name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'L'}
            </div>

            {/* Ripple rings while ringing or dialing */}
            {(callState === 'ringing' || callState === 'dialing') && (
              <span className="absolute -inset-2 rounded-2xl border border-cyan-400/30 animate-ping pointer-events-none" />
            )}
          </div>

          <h3 className="text-xl font-bold text-white tracking-tight">{name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{company}</p>

          {/* Formatted Phone with Quick Copy */}
          <button
            onClick={handleCopyPhone}
            className="mt-2 group flex items-center gap-1.5 px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-xs font-mono font-semibold text-cyan-400 transition-all"
            title="Click to copy phone number"
          >
            <span>{phone}</span>
            <svg className="w-3 h-3 text-slate-400 group-hover:text-cyan-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied && <span className="text-[10px] text-emerald-400 font-sans ml-1">Copied!</span>}
          </button>

          {/* Dynamic Status Pill */}
          <div className="mt-5 w-full max-w-xs">
            <div className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-xs transition-all ${status.color}`}>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${status.dot}`} />
              <span className="tracking-wide">{status.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              {status.sub}
            </p>
          </div>

          {/* Accurate Call Duration Display */}
          {callState === 'connected' && (
            <div className="mt-4 flex flex-col items-center">
              <div className="text-3xl font-mono font-black tracking-wider text-white">
                {formatTimer(duration)}
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80 mt-0.5">
                Call Duration
              </span>
            </div>
          )}

          {/* DTMF Dialpad Section */}
          {showDialpad && callState === 'connected' && (
            <div className="mt-4 w-full bg-slate-950/60 border border-white/10 rounded-xl p-3 animate-in fade-in zoom-in-95 duration-150">
              {dtmfLog && (
                <div className="text-center font-mono text-xs text-cyan-400 mb-2 tracking-widest">
                  Sent: {dtmfLog}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {dtmfKeys.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => handleDtmfClick(item.key)}
                    className="flex flex-col items-center justify-center py-2 bg-white/5 hover:bg-cyan-500/20 active:bg-cyan-500/30 border border-white/5 hover:border-cyan-500/30 rounded-lg transition-all"
                  >
                    <span className="text-base font-bold text-white">{item.key}</span>
                    {item.sub && (
                      <span className="text-[9px] font-semibold text-slate-400 tracking-wider">
                        {item.sub}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Controls Footer */}
        <div className="px-6 py-5 bg-slate-950/40 border-t border-white/5 flex flex-col gap-3">
          {/* Active Call Controls */}
          {isActive && (
            <div className="flex items-center justify-center gap-3">
              {/* Mute Button */}
              {callState === 'connected' && (
                <button
                  onClick={onToggleMute}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    isMuted
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                  }`}
                  title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {isMuted ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    )}
                  </svg>
                  <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
              )}

              {/* Keypad Toggle Button */}
              {callState === 'connected' && (
                <button
                  onClick={() => setShowDialpad(!showDialpad)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    showDialpad
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                  }`}
                  title="Toggle DTMF Dialpad"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  <span>Keypad</span>
                </button>
              )}

              {/* Large Red End Call Button */}
              <button
                onClick={onEndCall}
                disabled={callState === 'ending'}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-lg shadow-red-600/30 hover:shadow-red-600/50 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                title="End current call"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 0" />
                </svg>
                <span>{callState === 'ending' ? 'Ending...' : (callState === 'ringing' || callState === 'dialing' ? 'Cancel Call' : 'End Call')}</span>
              </button>
            </div>
          )}

          {/* Terminal / Post-Call Actions */}
          {isTerminal && (
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Close Window
              </button>

              <button
                onClick={() => {
                  onClose();
                  if (onOpenDisposition) onOpenDisposition();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Log Outcome</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
