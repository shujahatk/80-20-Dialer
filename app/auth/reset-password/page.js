"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { checkPasswordCriteria } from '@/lib/auth/passwordValidator';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  const criteria = checkPasswordCriteria(newPassword);

  const handleReset = async (e) => {
    e.preventDefault();
    setStatusMsg(null);

    if (!token) {
      setStatusMsg({ type: 'error', text: 'Missing reset token. Please check your email link.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatusMsg({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    if (!criteria.allPassed) {
      setStatusMsg({ type: 'error', text: 'Please ensure all password security criteria are satisfied.' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to reset password.');
      }

      setResetSuccess(true);
      setStatusMsg({ type: 'success', text: '✓ Password reset successfully! Redirecting to login...' });
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-[#121624] border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-cyan-500/20">
          🔐
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight">Set New Password</h1>
        <p className="text-xs text-slate-400">Establish a secure password for your account</p>
      </div>

      {!token ? (
        <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs text-center space-y-3">
          <p>Invalid or missing password reset link.</p>
          <Link href="/login" className="text-cyan-400 hover:underline font-bold block">
            Return to Sign In
          </Link>
        </div>
      ) : (
        <>
          {statusMsg && (
            <div className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
              statusMsg.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <span>{statusMsg.type === 'success' ? '✅' : '⚠️'}</span>
              <span>{statusMsg.text}</span>
            </div>
          )}

          {!resetSuccess && (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">New Password *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter strong new password"
                  className="w-full bg-[#080b12] border border-white/10 focus:border-cyan-500 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              {/* REAL-TIME CRITERIA CHECKLIST */}
              {newPassword.length > 0 && (
                <div className="bg-[#080b12] border border-white/5 rounded-xl p-3 space-y-1">
                  {[
                    { label: 'At least 8 characters', met: criteria.minLength },
                    { label: 'One uppercase letter (A-Z)', met: criteria.hasUpperCase },
                    { label: 'One lowercase letter (a-z)', met: criteria.hasLowerCase },
                    { label: 'One numeric digit (0-9)', met: criteria.hasNumber },
                    { label: 'One special character (!@#$%...)', met: criteria.hasSpecialChar }
                  ].map((req, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={req.met ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                        {req.met ? '✓' : '○'}
                      </span>
                      <span className={req.met ? 'text-emerald-300' : 'text-slate-500'}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Confirm New Password *</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full bg-[#080b12] border border-white/10 focus:border-cyan-500 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !criteria.allPassed || newPassword !== confirmPassword}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
              >
                {loading ? 'Resetting Password...' : 'Save New Password & Sign In'}
              </button>
            </form>
          )}
        </>
      )}

      <div className="text-center pt-2">
        <Link href="/login" className="text-xs text-slate-400 hover:text-cyan-400 transition-colors">
          ← Back to Sign In
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#07090e] flex items-center justify-center p-4 antialiased">
      <Suspense fallback={<div className="text-white text-xs">Loading reset page...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
