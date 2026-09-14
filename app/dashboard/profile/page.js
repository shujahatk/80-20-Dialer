"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { authenticatedFetch } from "@/lib/apiClient";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CollapsibleSidebar from '../components/CollapsibleSidebar';
import { checkPasswordCriteria } from '@/lib/auth/passwordValidator';
import BlastEngineSettingsCard from '@/components/BlastEngineSettingsCard';

export default function UserProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); // { type: 'success'|'error', text: '' }

  useAuthenticatedEffect((sessionUser) => {
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!token || !storedUser) {
      router.push('/login');
      return;
    }
    try {
      setUser(sessionUser);
    } catch (e) {
      router.push('/login');
    }
  }, [router]);

  const criteria = checkPasswordCriteria(newPassword);

  async function handleChangePassword(e) {
    e.preventDefault();
    setStatusMsg(null);

    if (newPassword !== confirmPassword) {
      setStatusMsg({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    if (!criteria.allPassed) {
      setStatusMsg({ type: 'error', text: 'Please ensure all password security criteria are satisfied.' });
      return;
    }

    setSaving(true);
    const token = localStorage.getItem('token');

    try {
      const res = await authenticatedFetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to change password.');
      }

      setStatusMsg({ type: 'success', text: '✓ Password successfully updated!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#07090e] text-slate-100 font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 text-xs animate-pulse">Authenticating user profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#07090e] text-slate-100 antialiased overflow-hidden font-sans">
      <CollapsibleSidebar
        user={user}
        activeTab="settings"
        setActiveTab={(tab) => router.push(`/dashboard?tab=${tab}`)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* HEADER */}
        <header className="h-16 border-b border-white/6 bg-[#0c0f17]/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/20">
              👤
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">Account &amp; Security Settings</h1>
              <p className="text-[11px] text-slate-400">Manage your profile credentials and password policy</p>
            </div>
          </div>
        </header>

        {/* MAIN BODY */}
        <main className="p-6 max-w-4xl w-full mx-auto space-y-6 flex-1">

          {/* PROFILE SUMMARY CARD */}
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 shadow-lg shadow-black/20">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">
              User Profile Overview
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#080b12] p-3.5 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Full Name</span>
                <div className="text-sm font-bold text-white mt-1">{user?.name || 'Administrator'}</div>
              </div>
              <div className="bg-[#080b12] p-3.5 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Email Address</span>
                <div className="text-sm font-bold text-cyan-400 font-mono mt-1">{user?.email || '—'}</div>
              </div>
              <div className="bg-[#080b12] p-3.5 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">System Role</span>
                <div className="text-xs font-bold text-emerald-400 uppercase mt-1">
                  🛡️ {user?.role || 'User'}
                </div>
              </div>
            </div>
          </div>

          {/* PASSWORD CHANGE & COMPLEXITY FORM */}
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-6 shadow-lg shadow-black/20 space-y-5">
            <div className="border-b border-white/5 pb-3">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                🔐 Change Account Password
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Enforce enterprise security criteria to safeguard account access
              </p>
            </div>

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

            <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Current Password *</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter existing password"
                  className="w-full bg-[#080b12] border border-white/10 focus:border-cyan-500 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

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

              {/* REAL-TIME PASSWORD CRITERIA CHECKLIST */}
              {newPassword.length > 0 && (
                <div className="bg-[#080b12] border border-white/5 rounded-xl p-3 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Password Security Requirements:
                  </span>
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
                      <span className={req.met ? 'text-emerald-300 font-medium' : 'text-slate-500'}>
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
                disabled={saving || !criteria.allPassed || newPassword !== confirmPassword}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
              >
                {saving ? 'Updating Password...' : '💾 Update Account Password'}
              </button>
            </form>
          </div>

          {/* BLAST & DELIVERY ENGINE CARD */}
          <BlastEngineSettingsCard />

        </main>
      </div>
    </div>
  );
}
