"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';

export default function BlastProgressPage() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const [campaign, setCampaign] = useState(null);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, skipped: 0, total: 0 });
  const [pollInterval, setPollInterval] = useState(null);

  const fetchCampaign = async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/manager/blasts/${id}`);
      if (res.success && res.data) {
        setCampaign(res.data);
        setProgress(res.data.stats || { sent: 0, failed: 0, skipped: 0, total: 0 });
      }
    } catch (err) {
      console.error('Fetch campaign error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!localUser || !token) { router.push('/login'); return; }
    const parsedUser = JSON.parse(localUser);
    if (parsedUser.role === 'salesperson') { router.push('/workstation'); return; }
    // Fetch campaign and update loading state
    fetchCampaign().then(() => {
      setLoadingRef(false);
      setLoading(false);
    });
  }, []);

  const handleCancelCampaign = async () => {
    if (!confirm('Are you sure you want to cancel this campaign?')) return;
    try {
      const res = await apiRequest(`/api/manager/blasts/${id}/cancel`, 'POST');
      if (res.success) {
        alert('Campaign cancelled.');
        fetchCampaign();
      } else {
        alert(res.message || 'Failed to cancel campaign.');
      }
    } catch (err) {
      alert(err.message || 'Failed to cancel campaign.');
    }
  };

  useEffect(() => {
    if (!id) return;

    const interval = setInterval(async () => {
      try {
        const res = await apiRequest(`/api/manager/blasts/${id}`);
        if (res.success && res.data) {
          setProgress(res.data.stats || { sent: 0, failed: 0, skipped: 0, total: 0 });
          setCampaign(res.data);

          // Stop polling when completed or cancelled
          if (res.data.status === 'completed' || res.data.status === 'cancelled') {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('Progress poll error:', err);
      }
    }, 3000);

    setPollInterval(interval);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) return <div className="p-8 flex justify-center text-slate-400">Loading...</div>;

  if (!campaign) return <div className="p-8 text-center text-red-400">Campaign not found.</div>;

  return (
    <div className="min-h-screen bg-[#0a0c12] p-6 text-slate-100 font-sans" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div className="max-w-2xl mx-auto flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white truncate max-w-sm">
          {campaign.name}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/manager/blasts')}
            className="text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl transition-all"
          >
            Composer
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl transition-all"
          >
            Dashboard
          </button>
        </div>
      </div>

      {campaign.status === 'draft' ? (
        <p className="text-muted-foreground">Campaign is in draft status. Use the composer to start.</p>
      ) : (campaign.status === 'processing' || campaign.status === 'queued') ? (
        <div className="glassmorphism rounded-xl p-6 mb-8 max-w-2xl border border-white/5 bg-[#0f121d]/80">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white">Campaign Progress</h2>
            <span className="text-[10px] text-cyan-400 font-semibold bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full capitalize">
              {campaign.status}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400">Total Leads: {progress.total}</p>
              <div className="mt-2 h-2 bg-white/5 border border-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-cyan-500 rounded-full transition-all duration-500`}
                  style={{ width: progress.total > 0 ? ((progress.sent + progress.skipped + progress.failed) / progress.total) * 100 : 0 }} />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Sent: {progress.sent} | Failed: {progress.failed} | Skipped: {progress.skipped}
              </p>
            </div>

            <button
              onClick={handleCancelCampaign}
              className="w-full bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-red-500/10 transition-all mt-4"
            >
              Cancel Campaign
            </button>
          </div>
        </div>
      ) : (
        <div className="glassmorphism rounded-xl p-6 mb-8 max-w-2xl">
          <h2 className="text-xl font-bold mb-4">Campaign Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{campaign.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Type</p>
              <p className="font-medium">{campaign.type === 'email' ? 'Email' : 'SMS'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className={`font-medium ${campaign.status === 'completed' ? 'text-success' : campaign.status === 'cancelled' ? 'text-muted' : 'text-primary'}`}>
                {campaign.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p>{new Date(campaign.createdAt).toLocaleString()}</p>
            </div>
          </div>

          {campaign.type === 'email' && campaign.templateSubject && (
            <div>
              <p className="text-sm text-muted-foreground mt-4">Subject</p>
              <p className="mt-1 break-all">{campaign.templateSubject}</p>
            </div>
          )}

          {campaign.type === 'email' && campaign.templateBody && (
            <div>
              <p className="text-sm text-muted-foreground mt-4">Body</p>
              <p className="mt-1 break-all">{campaign.templateBody}</p>
            </div>
          )}

          {campaign.leadIds && campaign.leadIds.length > 0 ? (
            <div>
              <p className="text-sm text-muted-foreground mt-4">Leads ({campaign.leadIds.length})</p>
            </div>
          ) : null}

          {campaign.status === 'completed' || campaign.status === 'cancelled' ? (
            <div>
              <p className="text-sm text-muted-foreground mt-4">Stats</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="font-medium">{campaign.stats?.total || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sent</p>
                  <p className="font-medium">{campaign.stats?.sent || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Failed</p>
                  <p className="font-medium">{campaign.stats?.failed || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                  <p className="font-medium">{campaign.stats?.skipped || 0}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}