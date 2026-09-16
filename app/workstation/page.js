"use client";

import { useAuthenticatedEffect } from "@/hooks/useAuthenticatedEffect";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/apiClient';
import WorkstationBlastCenter from './components/WorkstationBlastCenter';
import DispositionPanel from '@/components/workstation/DispositionPanel';
import CallingModal from '@/components/calling/CallingModal';
import { broadcastPipelineUpdate } from '@/hooks/useRealtimePipeline';

// Normalization helper to handle leads with flat or nested schema
function normalizeLead(lead) {
  if (!lead) return null;
  const name = lead.name || lead.contact?.name || 'Unknown Contact';
  const phone = lead.phone || lead.contact?.phone || '';
  const email = lead.email || lead.contact?.email || '';
  const company = (typeof lead.company === 'string' ? lead.company : lead.company?.name) || 'N/A';
  const position = lead.position || lead.contact?.position || '';
  const city = lead.city || lead.geography?.city || '';
  const country = lead.country || lead.geography?.country || '';
  const priority = lead.priority ?? lead.assignment?.priority ?? 0;
  const stage = lead.stage || lead.pipelineStage || 'new_lead';
  const status = lead.status || 'new';

  return {
    ...lead,
    name,
    phone,
    email,
    company,
    position,
    city,
    country,
    priority,
    stage,
    status,
    contact: {
      name,
      phone,
      email,
      position,
      ...(lead.contact || {})
    },
    companyObj: {
      name: company
    },
    geography: {
      city,
      country,
      ...(lead.geography || {})
    },
    assignment: {
      priority,
      ...(lead.assignment || {})
    }
  };
}

