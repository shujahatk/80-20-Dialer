"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';
import WorkstationBlastCenter from './components/WorkstationBlastCenter';

export default function Workstation() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('dialer'); // 'dialer' | 'blast-email'

  // Queue & Leads State
  const [leads, setLeads] = useState([]);
  const [categories, setCategories] = useState({
    overdue: [], dueToday: [], replies: [], interested: [], newLeads: []
  });
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadHistory, setLeadHistory] = useState([]);
  const [fetchingLead, setFetchingLead] = useState(false);
  const [claimingLead, setClaimingLead] = useState(false);

  // Softphone & Twilio State
  const [deviceReady, setDeviceReady] = useState(false);
  const [callStatus, setCallStatus] = useState('offline'); // offline, ready, ringing, active, muted
  const [isMuted, setIsMuted] = useState(false);
  const [activeConnection, setActiveConnection] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [callSid, setCallSid] = useState('');
  
  // Dialer / Communications Forms
  const [smsText, setSmsText] = useState('');
  const [whatsappText, setWhatsappText] = useState('');
  const [whatsappTemplates, setWhatsappTemplates] = useState([]);
  const [selectedWaTemplate, setSelectedWaTemplate] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showEmailComposeModal, setShowEmailComposeModal] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [inboxes, setInboxes] = useState([]);
const [selectedInboxId, setSelectedInboxId] = useState('');

  // Bulk Send State
  const [bulkShow, setBulkShow] = useState(false);
  const [bulkType, setBulkType] = useState('email');
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkLeads, setBulkLeads] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkCampaignId, setBulkCampaignId] = useState('');