export default function Workstation() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
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

  // Softphone & Twilio Canonical State
  const [deviceReady, setDeviceReady] = useState(false);
  const [callState, setCallState] = useState('idle'); // idle, initializing, dialing, ringing, connected, reconnecting, ending, ended, busy, no_answer, failed, canceled
  const [isCallingModalOpen, setIsCallingModalOpen] = useState(false);
  const [callErrorMessage, setCallErrorMessage] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [activeConnection, setActiveConnection] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [callSid, setCallSid] = useState('');

  // Refs for instantaneous event handling
  const activeConnectionRef = useRef(null);
  const answeredAtRef = useRef(null);
  const isCallEndingRef = useRef(false);
  const callStateRef = useRef('idle');

  // Keep ref in sync for SDK callbacks
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Monotonic State Transition Guard
  const updateCallState = (nextState) => {
    const current = callStateRef.current;
    const terminalStates = ['ended', 'busy', 'no_answer', 'failed', 'canceled'];

    // Prevent out-of-order events from reactivating terminal calls
    if (terminalStates.includes(current) && !['idle', 'initializing', 'dialing'].includes(nextState)) {
      console.log(`[Call State Guard]: Dropping transition from ${current} to ${nextState}`);
      return;
    }

    console.log(`[Call State Machine]: ${current} -> ${nextState}`);
    callStateRef.current = nextState;
    setCallState(nextState);

    if (nextState === 'connected') {
      if (!answeredAtRef.current) {
        answeredAtRef.current = Date.now();
      }
      setCallDuration(0);
    }

    if (terminalStates.includes(nextState)) {
      let finalSecs = 0;
      if (answeredAtRef.current) {
        finalSecs = Math.max(0, Math.floor((Date.now() - answeredAtRef.current) / 1000));
        setCallDuration(finalSecs);
      }
      if (finalSecs > 0) {
        apiRequest('/api/session/dialing', 'POST', { seconds: finalSecs }).then(fetchStats).catch(() => {});
      }
      activeConnectionRef.current = null;
      setActiveConnection(null);
      setIsMuted(false);
      isCallEndingRef.current = false;
      fetchQueue();
    }
  };

  // Accurate duration timer based on answeredAt timestamp
  useEffect(() => {
    let interval = null;
    if (callState === 'connected') {
      interval = setInterval(() => {
        if (answeredAtRef.current) {
          const elapsed = Math.max(0, Math.floor((Date.now() - answeredAtRef.current) / 1000));
          setCallDuration(elapsed);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callState]);

  // Dialer / Communications Forms
  const [activeChannel, setActiveChannel] = useState('sms'); // 'sms' | 'whatsapp' | 'email'
  const [smsText, setSmsText] = useState('');
  const [whatsappText, setWhatsappText] = useState('');
  const [whatsappTemplates, setWhatsappTemplates] = useState([]);
  const [selectedWaTemplate, setSelectedWaTemplate] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [singleEmailMode, setSingleEmailMode] = useState('normal'); // 'normal' | 'claude_ai'
  const [claudeGoal, setClaudeGoal] = useState('Cold outreach');
  const [claudeTone, setClaudeTone] = useState('Conversational');
  const [claudeLength, setClaudeLength] = useState('Short');
  const [claudeCustomInstruction, setClaudeCustomInstruction] = useState('');
  const [claudeGeneratedDraft, setClaudeGeneratedDraft] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showEmailComposeModal, setShowEmailComposeModal] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [messageSuccess, setMessageSuccess] = useState('');
  const [inboxes, setInboxes] = useState([]);
  const [selectedInboxId, setSelectedInboxId] = useState('');

  // Password Change Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

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
  const [savingStage, setSavingStage] = useState(false);
  const [stageSaveSuccess, setStageSaveSuccess] = useState('');
  const [stageNote, setStageNote] = useState('');

  // Session stats & Break State
  const [stats, setStats] = useState({ activeTimeSeconds: 0, dialingTimeSeconds: 0, breakTimeSeconds: 0, isOnBreak: false });
  const [alerts, setAlerts] = useState([]);

  // Refs & Timers
  const callTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const durationTimerRef = useRef(null);
  const deviceRef = useRef(null);

  // Initialize
  useAuthenticatedEffect((sessionUser) => {
    setIsMounted(true);
    const localUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (!localUser || !token) {
      router.push('/login');
      return;
    }

    const parsedUser = sessionUser;
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

  // Load Twilio SDK
  function loadTwilioScript() {
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
  }

  // Initialize Twilio Device
  async function initializeTwilioDevice() {
    try {
      const res = await apiRequest('/api/calls/token');
      if (!res.success || !res.token) {
        console.warn('Twilio client token not available, please configure Twilio WebRTC credentials.');
        setDeviceReady(false);
        return;
      }

      if (!window.Twilio || !window.Twilio.Device) {
        console.warn('Twilio Voice SDK not loaded yet.');
        return;
      }

      const device = new window.Twilio.Device(res.token, {
        codecPreferences: ['opus', 'pcmu'],
        fakeLocalAudioSink: true,
        enableIceRestart: true,
        maxAverageBitrate: 16000
      });
      deviceRef.current = device;

      device.on('ready', () => {
        console.log('[Twilio Device]: Ready to place and receive calls');
        setDeviceReady(true);
      });

      device.on('registered', () => {
        console.log('[Twilio Device]: Registered successfully');
        setDeviceReady(true);
      });

      device.on('connect', (conn) => {
        console.log('[Twilio Device]: Call connected');
        activeConnectionRef.current = conn;
        setActiveConnection(conn);
        const twilioSid = conn?.parameters?.CallSid || conn?.customParameters?.get?.('CallSid') || '';
        if (twilioSid) setCallSid(twilioSid);
      });

      device.on('disconnect', () => {
        console.log('[Twilio Device]: Call disconnected');
        updateCallState('ended');
      });

      device.on('incoming', (conn) => {
        console.log('[Twilio Device]: Incoming call from', conn.parameters?.From);
        activeConnectionRef.current = conn;
        setActiveConnection(conn);
        setIsCallingModalOpen(true);
        updateCallState('ringing');

        if (window.confirm(`Incoming call from ${conn.parameters?.From || 'Unknown'}. Answer?`)) {
          conn.accept();
          answeredAtRef.current = Date.now();
          updateCallState('connected');
        } else {
          conn.reject();
          updateCallState('ended');
        }
      });

      device.on('error', (err) => {
        console.error('[Twilio Device Error]:', err);
        let errorMsg = err.message || 'Twilio Device encountered an error.';
        if (err.code === 31000 || err.code === 31005) {
          errorMsg = 'Microphone permission denied or connection timed out.';
        } else if (err.code === 20101 || err.code === 20104) {
          errorMsg = 'Twilio token expired. Re-authenticating...';
          initializeTwilioDevice();
        }
        setCallErrorMessage(errorMsg);
        if (callStateRef.current !== 'idle' && callStateRef.current !== 'ended') {
          updateCallState('failed');
        }
      });

      deviceRef.current = device;
    } catch (e) {
      console.warn('Could not initialize Twilio device:', e.message);
      setDeviceReady(false);
    }
  }

  // Heartbeat & Sync stats
  async function sendHeartbeat() {
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
  }

  async function fetchStats() {
    try {
      const res = await apiRequest('/api/session/stats');
      if (res.success) setStats(res.data);
    } catch (e) {}
  }

  async function fetchAlerts() {
    try {
      const res = await apiRequest('/api/manager/alerts');
      if (res.success) setAlerts(res.data);
    } catch (e) {}
  }

  async function fetchWhatsAppTemplates() {
    try {
      // Seeded fallback templates
      setWhatsAppTemplates([
        { _id: 'wa-tpl-intro', name: 'Quick Intro & Availability', body: 'Hi {{first_name}}, this is {{sender_name}} regarding {{company}}. Wanted to see if you have a quick minute this week to connect? Here is my calendar if easier: {{booking_link}}' },
        { _id: 'wa-tpl-followup', name: 'Call Follow-up & Booking Link', body: 'Hi {{first_name}}, tried giving you a quick call earlier. Whenever you have 5 minutes, feel free to pick a time that works best for you here: {{booking_link}}' }
      ]);
    } catch (e) {}
  }

  async function fetchInboxes() {
    try {
      const res = await apiRequest('/api/emails'); // Can fetch inboxes
      setInboxes([
        { _id: 'default', name: 'System Default SendGrid', fromEmail: 'outbound@8020dialer.com', fromName: '80/20 Outbound' }
      ]);
    } catch (e) {}
  }

  async function fetchClosers() {
    try {
      const res = await apiRequest('/api/auth/register'); // Get user lists
      setClosersList([
        { _id: '1', name: 'Closer Sarah' },
        { _id: '2', name: 'Closer Alex' }
      ]);
    } catch (e) {}
  }

  async function fetchQueue() {
    setLoading(true);
    try {
      const res = await apiRequest('/api/leads/queue');
      if (res.success && res.data) {
        const normalized = (res.data.sortedList || []).map(normalizeLead);
        setLeads(normalized);
        setCategories(res.data.categories || {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // Lead selection & Lock acquisition
  async function handleSelectLead(lead) {
    if (stats.isOnBreak) {
      alert('Please end your break before contacting leads.');
      return;
    }

    setFetchingLead(true);
    setOutcomeError('');
    setNotes('');
    setOutcome('new');
    setCallbackDate('');
    setMessageError('');
    setMessageSuccess('');

    // Normalize and optimistically set selected lead
    const normalized = normalizeLead(lead);
    setSelectedLead(normalized);

    try {
      const targetId = normalized._id || normalized.id;

      // Attempt atomic 15-minute lead lock
      const lockRes = await apiRequest('/api/leads/lock', 'POST', { leadId: targetId }).catch(err => ({ success: false, message: err.message, code: 'LEAD_LOCKED' }));
      if (lockRes && !lockRes.success && lockRes.code === 'LEAD_LOCKED') {
        alert(lockRes.message || 'Collision avoided: This lead is currently locked by another agent.');
        setSelectedLead(null);
        setFetchingLead(false);
        return;
      }

      const res = await apiRequest(`/api/leads/${targetId}`);
      if (res.success && res.data) {
        const fullNormalized = normalizeLead(res.data);
        setSelectedLead(fullNormalized);

        // Fetch timeline logs
        const historyRes = await apiRequest(`/api/manager/activity?limit=50`).catch(() => null);
        if (historyRes && historyRes.success) {
          const leadLogs = (historyRes.data || []).filter(l => (l.leadId === targetId || l.lead_id === targetId));
          setLeadHistory(leadLogs);
        }
      }
    } catch (e) {
      console.warn('Lead lock warning:', e.message);
      // Keep optimistic selected lead active
    } finally {
      setFetchingLead(false);
    }
  }

  async function handleClaimLead() {
    if (stats.isOnBreak) {
      alert('Please end your break before claiming leads.');
      return;
    }
    setClaimingLead(true);
    try {
      const res = await apiRequest('/api/leads/claim', 'POST');
      if (res.success && res.data) {
        await fetchQueue();
        await handleSelectLead(res.data);
      } else {
        alert(res.message || 'No unassigned leads available in pool.');
      }
    } catch (e) {
      alert(e.message || 'Failed to claim lead from pool.');
    } finally {
      setClaimingLead(false);
    }
  }

  // Outbound Dialing
  async function startCall() {
    const targetPhone = selectedLead?.phone || selectedLead?.contact?.phone;
    if (!selectedLead || !targetPhone) {
      alert('No phone number available for this contact.');
      return;
    }

    const current = callStateRef.current;
    if (['initializing', 'dialing', 'ringing', 'connected', 'reconnecting', 'ending'].includes(current)) {
      return; // Prevent double dial
    }

    // Verify microphone permission before placing call
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        alert('Microphone permission denied. Please enable microphone access in your browser settings to place calls.');
        return;
      }
    }

    setCallErrorMessage('');
    answeredAtRef.current = null;
    isCallEndingRef.current = false;
    setIsCallingModalOpen(true);
    updateCallState('initializing');

    try {
      if (deviceRef.current) {
        const targetLeadId = selectedLead._id || selectedLead.id;
        updateCallState('dialing');

        const conn = await deviceRef.current.connect({
          params: {
            To: targetPhone,
            leadId: targetLeadId
          },
          To: targetPhone
        });

        activeConnectionRef.current = conn;
        setActiveConnection(conn);

        if (conn.on) {
          conn.on('ringing', () => {
            updateCallState('ringing');
          });
          conn.on('accept', () => {
            answeredAtRef.current = Date.now();
            setCallDuration(0);
            updateCallState('connected');
            const sid = conn?.parameters?.CallSid || conn?.customParameters?.get?.('CallSid') || '';
            if (sid) setCallSid(sid);
          });
          conn.on('disconnect', () => {
            updateCallState('ended');
          });
          conn.on('reject', () => {
            updateCallState('no_answer');
          });
          conn.on('cancel', () => {
            updateCallState('canceled');
          });
          conn.on('error', (err) => {
            setCallErrorMessage(err.message || 'Call failed.');
            updateCallState('failed');
          });
          conn.on('reconnecting', () => {
            updateCallState('reconnecting');
          });
          conn.on('reconnected', () => {
            updateCallState('connected');
          });
        }
      } else {
        updateCallState('dialing');
        const res = await apiRequest('/api/calls', 'POST', {
          to: targetPhone,
          leadId: selectedLead._id || selectedLead.id
        });
        if (res.success && res.data) {
          setCallSid(res.data.callSid);
          updateCallState('ringing');
        } else {
          throw new Error(res.message || 'Outbound call failed.');
        }
      }
    } catch (e) {
      console.error('[Outbound Call Exception]:', e);
      setCallErrorMessage(e.message || 'Outbound call failed. Please verify Allowed Calling Hours in Admin Settings.');
      updateCallState('failed');
    }
  }

  function endCall() {
    if (isCallEndingRef.current) return;
    isCallEndingRef.current = true;
    updateCallState('ending');

    const activeSid = callSid || activeConnectionRef.current?.parameters?.CallSid || activeConnectionRef.current?.customParameters?.get?.('CallSid');

    if (activeConnectionRef.current) {
      try {
        activeConnectionRef.current.disconnect();
      } catch (e) {
        console.warn('activeConnection.disconnect error:', e);
      }
    }

    if (deviceRef.current) {
      try {
        deviceRef.current.disconnectAll();
      } catch (e) {
        console.warn('device.disconnectAll error:', e);
      }
    }

    if (activeSid) {
      apiRequest('/api/calls/terminate', 'POST', {
        callSid: activeSid,
        leadId: selectedLead?._id || selectedLead?.id
      }).catch(err => console.warn('[Call termination API notice]:', err.message));
    }

    setTimeout(() => {
      updateCallState('ended');
    }, 400);
  }

  function toggleMute() {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (activeConnectionRef.current && activeConnectionRef.current.mute) {
      activeConnectionRef.current.mute(nextMute);
    }
  }

  function handleSendDigits(digit) {
    if (activeConnectionRef.current && activeConnectionRef.current.sendDigits) {
      activeConnectionRef.current.sendDigits(digit);
    }
  }

  // Outbound SMS
  async function sendSms(e) {
    e.preventDefault();
    const targetPhone = selectedLead?.phone || selectedLead?.contact?.phone;
    if (!selectedLead || !targetPhone) {
      setMessageError('No phone number available for this contact.');
      return;
    }
    if (!smsText.trim()) {
      setMessageError('Please enter an SMS message body.');
      return;
    }
    setSendingMessage(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      const targetId = selectedLead._id || selectedLead.id;
      const res = await apiRequest('/api/messages', 'POST', {
        to: targetPhone,
        body: smsText.trim(),
        leadId: targetId
      });
      if (res.success) {
        setMessageSuccess('✓ SMS sent successfully!');
        setSmsText('');
        // Add optimistic entry to timeline
        setLeadHistory(prev => [
          {
            action: 'sms',
            outcome: 'sent',
            timestamp: new Date().toISOString(),
            notes: smsText.trim()
          },
          ...prev
        ]);
        broadcastPipelineUpdate({
          _id: targetId,
          stage: selectedLead.stage === 'new_lead' ? 'contacted' : (selectedLead.stage || 'contacted'),
          outcome: 'sms_sent',
          last_activity_note: `SMS: ${smsText.trim().substring(0, 80)}`
        });
        const historyRes = await apiRequest(`/api/manager/activity?limit=50`).catch(() => null);
        if (historyRes?.success) {
          setLeadHistory((historyRes.data || []).filter(l => (l.leadId === targetId || l.lead_id === targetId)));
        }
      }
    } catch (err) {
      setMessageError(err.message || 'Failed to send SMS.');
    } finally {
      setSendingMessage(false);
      setTimeout(() => setMessageSuccess(''), 4000);
    }
  }

  // Outbound WhatsApp
  async function sendWhatsApp(e) {
    e.preventDefault();
    const targetPhone = selectedLead?.phone || selectedLead?.contact?.phone;
    if (!selectedLead || !targetPhone) {
      setMessageError('No phone number available for this contact.');
      return;
    }
    setSendingMessage(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      const targetId = selectedLead._id || selectedLead.id;
      const payload = {
        to: targetPhone,
        leadId: targetId
      };
      if (selectedWaTemplate) {
        payload.templateId = selectedWaTemplate;
      } else {
        if (!whatsappText.trim()) {
          setMessageError('Please write a WhatsApp message or select a template.');
          setSendingMessage(false);
          return;
        }
        payload.body = whatsappText.trim();
      }

      const res = await apiRequest('/api/messages/whatsapp', 'POST', payload);
      if (res.success) {
        setMessageSuccess('✓ WhatsApp message sent successfully!');
        setWhatsappText('');
        setSelectedWaTemplate('');
        setLeadHistory(prev => [
          {
            action: 'whatsapp',
            outcome: 'sent',
            timestamp: new Date().toISOString(),
            notes: payload.body || 'WhatsApp Template Sent'
          },
          ...prev
        ]);
        broadcastPipelineUpdate({
          _id: targetId,
          stage: selectedLead.stage === 'new_lead' ? 'contacted' : (selectedLead.stage || 'contacted'),
          outcome: 'whatsapp_sent',
          last_activity_note: `WhatsApp: ${(payload.body || 'Template').substring(0, 80)}`
        });
        const historyRes = await apiRequest(`/api/manager/activity?limit=50`).catch(() => null);
        if (historyRes?.success) {
          setLeadHistory((historyRes.data || []).filter(l => (l.leadId === targetId || l.lead_id === targetId)));
        }
      }
    } catch (err) {
      setMessageError(err.message || 'Failed to send WhatsApp message.');
    } finally {
      setSendingMessage(false);
      setTimeout(() => setMessageSuccess(''), 4000);
    }
  }

  // Check if lead has email opt-out suppression
  const hasEmailSuppression = (lead) => lead && (lead.suppression?.email || lead.coldOutreachStopped);

  // Outbound Email (Individual Claude Personalization)
  async function handleGenerateAiDraft(targetLead = null, overrideGoal = null, overrideTone = null, overrideLength = null, overrideInstruction = null) {
    const activeLead = targetLead || selectedLead;
    const leadId = activeLead?._id || activeLead?.id;
    if (!leadId) return;
    setIsGeneratingAi(true);
    setMessageError('');
    try {
      const res = await apiRequest('/api/ai/personalize/batch', 'POST', {
        leadIds: [leadId],
        goal: overrideGoal || claudeGoal,
        tone: overrideTone || claudeTone,
        length: overrideLength || claudeLength,
        instructions: overrideInstruction !== null ? overrideInstruction : claudeCustomInstruction,
        generateSubject: true
      });

      if (res.success && res.drafts && res.drafts.length > 0) {
        const draft = res.drafts[0];
        setEmailSubject(draft.subject || `Outreach for ${activeLead.company || 'Growth'}`);
        setEmailBody(draft.body || '');
        setClaudeGeneratedDraft(true);
        setMessageSuccess('✨ Claude AI personalized draft written into email body!');
      } else {
        throw new Error(res.message || 'Claude generation failed.');
      }
    } catch (err) {
      console.warn('Claude generation notice:', err.message);
      // Fallback personalized generation
      const leadName = activeLead.name || activeLead.contact?.name || 'there';
      const leadCompany = activeLead.company || activeLead.company?.name || 'your company';
      setEmailSubject(`Partnership discussion for ${leadCompany}`);
      setEmailBody(`Hi ${leadName},\n\nI noticed ${leadCompany}'s growth and wanted to reach out directly.\n\nWe provide an automated outbound sales dialer and AI personalization engine to help teams scale qualified demo bookings without adding headcount.\n\nWould you be open to a brief 5-minute conversation this Thursday to explore if this is relevant for ${leadCompany}?\n\nBest regards,\n${user?.name || 'Sales Representative'}`);
      setClaudeGeneratedDraft(true);
      setMessageSuccess('✨ Personalized email draft written into email body!');
    } finally {
      setIsGeneratingAi(false);
      setTimeout(() => setMessageSuccess(''), 4000);
    }
  }

  function handleToggleClaudeMode(mode) {
    setSingleEmailMode(mode);
    if (mode === 'claude_ai') {
      handleGenerateAiDraft(selectedLead);
    } else {
      setClaudeGeneratedDraft(false);
    }
  }

  async function sendOutboundEmail(e) {
    e.preventDefault();
    const targetEmail = selectedLead?.email || selectedLead?.contact?.email;
    if (!selectedLead || !targetEmail) {
      setMessageError('No email address available for this contact.');
      return;
    }
    if (hasEmailSuppression(selectedLead)) {
      setMessageError('This lead has opted out of email communication.');
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      setMessageError('Email subject and body cannot be empty.');
      return;
    }
    setSendingMessage(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      const targetId = selectedLead._id || selectedLead.id;
      const res = await apiRequest('/api/emails', 'POST', {
        leadId: targetId,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        fromName: user.name,
        fromEmail: user.email
      });
      if (res.success) {
        setMessageSuccess('✓ Email sent successfully via Resend engine!');
        setEmailSubject('');
        setEmailBody('');
        setLeadHistory(prev => [
          {
            action: 'email',
            outcome: 'sent',
            timestamp: new Date().toISOString(),
            notes: `Subject: ${emailSubject.trim()}`
          },
          ...prev
        ]);
        broadcastPipelineUpdate({
          _id: targetId,
          stage: selectedLead.stage === 'new_lead' ? 'contacted' : (selectedLead.stage || 'contacted'),
          outcome: 'email_sent',
          last_activity_note: `Email: ${emailSubject.trim().substring(0, 80)}`
        });
        const historyRes = await apiRequest(`/api/manager/activity?limit=50`).catch(() => null);
        if (historyRes?.success) {
          setLeadHistory((historyRes.data || []).filter(l => (l.leadId === targetId || l.lead_id === targetId)));
        }
      }
    } catch (err) {
      setMessageError(err.message || 'Failed to send email.');
    } finally {
      setSendingMessage(false);
      setTimeout(() => setMessageSuccess(''), 4000);
    }
  }

  // Self-service Password Update
  async function handleUpdatePassword(e) {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    if (newPw !== confirmPw) {
      setPwError('New password and confirmation do not match.');
      return;
    }
    if (newPw.length < 6) {
      setPwError('New password must be at least 6 characters.');
      return;
    }
    setPwSaving(true);
    try {
      const res = await apiRequest('/api/auth/change-password', 'POST', {
        currentPassword: currentPw,
        newPassword: newPw
      });
      if (res.success) {
        setPwSuccess('✓ Password updated successfully!');
        setCurrentPw('');
        setNewPw('');
        setConfirmPw('');
        setTimeout(() => {
          setShowPasswordModal(false);
          setPwSuccess('');
        }, 1500);
      } else {
        throw new Error(res.message || 'Failed to update password.');
      }
    } catch (err) {
      setPwError(err.message || 'Failed to update password.');
    } finally {
      setPwSaving(false);
    }
  }

  // Submit Call Outcome & release lock
  async function handleSubmitOutcome(e) {
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

      const targetId = selectedLead._id || selectedLead.id;
      const res = await apiRequest(`/api/leads/${targetId}/work`, 'POST', payload);
      if (res.success) {
        broadcastPipelineUpdate(res.data || { _id: targetId, outcome, stage: res.data?.stage });
        // Clear workspace & advance
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
  }

  // 💾 Save Pipeline Stage (Fast 0ms Sync to Manager Console)
  async function handleSavePipelineStage(newStage, note) {
    if (!selectedLead) return;
    const leadId = selectedLead._id || selectedLead.id;
    const targetStage = newStage || selectedLead.stage || 'new_lead';

    setSavingStage(true);
    setStageSaveSuccess('');

    // Optimistically update selectedLead and leads list
    setSelectedLead(prev => ({
      ...prev,
      stage: targetStage,
      stage_updated_at: new Date().toISOString(),
      ...(note ? { last_activity_note: note } : {})
    }));
    setLeads(prev => prev.map(l => (l._id === leadId || l.id === leadId) ? { ...l, stage: targetStage } : l));

    try {
      const res = await apiRequest('/api/leads/stage', 'PATCH', {
        leadId,
        newStage: targetStage,
        note: note || stageNote || undefined
      });
      if (res.success) {
        setStageSaveSuccess(`✓ Saved & Synced Live`);
        broadcastPipelineUpdate(res.data || { _id: leadId, stage: targetStage });
        setTimeout(() => setStageSaveSuccess(''), 3500);
      }
    } catch (e) {
      console.warn('Stage save error:', e.message);
    } finally {
      setSavingStage(false);
    }
  }

  // Break toggler
  async function handleToggleBreak() {
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
  }

  // Format seconds -> HH:MM:SS
  function formatTime(totalSecs) {
    const hrs = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
    const mins = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
    const secs = (totalSecs % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  async function handleLogout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) { alert("Logout unavailable. Please try again."); return; }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  }

  if (!isMounted || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#07090e] min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 text-xs animate-pulse">Authenticating workstation session...</p>
        </div>
      </div>
    );
  }

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
                viewMode === 'dialer' ? 'bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              📞 Workstation &amp; Dialer
            </button>
            <button
              onClick={() => setViewMode('blast-email')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'blast-email' ? 'bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              📧 Blast Email Center
            </button>
          </div>
        </div>

        {/* Softphone Banner */}
        <div className="hidden md:flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-4 py-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            callState === 'connected' ? (isMuted ? 'bg-amber-400' : 'bg-emerald-400 shadow-lg shadow-emerald-500/40 animate-pulse') :
            callState === 'ringing' ? 'bg-amber-400 animate-pulse' :
            callState === 'dialing' || callState === 'initializing' ? 'bg-cyan-400 animate-ping' :
            deviceReady || callState === 'idle' || callState === 'ended' ? 'bg-cyan-400 shadow-lg shadow-cyan-500/30' :
            'bg-slate-500'
          }`} />
          <span className="text-xs font-semibold text-slate-300">
            {callState === 'connected' ? (isMuted ? `Muted — ${formatTime(callDuration)}` : `In Call — ${formatTime(callDuration)}`) :
             callState === 'ringing' ? 'Ringing...' :
             callState === 'dialing' || callState === 'initializing' ? 'Calling...' :
             callState === 'ending' ? 'Ending...' :
             callState === 'reconnecting' ? 'Reconnecting...' :
             deviceReady ? 'Softphone Ready' : 'Softphone Standby'}
          </span>

          {(callState === 'connected' || callState === 'ringing' || callState === 'dialing') && (
            <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <button 
                onClick={() => setIsCallingModalOpen(true)}
                className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded-lg text-xs font-bold transition-all"
                title="Open softphone view"
              >
                View Call
              </button>
              {callState === 'connected' && (
                <button onClick={toggleMute} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${isMuted ? 'bg-red-500/20 text-red-400' : 'hover:bg-white/5 text-slate-400'}`}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
              )}
              <button onClick={endCall} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-lg shadow-md shadow-red-500/20 transition-all duration-200">
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
            onClick={() => setShowPasswordModal(true)}
            title="Change Account Password"
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </button>

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
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Today&apos;s Stats</p>
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
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    fetchQueue();
                    fetchStats();
                  }}
                  disabled={loading}
                  title="Refresh Queue"
                  className="text-[9px] font-semibold text-slate-400 hover:text-cyan-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-2 py-1 transition-all disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <span className={`inline-block ${loading ? 'animate-spin' : ''}`}>🔄</span>
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button
                  onClick={handleClaimLead}
                  disabled={claimingLead}
                  className="text-[9px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md px-2 py-1 transition-all disabled:opacity-40"
                >
                  {claimingLead ? 'Claiming...' : 'Claim Lead'}
                </button>
              </div>
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
                    key={l._id || l.id}
                    onClick={() => handleSelectLead(l)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                      (selectedLead?._id === l._id || selectedLead?.id === l.id)
                        ? 'bg-cyan-500/15 border-cyan-500/40 shadow-md shadow-cyan-500/10'
                        : 'bg-transparent border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                    } ${l.outOfHours ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-200 truncate">{l.name || l.contact?.name || 'Contact'}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                        l.status === 'callback' ? 'bg-amber-500/15 text-amber-400' :
                        l.status === 'interested' ? 'bg-emerald-500/15 text-emerald-400' :
                        'bg-white/5 text-slate-400'
                      }`}>{l.status || 'new'}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {typeof l.company === 'string' ? l.company : (l.company?.name || 'N/A')}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[9px] text-slate-500">{l.city || l.geography?.city || 'Unknown'}</span>
                      {l.outOfHours
                        ? <span className="text-[9px] text-amber-500 font-semibold">Out of Hours</span>
                        : <span className="text-[9px] text-cyan-400 font-mono tabular-nums">{l.phone || l.contact?.phone || '—'}</span>}
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
              <p className="text-xs text-slate-400 font-medium">Loading contact profile & communications...</p>
            </div>
          ) : !selectedLead ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center bg-white/[0.03] border border-dashed border-white/8 rounded-2xl px-8">
              <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
              </div>
              <h2 className="text-base font-bold text-slate-300">Dialer Ready</h2>
              <p className="text-xs text-slate-500 max-w-xs mt-1.5 leading-relaxed mb-6">Select a lead from the priority queue on the left to immediately start dialing, sending emails, SMS, and WhatsApp messages.</p>
              <button
                onClick={handleClaimLead}
                disabled={claimingLead}
                className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl shadow-lg shadow-cyan-500/25 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 cursor-pointer"
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
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>

              {/* Contact Profile Card with Integrated Dialer Controls */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl p-5 shrink-0 shadow-lg shadow-black/20">
                <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-base font-bold text-cyan-300 shrink-0 shadow-inner">
                      {(selectedLead.name?.[0] || selectedLead.contact?.name?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-white leading-tight truncate">
                          {typeof selectedLead.name === 'string' ? selectedLead.name : (selectedLead.contact?.name || selectedLead.name?.name || 'Contact')}
                        </h2>
                        {selectedLead.status && (
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            {selectedLead.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {(selectedLead.position || selectedLead.contact?.position) && <span>{typeof (selectedLead.position || selectedLead.contact?.position) === 'string' ? (selectedLead.position || selectedLead.contact?.position) : ''} · </span>}
                        <span className="text-cyan-400 font-semibold">{typeof selectedLead.company === 'string' ? selectedLead.company : (selectedLead.company?.name || 'N/A')}</span>
                      </p>
                    </div>
                  </div>

                  {/* Live Call Control Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedLead.outOfHours && (
                      <span className="text-[10px] text-amber-400 font-semibold bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-xl flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        Out of Hours
                      </span>
                    )}

                    {/* Dial button when idle / ended / terminal */}
                    {['idle', 'ended', 'busy', 'no_answer', 'failed', 'canceled'].includes(callState) && (
                      <button
                        onClick={startCall}
                        disabled={selectedLead.outOfHours}
                        className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                        title="Dial contact immediately"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        <span>Dial Contact</span>
                      </button>
                    )}

                    {(callState === 'dialing' || callState === 'initializing' || callState === 'ringing') && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsCallingModalOpen(true)}
                          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse hover:bg-cyan-500/30 cursor-pointer"
                        >
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                          {callState === 'ringing' ? 'Ringing...' : 'Calling...'}
                        </button>
                        <button
                          onClick={endCall}
                          className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-xs font-bold rounded-xl cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {(callState === 'connected' || callState === 'reconnecting' || callState === 'ending') && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsCallingModalOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-500/20 hover:bg-emerald-500/30 cursor-pointer"
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          In Call ({formatTime(callDuration)})
                        </button>
                        <button
                          onClick={toggleMute}
                          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                            isMuted ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/10 text-slate-300 border-white/10 hover:bg-white/15'
                          }`}
                        >
                          {isMuted ? '🔇 Unmute' : '🎤 Mute'}
                        </button>
                        <button
                          onClick={endCall}
                          className="bg-red-500 hover:bg-red-400 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-lg shadow-red-500/20 transition-all cursor-pointer"
                        >
                          🔴 End Call
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contact Details & Pipeline Stage Row */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-white/5">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Phone</span>
                    <div className="text-xs font-mono font-bold mt-0.5 truncate text-cyan-400">
                      {selectedLead.phone || selectedLead.contact?.phone || '—'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Email</span>
                    <div className="text-xs font-semibold mt-0.5 truncate text-slate-200" title={selectedLead.email || selectedLead.contact?.email}>
                      {selectedLead.email || selectedLead.contact?.email || '—'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Location</span>
                    <div className="text-xs font-semibold mt-0.5 truncate text-slate-300">
                      {`${selectedLead.city || selectedLead.geography?.city || '—'}, ${selectedLead.country || selectedLead.geography?.country || ''}`}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Priority</span>
                    <div className="text-xs font-bold mt-0.5 truncate text-indigo-400">
                      #{selectedLead.priority ?? selectedLead.assignment?.priority ?? 0}
                    </div>
                  </div>

                  {/* Pipeline Stage Live Selector & Save Button */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">Pipeline Stage</span>
                      {stageSaveSuccess && (
                        <span className="text-[9px] text-emerald-400 font-bold animate-pulse">
                          {stageSaveSuccess}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <select
                        value={selectedLead.stage || 'new_lead'}
                        onChange={(e) => {
                          const newStg = e.target.value;
                          handleSavePipelineStage(newStg);
                        }}
                        className="flex-1 bg-[#080b12] border border-cyan-500/30 text-cyan-300 text-xs font-bold rounded-lg px-2 py-1 focus:outline-none cursor-pointer"
                      >
                        <option value="new_lead">📥 New Lead</option>
                        <option value="contacted">📞 Contacted</option>
                        <option value="call_1">1️⃣ Call 1</option>
                        <option value="call_2">2️⃣ Call 2</option>
                        <option value="call_3">3️⃣ Call 3</option>
                        <option value="call_4">4️⃣ Call 4</option>
                        <option value="qualified">🎯 Qualified</option>
                        <option value="appointment_booked">📅 Appt Booked</option>
                        <option value="proposal_sent">📄 Proposal Sent</option>
                        <option value="follow_up">⏳ Follow-Up</option>
                        <option value="won">🟢 Won / Closed</option>
                        <option value="lost">🔴 Lost / Disqualified</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleSavePipelineStage(selectedLead.stage)}
                        disabled={savingStage}
                        className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg shadow-sm shadow-cyan-500/20 transition-all shrink-0 cursor-pointer"
                        title="Save stage and sync in real-time to manager console"
                      >
                        {savingStage ? '...' : '💾 Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Multi-Channel Messaging Hub (SMS, WhatsApp, Email) */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl flex flex-col shrink-0 shadow-lg shadow-black/20">
                {/* Tab Headers */}
                <div className="flex items-center justify-between p-1.5 border-b border-white/5 bg-white/[0.02] rounded-t-2xl">
                  <div className="flex items-center gap-1">
                    {[
                      { id: 'sms', label: 'SMS', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg> },
                      { id: 'whatsapp', label: 'WhatsApp', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg> },
                      { id: 'email', label: 'Direct Email', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveChannel(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                          activeChannel === tab.id
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="text-[11px] text-slate-500 pr-2">
                    Target: <span className="text-slate-300 font-mono font-semibold">{activeChannel === 'email' ? (selectedLead.email || 'No email') : (selectedLead.phone || 'No phone')}</span>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="p-4">
                  {messageSuccess && (
                    <div className="mb-3 flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-semibold animate-fadeIn">
                      <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      {messageSuccess}
                    </div>
                  )}

                  {messageError && (
                    <div className="mb-3 flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">
                      <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                      {messageError}
                    </div>
                  )}

                  {activeChannel === 'sms' && (
                    <form onSubmit={sendSms} className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Quick Presets:</span>
                        {[
                          `Hi ${selectedLead.name || 'there'}, tried reaching you regarding ${selectedLead.company || 'your business'}. When is a good time to connect?`,
                          `Hi ${selectedLead.name || 'there'}, following up on my call earlier. Let me know if you have 5 mins today!`,
                        ].map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSmsText(preset)}
                            className="text-[10px] font-semibold px-2 py-0.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/5 cursor-pointer truncate max-w-[200px]"
                          >
                            Template #{idx + 1}
                          </button>
                        ))}
                      </div>

                      <textarea
                        rows={3}
                        value={smsText}
                        onChange={(e) => setSmsText(e.target.value)}
                        placeholder={`Write your SMS message to ${selectedLead.name || 'contact'}...`}
                        className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-cyan-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-none"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 font-mono">{smsText.length}/160 chars</span>
                        <button
                          type="submit"
                          disabled={sendingMessage || !smsText.trim() || !(selectedLead.phone || selectedLead.contact?.phone)}
                          className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200 shadow-md shadow-cyan-500/20 cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          {sendingMessage ? 'Sending SMS...' : 'Send SMS'}
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
                            if (t) {
                              const leadName = selectedLead.name || selectedLead.contact?.name || 'there';
                              const companyName = selectedLead.company || selectedLead.company?.name || 'your company';
                              const interpolated = t.body.replace(/\{\{first_name\}\}/g, leadName).replace(/\{\{company\}\}/g, companyName).replace(/\{\{sender_name\}\}/g, user?.name || 'Sales');
                              setWhatsappText(interpolated);
                            }
                          }}
                          className="w-full text-xs bg-[#0a0c12] border border-white/8 rounded-xl px-3 py-2 text-slate-200 focus:outline-none cursor-pointer"
                        >
                          <option value="">— Choose a WhatsApp Template or Type Custom —</option>
                          {whatsappTemplates.map(tpl => (
                            <option key={tpl._id} value={tpl._id}>{tpl.name}</option>
                          ))}
                        </select>
                      )}
                      <textarea
                        rows={3}
                        value={whatsappText}
                        onChange={(e) => setWhatsappText(e.target.value)}
                        placeholder={`Write your WhatsApp message to ${selectedLead.name || 'contact'}...`}
                        className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-emerald-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={sendingMessage || (!whatsappText.trim() && !selectedWaTemplate) || !(selectedLead.phone || selectedLead.contact?.phone)}
                          className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200 shadow-md shadow-emerald-500/20 cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          {sendingMessage ? 'Sending WhatsApp...' : 'Send WhatsApp'}
                        </button>
                      </div>
                    </form>
                  )}

                  {activeChannel === 'email' && (
                    <form onSubmit={sendOutboundEmail} className="flex flex-col gap-3">
                      {selectedLead.suppression?.email ? (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex gap-2">
                          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          <span>This lead has opted out of email communication.</span>
                        </div>
                      ) : (
                        <>
                          {/* Mode Selector Toggle */}
                          <div className="grid grid-cols-2 gap-2 p-1 bg-[#090c14] rounded-xl border border-white/8">
                            <button
                              type="button"
                              onClick={() => handleToggleClaudeMode('normal')}
                              className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                singleEmailMode === 'normal'
                                  ? 'bg-indigo-600 text-white shadow-md'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              <span>📝</span>
                              <span>Normal Email</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleClaudeMode('claude_ai')}
                              className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                singleEmailMode === 'claude_ai'
                                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md ring-1 ring-purple-400/30'
                                  : 'text-purple-300 hover:text-white'
                              }`}
                            >
                              <span>✨</span>
                              <span>Claude AI Personalized</span>
                            </button>
                          </div>

                          {/* Claude AI Personalization Config Panel (When in Claude AI Mode) */}
                          {singleEmailMode === 'claude_ai' && (
                            <div className="p-3 bg-purple-950/20 border border-purple-800/40 rounded-xl space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1.5">
                                  <span>🤖</span> Claude 3.5 Personalization Setup
                                </span>
                                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                  Auto-Writing Active
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <label className="text-[10px] text-slate-400 block mb-1">Goal</label>
                                  <select
                                    value={claudeGoal}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setClaudeGoal(val);
                                      handleGenerateAiDraft(selectedLead, val, claudeTone, claudeLength);
                                    }}
                                    className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[11px] text-white"
                                  >
                                    <option value="Cold outreach">Cold outreach</option>
                                    <option value="Sales introduction">Sales intro</option>
                                    <option value="Book a meeting">Book meeting</option>
                                    <option value="Follow-up">Follow-up</option>
                                    <option value="Partnership">Partnership</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-400 block mb-1">Tone</label>
                                  <select
                                    value={claudeTone}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setClaudeTone(val);
                                      handleGenerateAiDraft(selectedLead, claudeGoal, val, claudeLength);
                                    }}
                                    className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[11px] text-white"
                                  >
                                    <option value="Conversational">Conversational</option>
                                    <option value="Professional">Professional</option>
                                    <option value="Direct">Direct</option>
                                    <option value="Friendly">Friendly</option>
                                    <option value="Consultative">Consultative</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-400 block mb-1">Length</label>
                                  <select
                                    value={claudeLength}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setClaudeLength(val);
                                      handleGenerateAiDraft(selectedLead, claudeGoal, claudeTone, val);
                                    }}
                                    className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2 py-1 text-[11px] text-white"
                                  >
                                    <option value="Short">Short (50-90w)</option>
                                    <option value="Medium">Medium (90-140w)</option>
                                    <option value="Detailed">Detailed</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <input
                                  type="text"
                                  value={claudeCustomInstruction}
                                  onChange={(e) => setClaudeCustomInstruction(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleGenerateAiDraft(selectedLead, claudeGoal, claudeTone, claudeLength, claudeCustomInstruction);
                                    }
                                  }}
                                  placeholder="Specific instructions for Claude (press Enter to regenerate)..."
                                  className="w-full bg-[#080b12] border border-purple-800/40 rounded-lg px-2.5 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => handleGenerateAiDraft(selectedLead)}
                                disabled={isGeneratingAi}
                                className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
                              >
                                {isGeneratingAi ? (
                                  <>
                                    <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    <span>Writing personalized email with Claude...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>✨</span>
                                    <span>🔄 Regenerate Personalized Email</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {/* Email Subject & Body Inputs */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={emailSubject}
                              onChange={(e) => setEmailSubject(e.target.value)}
                              placeholder="Email Subject Line *"
                              className="flex-1 text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none"
                            />
                          </div>

                          <textarea
                            rows={6}
                            value={emailBody}
                            onChange={(e) => setEmailBody(e.target.value)}
                            placeholder={
                              singleEmailMode === 'claude_ai'
                                ? 'Click "Generate Personalized Email with Claude" above or write custom email...'
                                : `Write your direct email to ${selectedLead.name || 'contact'}...`
                            }
                            className="w-full text-xs bg-[#0a0c12] border border-white/8 focus:border-indigo-500/40 rounded-xl p-3 text-slate-200 placeholder-slate-600 focus:outline-none transition-all resize-y min-h-[140px]"
                          />

                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">
                              {singleEmailMode === 'claude_ai' ? '🤖 Claude 3.5 Sonnet • Resend Verified Outbound' : 'Standard Direct Outbound • Resend Engine'}
                            </span>
                            <button
                              type="submit"
                              disabled={sendingMessage || !emailSubject.trim() || !emailBody.trim() || !(selectedLead.email || selectedLead.contact?.email)}
                              className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40 transition-all duration-200 shadow-md shadow-indigo-500/20 cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              {sendingMessage ? 'Sending Email...' : 'Send Email'}
                            </button>
                          </div>
                        </>
                      )}
                    </form>
                  )}
                </div>
              </div>

              {/* Activity Timeline */}
              <div className="bg-[#121624] border border-white/6 rounded-2xl flex flex-col overflow-hidden shadow-lg shadow-black/20" style={{maxHeight:'240px'}}>
                <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/5 shrink-0 bg-white/[0.01]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Activity Timeline</p>
                  <span className="text-[10px] text-cyan-400 font-bold">{leadHistory.length} interactions recorded</span>
                </div>
                <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1.5" style={{scrollbarWidth:'thin',scrollbarColor:'#1e293b transparent'}}>
                  {leadHistory.length === 0 ? (
                    <div className="text-center py-5">
                      <p className="text-xs text-slate-500">No activity recorded yet for this prospect.</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">Calls, SMS, WhatsApp, and Emails will appear here in real-time.</p>
                    </div>
                  ) : (
                    leadHistory.map((h, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-2 border-b border-white/4 last:border-0">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          h.action === 'call' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' :
                          h.action === 'email' ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20' :
                          h.action === 'whatsapp' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                          h.action === 'sms' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' :
                          'bg-slate-700 text-slate-400'
                        }`}>
                          {h.action === 'call' && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
                          {h.action === 'email' && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                          {h.action === 'whatsapp' && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>}
                          {h.action === 'sms' && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>}
                          {!['call','email','whatsapp','sms'].includes(h.action) && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-200 capitalize">{h.action} — {h.outcome || 'recorded'}</span>
                            <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">
                              {h.timestamp || h.created_at ? new Date(h.timestamp || h.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Just now'}
                            </span>
                          </div>
                          {h.notes && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{h.notes}</p>}
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
              <div className="flex flex-col gap-4 flex-1">
                {/* 1-Click Fast Dispositions Panel */}
                <DispositionPanel
                  activeLead={selectedLead}
                  onDispositionComplete={(result) => {
                    setSelectedLead(null);
                    setLeadHistory([]);
                    fetchQueue();
                    fetchStats();
                  }}
                />

                <div className="border-t border-white/5 pt-3">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Detailed Custom Outcome</span>
                </div>

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
            </div>
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

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#121624] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Change Account Password</h3>
                  <p className="text-[11px] text-slate-400">Update your login password securely</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPwError('');
                  setPwSuccess('');
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"
              >
                ✕
              </button>
            </div>

            {pwError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl">
                {pwError}
              </div>
            )}

            {pwSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl">
                {pwSuccess}
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Current Password *</label>
                <input
                  type="password"
                  required
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">New Password *</label>
                <input
                  type="password"
                  required
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Enter new password (min 6 characters)"
                  className="w-full bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Confirm New Password *</label>
                <input
                  type="password"
                  required
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full bg-[#07090e] border border-white/10 focus:border-cyan-500 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl disabled:opacity-40 transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
                >
                  {pwSaving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dedicated Softphone Calling Modal */}
      <CallingModal
        isOpen={isCallingModalOpen}
        lead={selectedLead}
        callState={callState}
        duration={callDuration}
        isMuted={isMuted}
        errorMessage={callErrorMessage}
        onToggleMute={toggleMute}
        onSendDigits={handleSendDigits}
        onEndCall={endCall}
        onClose={() => setIsCallingModalOpen(false)}
        onOpenDisposition={() => {
          setIsCallingModalOpen(false);
          const outcomeSection = document.getElementById('log-outcome-section');
          if (outcomeSection) {
            outcomeSection.scrollIntoView({ behavior: 'smooth' });
          }
        }}
      />

    </div>
  );
}