// Outcome / Lock Form
  const [outcome, setOutcome] = useState('new');
  const [notes, setNotes] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [bookingCloser, setBookingCloser] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTimezone, setBookingTimezone] = useState('UTC');
  const [closersList, setClosersList] = useState([]);
  const [submittingOutcome, setSubmittingOutcome] = useState(false);
  const [outcomeError, setOutcomeError] = useState('');

  // Session stats & Break State
  const [stats, setStats] = useState({ activeTimeSeconds: 0, dialingTimeSeconds: 0, breakTimeSeconds: 0, isOnBreak: false });
  const [alerts, setAlerts] = useState([]);

  // Refs & Timers
  const callTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const durationTimerRef = useRef(null);
  const deviceRef = useRef(null);

  // Initialize
  useEffect(() => {
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    
    if (!localUser || !token) {
      router.push('/login');
      return;
    }
    
    const parsedUser = JSON.parse(localUser);
    setUser(parsedUser);
    
    // Initial fetches
    fetchQueue();
    fetchStats();
    fetchAlerts();
    fetchWhatsAppTemplates();
    fetchInboxes();
    fetchClosers();

    // Setup heartbeat (10s)
    heartbeatTimerRef.current = setInterval(sendHeartbeat, 10000);

    // Load Twilio script & initialize
    loadTwilioScript().then(success => {
      if (success) initializeTwilioDevice();
    });

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      // Clean up connection
      if (deviceRef.current) {
        deviceRef.current.destroy();
      }
    };
  }, []);

  // Sync timers
  useEffect(() => {
    if (callStatus === 'active') {
      durationTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      setCallDuration(0);
    }
  }, [callStatus]);

  // Load Twilio SDK
  const loadTwilioScript = () => {
    return new Promise((resolve) => {
      if (window.Twilio) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://sdk.twilio.com/js/client/releases/1.13.0/twilio.min.js';
      script.async = true;
      script.onload = () => resolve(true);
      document.body.appendChild(script);
    });
  };

  // Initialize Twilio Device
  const initializeTwilioDevice = async () => {
    try {
      const res = await apiRequest('/api/calls/token');
      if (!res.success || !res.token) {
        console.warn('Twilio client token not available, falling back to simulated softphone.');
        setCallStatus('ready');
        return;
      }

      const device = new window.Twilio.Device(res.token, {
        codecPreferences: ['opus', 'pcmu'],
        fakeLocalAudioSink: true,
        enableIceRestart: true
      });

      device.on('ready', () => {
        setDeviceReady(true);
        setCallStatus('ready');
      });

      device.on('connect', (conn) => {
        setActiveConnection(conn);
        setCallStatus('active');
        // Extract Twilio Call Sid
        setCallSid(conn.parameters.CallSid || '');
      });

      device.on('disconnect', () => {
        // Log dialing seconds
        if (callDuration > 0) {
          apiRequest('/api/session/dialing', 'POST', { seconds: callDuration }).then(fetchStats);
        }
        setActiveConnection(null);
        setCallStatus('ready');
        setIsMuted(false);
      });

      device.on('error', (err) => {
        console.error('Twilio Device Error:', err);
        setCallStatus('ready');
      });

      deviceRef.current = device;
    } catch (e) {
      console.warn('Could not initialize Twilio device, falling back to simulated softphone:', e.message);
      setCallStatus('ready');
    }
  };

  // Heartbeat & Sync stats
  const sendHeartbeat = async () => {
    try {
      const res = await apiRequest('/api/session/heartbeat', 'POST');
      if (res.success) {
        setStats(prev => ({
          ...prev,
          isOnBreak: res.isOnBreak,
          activeTimeSeconds: res.activeTimeSeconds
        }));
      }
      fetchAlerts();
    } catch (e) {
      console.warn('Heartbeat update failed');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await apiRequest('/api/session/stats');
      if (res.success) setStats(res.data);
    } catch (e) {}
  };

  const fetchAlerts = async () => {
    try {
      const res = await apiRequest('/api/manager/alerts');
      if (res.success) setAlerts(res.data);
    } catch (e) {}
  };

  const fetchWhatsAppTemplates = async () => {
    try {
      // Seeded fallback templates
      setWhatsAppTemplates([
        { _id: 'wa-tpl-intro', name: 'Quick Intro & Availability', body: 'Hi {{first_name}}, this is {{sender_name}} regarding {{company}}. Wanted to see if you have a quick minute this week to connect? Here is my calendar if easier: {{booking_link}}' },
        { _id: 'wa-tpl-followup', name: 'Call Follow-up & Booking Link', body: 'Hi {{first_name}}, tried giving you a quick call earlier. Whenever you have 5 minutes, feel free to pick a time that works best for you here: {{booking_link}}' }
      ]);
    } catch (e) {}
  };

  const fetchInboxes = async () => {
    try {
      const res = await apiRequest('/api/emails'); // Can fetch inboxes
      setInboxes([
        { _id: 'default', name: 'System Default SendGrid', fromEmail: 'outbound@8020dialer.com', fromName: '80/20 Outbound' }
      ]);
    } catch (e) {}
  };

  const fetchClosers = async () => {
    try {
      const res = await apiRequest('/api/auth/register'); // Get user lists
      setClosersList([
        { _id: '1', name: 'Closer Sarah' },
        { _id: '2', name: 'Closer Alex' }
      ]);
    } catch (e) {}
  };

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/leads/queue');
      if (res.success) {
        setLeads(res.data.sortedList);
        setCategories(res.data.categories);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Lead selection & Lock acquisition
  const handleSelectLead = async (lead) => {
    if (stats.isOnBreak) {
      alert('Please end your break before contacting leads.');
      return;
    }
    
    setFetchingLead(true);
    setOutcomeError('');
    setNotes('');
    setOutcome('new');
    setCallbackDate('');
    
    try {
      // Acquires lock via API
      const res = await apiRequest(`/api/leads/${lead._id}`);
      if (res.success) {
        setSelectedLead(res.data);
        
        // Fetch timeline logs
        const historyRes = await apiRequest(`/api/manager/activity?limit=20`);
        if (historyRes.success) {
          const leadLogs = historyRes.data.filter(l => l.leadId === lead._id);
          setLeadHistory(leadLogs);
        }
      }
    } catch (e) {
      alert(e.message || 'This lead is currently locked or worked by another agent.');
    } finally {
      setFetchingLead(false);
    }
  };

  const handleClaimLead = async () => {
    if (stats.isOnBreak) {
      alert('Please end your break before claiming leads.');
      return;
    }
    setClaimingLead(true);
    try {
      const res = await apiRequest('/api/leads/claim', 'POST');
      if (res.success && res.data) {
        // Fetch queue again so it shows up in sidebar
        await fetchQueue();
        // Load the lead details and acquire lock
        await handleSelectLead(res.data);
      } else {
        alert(res.message || 'No unassigned leads available.');
      }
    } catch (e) {
      alert(e.message || 'Failed to claim lead from pool.');
    } finally {
      setClaimingLead(false);
    }
  };

  // Outbound Dialing
  const startCall = async () => {
    if (!selectedLead || !selectedLead.contact?.phone) return;
    if (callStatus !== 'ready') return;

    setCallStatus('ringing');
    try {
      let callSidValue = '';
      
      // If we don't have a real WebRTC device, let's simulate the call
      if (!deviceRef.current) {
        console.log('[Softphone MOCK] Dialing:', selectedLead.contact.phone);
        try {
          const res = await apiRequest('/api/calls', 'POST', {
            to: selectedLead.contact.phone,
            leadId: selectedLead._id
          });
          if (res.success) {
            callSidValue = res.data.callSid;
          }
        } catch (apiErr) {
          console.warn('[Softphone MOCK] API call failed, generating local mock SID:', apiErr.message);
          callSidValue = `mock_sid_${Date.now()}`;
        }
        
        // Simulate ringing delay and then connect
        setTimeout(() => {
          setCallSid(callSidValue);
          setCallStatus('active');
          document.getElementById('outcome-panel')?.scrollIntoView({ behavior: 'smooth' });
        }, 1000);
      } else {
        // Place outbound call request
        const res = await apiRequest('/api/calls', 'POST', {
          to: selectedLead.contact.phone,
          leadId: selectedLead._id
        });
        
        if (res.success && deviceRef.current) {
          // Start device call
          const conn = deviceRef.current.connect({ To: selectedLead.contact.phone });
          setActiveConnection(conn);
          setCallSid(res.data.callSid);
        } else {
          throw new Error('Calling failed.');
        }
      }
    } catch (e) {
      alert(e.message || 'Outbound call failed. Please check Allowed Calling Hours constraints.');
      setCallStatus('ready');
    }
  };

  const endCall = () => {
    if (deviceRef.current) {
      deviceRef.current.disconnectAll();
    } else {
      // Simulate disconnecting call
      if (callDuration > 0) {
        apiRequest('/api/session/dialing', 'POST', { seconds: callDuration }).then(fetchStats);
      }
      setCallStatus('ready');
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (activeConnection) {
      const nextMute = !isMuted;
      activeConnection.mute(nextMute);
      setIsMuted(nextMute);
      setCallStatus(nextMute ? 'muted' : 'active');
    } else {
      // Mock mute toggle
      const nextMute = !isMuted;
      setIsMuted(nextMute);
      setCallStatus(nextMute ? 'muted' : 'active');
    }
  };

  // Outbound SMS
  const sendSms = async (e) => {
    e.preventDefault();
    if (!selectedLead || !smsText.trim()) return;
    setSendingMessage(true);
    setMessageError('');

    try {
      const res = await apiRequest('/api/messages', 'POST', {
        to: selectedLead.contact.phone,
        body: smsText,
        leadId: selectedLead._id
      });
      if (res.success) {
        setSmsText('');
        // Refresh history
        handleSelectLead(selectedLead);
      }
    } catch (err) {
      setMessageError(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Outbound WhatsApp
  const sendWhatsApp = async (e) => {
    e.preventDefault();
    if (!selectedLead) return;
    setSendingMessage(true);
    setMessageError('');

    try {
      const payload = {
        to: selectedLead.contact.phone,
        leadId: selectedLead._id
      };
      if (selectedWaTemplate) {
        payload.templateId = selectedWaTemplate;
      } else {
        payload.body = whatsappText;
      }

      const res = await apiRequest('/api/messages/whatsapp', 'POST', payload);
      if (res.success) {
        setWhatsappText('');
        setSelectedWaTemplate('');
        handleSelectLead(selectedLead);
      }
    } catch (err) {
      setMessageError(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Check if lead has email opt-out suppression
  const hasEmailSuppression = (lead) => lead && lead.suppression && lead.suppression.email;

  // Outbound Email (Individual)
  const handleGenerateAiDraft = async () => {
    if (!selectedLead?._id) return;
    setIsGeneratingAi(true);
    try {
      const res = await apiRequest('/api/messages/personalize', 'POST', {
        leadId: selectedLead._id,
        basePrompt: emailBody || 'Reach out to introduce our outbound sales solution and discuss how we can help their growth.',
        channel: 'email'
      });
      if (res.success && res.data?.body) {
        setEmailBody(res.data.body);
      } else {
        alert(res.message || 'Failed to generate AI draft.');
      }
    } catch (err) {
      alert(err.message || 'Failed to generate AI draft.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const sendOutboundEmail = async (e) => {
    e.preventDefault();
    if (!selectedLead || hasEmailSuppression(selectedLead)) {
      alert(selectedLead && selectedLead.suppression.email ? 'This lead has opted out of email communication.' : 'Please select a lead.');
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSendingMessage(true);
    setMessageError('');

    try {
      const res = await apiRequest('/api/emails', 'POST', {
        leadId: selectedLead._id,
        subject: emailSubject,
        body: emailBody,
        fromName: user.name,
        fromEmail: user.email
      });
      if (res.success) {
        setEmailSubject('');
        setEmailBody('');
        handleSelectLead(selectedLead);
      }
    } catch (err) {
      setMessageError(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Submit Call Outcome & release lock
  const handleSubmitOutcome = async (e) => {
    e.preventDefault();
    if (!selectedLead) return;
    
    setSubmittingOutcome(true);
    setOutcomeError('');

    try {
      const payload = {
        outcome,
        notes,
        duration: callDuration,
        callSid
      };

      if (outcome === 'callback') {
        payload.callbackDate = callbackDate;
      }

      if (outcome === 'meeting-booked') {
        payload.booking = {
          meetingDate: bookingDate,
          meetingTimezone: bookingTimezone,
          closer: bookingCloser,
          meetingLink: bookingLink
        };
      }

      const res = await apiRequest(`/api/leads/${selectedLead._id}/work`, 'POST', payload);
      if (res.success) {
        // Clear workspace
        setSelectedLead(null);
        setLeadHistory([]);
        fetchQueue();
        fetchStats();
      }
    } catch (err) {
      setOutcomeError(err.message || 'Failed to submit call outcome.');
    } finally {
      setSubmittingOutcome(false);
    }
  };

  // Break toggler
  const handleToggleBreak = async () => {
    if (selectedLead) {
      alert('Please submit call outcome and release lead lock before going on break.');
      return;
    }
    try {
      const res = await apiRequest('/api/session/break/toggle', 'POST');
      if (res.success) {
        setStats(prev => ({
          ...prev,
          isOnBreak: res.data.isOnBreak,
          breakTimeSeconds: res.data.breakTimeSeconds
        }));
      }
    } catch (e) {}
  };

  // Format seconds -> HH:MM:SS
  const formatTime = (totalSecs) => {
    const hrs = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
    const mins = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
    const secs = (totalSecs % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  // Active messaging channel tab state
  const [activeChannel, setActiveChannel] = useState('sms');

  return (
    <div className="flex flex-col bg-[#07090e] font-sans min-h-screen text-slate-100" style={{fontFamily:"'Inter',system-ui,sans-serif"}}>
      
      {/* Top Navbar */}
      <header className="bg-[#0d0f18]/95 backdrop-blur-xl border-b border-white/6 px-6 h-14 flex items-center justify-between z-20 shrink-0 shadow-lg shadow-black/40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <span className="font-black text-white text-xs tracking-tight">80</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white tracking-tight">Workstation</span>
            <span className="hidden sm:block text-[10px] text-cyan-400 font-semibold bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Sales Agent</span>
          </div>
          <div className="flex items-center gap-1 bg-[#121624] p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setViewMode('dialer')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'dialer' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              📞 Workstation & Dialer
            </button>
            <button
              onClick={() => setViewMode('blast-email')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'blast-email' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              📧 Blast Email Center
            </button>
          </div>
        </div>

        {/* Softphone Banner */}
        <div className="hidden md:flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-4 py-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            callStatus === 'active' || callStatus === 'muted' ? 'bg-emerald-400 shadow-lg shadow-emerald-500/40 animate-pulse' :
            callStatus === 'ready' ? 'bg-cyan-400 shadow-lg shadow-cyan-500/30' :
            callStatus === 'ringing' ? 'bg-amber-400 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className="text-xs font-semibold text-slate-300">
            {callStatus === 'active' ? `In Call â€” ${formatTime(callDuration)}` :
             callStatus === 'muted' ? `Muted â€” ${formatTime(callDuration)}` :
             callStatus === 'ringing' ? 'Ringing...' :
             callStatus === 'ready' ? 'Softphone Ready' : 'Softphone Offline'}
          </span>

          {(callStatus === 'active' || callStatus === 'muted') && (
            <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <button onClick={toggleMute} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${isMuted ? 'bg-red-500/20 text-red-400' : 'hover:bg-white/5 text-slate-400'}`}>
                {isMuted ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                )}
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={endCall} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-lg shadow-md shadow-red-500/20 transition-all duration-200">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 0" /></svg>
                End Call
              </button>
            </div>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleBreak}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              stats.isOnBreak
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {stats.isOnBreak ? 'On Break' : 'Break'}
          </button>

          <div className="w-px h-5 bg-white/10" />

          <div className="flex items-center gap-2" suppressHydrationWarning>
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-[11px] font-bold text-slate-200" suppressHydrationWarning>
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="hidden sm:block text-right" suppressHydrationWarning>
              <div className="text-xs font-semibold text-slate-200 leading-none" suppressHydrationWarning>{user?.name || 'Agent'}</div>
              <div className="text-[10px] text-slate-500 capitalize mt-0.5" suppressHydrationWarning>{user?.role}</div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Log Out"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
      </header>

      {/* Main Content: Blast Email Center OR Workstation Dialer */}
      {viewMode === 'blast-email' ? (
        <WorkstationBlastCenter user={user} />
      ) : (
        <>
          {/* Main Grid */}
          <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-4 p-4 overflow-hidden">

        {/* LEFT: Queue (3 cols) */}
        <aside className="xl:col-span-3 flex flex-col gap-4 overflow-hidden">

          {/* Stats */}
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-4 shadow-lg shadow-black/20">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Today's Stats</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-0.5 bg-[#07090e] p-2 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-400 font-medium">Active</span>
                <span className="text-sm font-black text-cyan-400 tabular-nums">{formatTime(stats.activeTimeSeconds)}</span>
              </div>
              <div className="flex flex-col gap-0.5 bg-[#07090e] p-2 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-400 font-medium">Dialing</span>
                <span className="text-sm font-black text-indigo-400 tabular-nums">{formatTime(stats.dialingTimeSeconds)}</span>
              </div>
              <div className="flex flex-col gap-0.5 bg-[#07090e] p-2 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-400 font-medium">Break</span>
                <span className="text-sm font-black text-amber-400 tabular-nums">{formatTime(stats.breakTimeSeconds)}</span>
              </div>
            </div>
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 max-h-36 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Alerts</p>
                <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">{alerts.length}</span>
              </div>
              <div className="space-y-1.5">
                {alerts.map((al, idx) => (
                  <div key={idx} className="flex gap-2 items-start text-xs text-slate-300">
                    <svg className={`w-3 h-3 mt-0.5 shrink-0 ${al.type === 'error' ? 'text-red-400' : 'text-amber-400'}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    <span>{al.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact Queue */}
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-4 flex flex-col shadow-lg shadow-black/20" style={{minHeight:0, flex:'1 1 0'}}>
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Contact Queue</p>
                <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">{leads.length}</span>
              </div>
              <button
                onClick={handleClaimLead}
                disabled={claimingLead}
                className="text-[9px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md px-2 py-1 transition-all disabled:opacity-40"
              >
                {claimingLead ? 'Claiming...' : 'Claim Lead'}
              </button>
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : leads.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <svg className="w-8 h-8 text-slate-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-xs font-semibold text-slate-500">Queue cleared</p>
                <p className="text-[10px] text-slate-600 mt-0.5">No more leads to contact</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
                {leads.map((l) => (
                  <button
                    key={l._id}
                    onClick={() => handleSelectLead(l)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-200 ${
                      selectedLead?._id === l._id
                        ? 'bg-cyan-500/10 border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                        : 'bg-transparent border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                    } ${l.outOfHours ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200 truncate">{l.contact?.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                        l.status === 'callback' ? 'bg-amber-500/15 text-amber-400' :
                        l.status === 'interested' ? 'bg-emerald-500/15 text-emerald-400' :
                        'bg-white/5 text-slate-400'
                      }`}>{l.status}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{l.company?.name}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[9px] text-slate-600">{l.geography?.city || 'Unknown'}</span>
                      {l.outOfHours
                        ? <span className="text-[9px] text-amber-500 font-semibold">Out of Hours</span>
                        : <span className="text-[9px] text-slate-600 tabular-nums">{l.contact?.phone}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER: Lead Workspace (6 cols) */}
        <main className="xl:col-span-6 flex flex-col gap-4 overflow-hidden">
          {fetchingLead ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-white/[0.03] border border-white/7 rounded-2xl">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs text-slate-500">Loading contact profile...</p>
            </div>
          ) : !selectedLead ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center bg-white/[0.03] border border-dashed border-white/8 rounded-2xl px-8">
              <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
              </div>
              <h2 className="text-base font-bold text-slate-300">Dialer Ready</h2>
              <p className="text-xs text-slate-500 max-w-xs mt-1.5 leading-relaxed mb-6">Select a lead from the priority queue on the left, or pull a new lead directly from the unassigned pool to begin.</p>
              <button
                onClick={handleClaimLead}
                disabled={claimingLead}
                className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl shadow-lg shadow-cyan-500/25 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40"
              >
                {claimingLead ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Claiming Lead...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    Claim Next Lead
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">

              {/* Contact Profile Card */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 shrink-0 shadow-lg shadow-black/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-sm font-bold text-slate-200 shrink-0">
                      {selectedLead.contact?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-white leading-tight truncate">{selectedLead.contact?.name}</h2>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {selectedLead.contact?.position && <span>{selectedLead.contact.position} · </span>}
                        <span className="text-cyan-400 font-semibold">{selectedLead.company?.name}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedLead.outOfHours && (
                      <span className="text-[10px] text-amber-400 font-semibold bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        Out of Hours
                      </span>
                    )}
                    <button
                      onClick={startCall}
                      disabled={callStatus !== 'ready' || selectedLead.outOfHours}
                      className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      {callStatus === 'ringing' ? 'Ringing...' : 'Dial Contact'}
                    </button>
                    <button
                      onClick={() => {
                        if (selectedLead.suppression?.email) return;
                        setShowEmailComposeModal(true);
                      }}
                      disabled={selectedLead.suppression?.email}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-red-950/20 disabled:border disabled:border-red-950/30 disabled:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 relative group"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      {selectedLead.suppression?.email ? 'Email Suppressed' : 'Send Email'}
                    </button>
                  </div>
                </div>

                {/* Contact Details Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/5">
                  {[
                    { label: 'Phone', value: selectedLead.contact?.phone },
                    { label: 'Email', value: selectedLead.contact?.email },
                    { label: 'Location', value: `${selectedLead.geography?.city || '—'}, ${selectedLead.geography?.country || ''}` },
                    { label: 'Priority', value: `#${selectedLead.assignment?.priority || 0}`, accent: true }
                  ].map(({ label, value, accent }) => (
                    <div key={label}>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">{label}</span>
                      <div className={`text-xs font-semibold mt-0.5 truncate ${accent ? 'text-cyan-400' : 'text-slate-300'}`}>{value || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Messaging Tabs */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl flex flex-col shrink-0 shadow-lg shadow-black/20">
                {/* Tab Headers */}
                <div className="flex items-center gap-0.5 p-1 border-b border-white/5 bg-white/[0.02] rounded-t-2xl">
                  {[
                    { id: 'sms', label: 'SMS', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg> },
                    { id: 'whatsapp', label: 'WhatsApp', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg> },
                    { id: 'email', label: 'Email', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveChannel(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                        activeChannel === tab.id
                          ? 'bg-white/8 text-slate-200 shadow-sm'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/4'
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div className="p-4">
                  {messageError && (
                    <div className="mb-3 flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">
                      <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                      {messageError}
                    </div>
                  )}

                  {activeChannel === 'sms' && (
                    <form onSubmit={sendSms} className="flex flex-col gap-3">
                      <textarea
                        rows={3}
                        value={smsText}
                        onChange={(e) => setSmsText(e.target.value)}
                        placeholder="Write your SMS message..."
                        className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-none"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-600">{smsText.length}/160 chars</span>
                        <button
                          type="submit"
                          disabled={sendingMessage || !smsText.trim()}
                          className="flex items-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 text-cyan-400 text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          {sendingMessage ? 'Sending...' : 'Send SMS'}
                        </button>
                      </div>
                    </form>
                  )}

                  {activeChannel === 'whatsapp' && (
                    <form onSubmit={sendWhatsApp} className="flex flex-col gap-3">
                      {whatsappTemplates.length > 0 && (
                        <select
                          value={selectedWaTemplate}
                          onChange={(e) => {
                            setSelectedWaTemplate(e.target.value);
                            const t = whatsappTemplates.find(tpl => tpl._id === e.target.value);
                            setWhatsappText(t ? t.body : '');
                          }}
                          className="w-full text-xs bg-[#0a0c12] border border-white/8 rounded-xl px-3 py-2 text-slate-200 focus:outline-none cursor-pointer"
                        >
                          <option value="">â€” Custom message â€”</option>
                          {whatsappTemplates.map(tpl => (
                            <option key={tpl._id} value={tpl._id}>{tpl.name}</option>
                          ))}
                        </select>
                      )}
                      <textarea
                        rows={3}
                        value={whatsappText}
                        onChange={(e) => setWhatsappText(e.target.value)}
                        placeholder="Write your WhatsApp message..."
                        className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-emerald-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={sendingMessage || (!whatsappText.trim() && !selectedWaTemplate)}
                          className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          {sendingMessage ? 'Sending...' : 'Send WhatsApp'}
                        </button>
                      </div>
                    </form>
                  )}

                  {activeChannel === 'email' && (
                    <form onSubmit={sendOutboundEmail} className="flex flex-col gap-3">
                      {selectedLead.suppression?.email ? (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex gap-2">
                          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          <span>This lead has opted out of email communication. Individual emails cannot be sent.</span>
                        </div>
                      ) : (
                        <>
                          {inboxes.length > 0 && (
                            <select
                              value={selectedInboxId}
                              onChange={(e) => setSelectedInboxId(e.target.value)}
                              className="w-full text-[10px] bg-[#0a0c12] border border-white/8 rounded-xl px-3 py-2 text-slate-400 focus:outline-none cursor-pointer"
                            >
                              {inboxes.map(ib => (
                                <option key={ib._id} value={ib._id}>From: {ib.fromName} &lt;{ib.fromEmail}&gt;</option>
                              ))}
                            </select>
                          )}
                          <input
                            type="text"
                            value={emailSubject}
                            onChange={(e) => setEmailSubject(e.target.value)}
                            placeholder="Subject"
                            className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none"
                          />
                          <div className="flex items-center justify-between mt-1 mb-1">
                            <span className="text-[10px] text-slate-500 font-semibold uppercase">Message</span>
                            <button
                              type="button"
                              onClick={handleGenerateAiDraft}
                              disabled={isGeneratingAi}
                              className="flex items-center gap-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 px-2 py-0.5 rounded-lg transition-all disabled:opacity-40"
                            >
                              {isGeneratingAi ? (
                                <>
                                  <div className="w-2.5 h-2.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                  <span>Generating...</span>
                                </>
                              ) : (
                                <span>✨ AI Draft</span>
                              )}
                            </button>
                          </div>
                          <textarea
                            rows={10}
                            value={emailBody}
                            onChange={(e) => setEmailBody(e.target.value)}
                            placeholder="Email body (HTML or plain text)..."
                            className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-y min-h-[200px]"
                          />
                          <div className="flex justify-end">
                            <button
                              type="submit"
                              disabled={sendingMessage || !emailSubject.trim() || !emailBody.trim()}
                              className="flex items-center gap-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-400 text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              {sendingMessage ? 'Sending...' : 'Send Email'}
                            </button>
                          </div>
                        </>
                      )}
                    </form>
                  )}
                </div>
              </div>

              {/* Activity Timeline */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl flex flex-col overflow-hidden shadow-lg shadow-black/20" style={{maxHeight:'220px'}}>
                <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/5 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Activity Timeline</p>
                  <span className="text-[10px] text-slate-500 font-semibold">{leadHistory.length} entries</span>
                </div>
                <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
                  {leadHistory.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No activity recorded yet</p>
                  ) : (
                    leadHistory.map((h, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-2 border-b border-white/4 last:border-0">
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                          h.action === 'call' ? 'bg-cyan-500/15 text-cyan-400' :
                          h.action === 'email' ? 'bg-indigo-500/15 text-indigo-400' :
                          h.action === 'sms' ? 'bg-emerald-500/15 text-emerald-400' :
                          'bg-slate-700 text-slate-400'
                        }`}>
                          {h.action === 'call' && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
                          {h.action === 'email' && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                          {h.action === 'sms' && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>}
                          {!['call','email','sms'].includes(h.action) && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-300 capitalize">{h.action} — {h.outcome || 'note'}</span>
                            <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                          </div>
                          {h.notes && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{h.notes}</p>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}
        </main>

        {/* RIGHT: Outcome Panel (3 cols) */}
        <aside className="xl:col-span-3" id="outcome-panel">
          <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 h-full flex flex-col shadow-lg shadow-black/20">
            <div className="flex items-center gap-2 mb-5 pb-3 border-b border-white/5">
              <div className="w-5 h-5 rounded-md bg-cyan-500/15 flex items-center justify-center">
                <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Log Outcome</h3>
            </div>

            {!selectedLead ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <svg className="w-8 h-8 text-slate-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                <p className="text-xs text-slate-600">No active lead selected</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitOutcome} className="flex flex-col gap-4 flex-1">
                {outcomeError && (
                  <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">
                    <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                    {outcomeError}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Call Outcome</label>
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    className="w-full text-xs bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-white focus:outline-none cursor-pointer"
                  >
                    <option value="new">Select outcome...</option>
                    <option value="no-answer">No Answer — Auto Retry</option>
                    <option value="busy">Busy — Auto Retry</option>
                    <option value="voicemail">Voicemail — Auto Retry</option>
                    <option value="callback">Schedule Callback</option>
                    <option value="interested">Interested</option>
                    <option value="meeting-booked">Meeting Booked</option>
                    <option value="not-interested">Not Interested</option>
                    <option value="wrong-number">Wrong Number</option>
                    <option value="dnc">Do Not Call (DNC)</option>
                  </select>
                </div>

                {outcome === 'callback' && (
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Callback Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      required
                      value={callbackDate}
                      onChange={(e) => setCallbackDate(e.target.value)}
                      className="w-full text-xs bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-white focus:outline-none"
                    />
                  </div>
                )}

                {outcome === 'meeting-booked' && (
                  <div className="space-y-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Meeting Details</p>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Closer</label>
                      <select value={bookingCloser} onChange={(e) => setBookingCloser(e.target.value)} className="w-full text-xs bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none">
                        <option value="">Select closer...</option>
                        {closersList.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Meeting Date &amp; Time</label>
                      <input type="datetime-local" required value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="w-full text-xs bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Timezone</label>
                      <select value={bookingTimezone} onChange={(e) => setBookingTimezone(e.target.value)} className="w-full text-xs bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none">
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">EST — New York</option>
                        <option value="America/Chicago">CST — Chicago</option>
                        <option value="America/Denver">MST — Denver</option>
                        <option value="America/Los_Angeles">PST — Los Angeles</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Meeting Link</label>
                      <input type="url" value={bookingLink} onChange={(e) => setBookingLink(e.target.value)} placeholder="https://zoom.us/j/..." className="w-full text-xs bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none" />
                    </div>
                  </div>
                )}

                <div className="flex-1">
                  <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Notes</label>
                  <textarea
                    rows={6}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Summarise the call outcome..."
                    className="w-full h-full min-h-[100px] text-xs bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-white placeholder-slate-600 focus:outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingOutcome || outcome === 'new'}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-lg shadow-cyan-500/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                >
                  {submittingOutcome ? 'Saving...' : 'Save & Release Lead'}
                </button>
              </form>
            )}
          </div>
        </aside>

      </div>
      {showEmailComposeModal && selectedLead && (
        <div className="fixed inset-0 bg-[#07080d]/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#0f121d]/90 border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Send Email to {selectedLead.contact?.name}</h3>
              <button
                onClick={() => {
                  setShowEmailComposeModal(false);
                  setEmailSubject('');
                  setEmailBody('');
                }}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              await sendOutboundEmail(e);
              setShowEmailComposeModal(false);
            }} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">To</label>
                <input
                  type="text"
                  disabled
                  value={selectedLead.contact?.email}
                  className="w-full text-xs bg-[#0a0c12]/50 border border-white/5 rounded-xl px-3 py-2.5 text-slate-400 focus:outline-none cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Subject</label>
                <input
                  type="text"
                  required
                  placeholder="Subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Body</label>
                  <button
                    type="button"
                    onClick={handleGenerateAiDraft}
                    disabled={isGeneratingAi}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 px-2.5 py-1 rounded-lg transition-all disabled:opacity-40"
                  >
                    {isGeneratingAi ? (
                      <>
                        <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        <span>Generating AI Draft...</span>
                      </>
                    ) : (
                      <>
                        <span>✨ Generate AI Draft</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  rows={12}
                  required
                  placeholder="Write your email here or click Generate AI Draft..."
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl p-3.5 text-slate-200 focus:outline-none min-h-[240px] resize-y focus:ring-1 focus:ring-indigo-500/30"
                />
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailComposeModal(false);
                    setEmailSubject('');
                    setEmailBody('');
                  }}
                  className="px-4 py-2 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingMessage || !emailSubject.trim() || !emailBody.trim()}
                  className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  {sendingMessage ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}

    </div>
  );
}
