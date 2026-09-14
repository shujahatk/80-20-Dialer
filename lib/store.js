import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { isMongoConnected } from './db.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';

import User from '../models/User.js';
import Call from '../models/Call.js';
import Message from '../models/Message.js';
import Lead from '../models/Lead.js';
import Campaign from '../models/Campaign.js';
import ActivityLog from '../models/ActivityLog.js';
import EmailTemplate from '../models/EmailTemplate.js';
import LoginSession from '../models/LoginSession.js';
import SendingInbox from '../models/SendingInbox.js';
import EmailSequence from '../models/EmailSequence.js';
import WhatsAppTemplate from '../models/WhatsAppTemplate.js';
import SystemConfig from '../models/SystemConfig.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

let store = {
  users: [],
  calls: [],
  messages: [],
  contacts: [],
  leads: [],
  campaigns: [],
  blastCampaigns: [],
  activityLogs: [],
  emailTemplates: [],
  loginSessions: [],
  sendingInboxes: [],
  emailSequences: [],
  whatsappTemplates: [],
  systemConfigs: [],
  leadAssignments: [],
  aiEmailGenerations: [],
  aiUsageLogs: []
};

// Initialize folder on start
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {}

const loadStore = () => {
  if (isMongoConnected()) return;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      store = JSON.parse(raw);
      if (!store.users) store.users = [];
      if (!store.calls) store.calls = [];
      if (!store.messages) store.messages = [];
      if (!store.leads) store.leads = [];
      if (!store.campaigns) store.campaigns = [];
      if (!store.activityLogs) store.activityLogs = [];
      if (!store.emailTemplates) store.emailTemplates = [];
      if (!store.loginSessions) store.loginSessions = [];
      if (!store.sendingInboxes) store.sendingInboxes = [];
      if (!store.emailSequences) store.emailSequences = [];
      if (!store.whatsappTemplates) store.whatsappTemplates = [];
      if (!store.systemConfigs) store.systemConfigs = [];
      if (!store.blastCampaigns) store.blastCampaigns = [];
      if (!store.leadAssignments) store.leadAssignments = [];
      if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
      if (!store.aiUsageLogs) store.aiUsageLogs = [];

      if (store.whatsappTemplates.length === 0) {
        store.whatsappTemplates = [
          {
            _id: 'wa-tpl-intro',
            name: 'Quick Intro & Availability',
            category: 'intro',
            body: 'Hi {{first_name}}, this is {{sender_name}} regarding {{company}}. Wanted to see if you have a quick minute this week to connect? Here is my calendar if easier: {{booking_link}}',
            mergeFields: ['first_name', 'sender_name', 'company', 'booking_link'],
            createdAt: new Date().toISOString()
          },
          {
            _id: 'wa-tpl-followup',
            name: 'Call Follow-up & Booking Link',
            category: 'followup',
            body: 'Hi {{first_name}}, tried giving you a quick call earlier. Whenever you have 5 minutes, feel free to pick a time that works best for you here: {{booking_link}}',
            mergeFields: ['first_name', 'booking_link'],
            createdAt: new Date().toISOString()
          }
        ];
      }
    } else {
      saveStore();
    }
  } catch (err) {
    // serverless read-only disk - ignore
  }
};

// Initial store load
loadStore();

const saveStore = () => {
  if (isMongoConnected()) return;
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    // serverless read-only disk - ignore
  }
};

const generateId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

// --- User Operations ---
export const UserStore = {
  async findOne({ email }) {
    if (!email) return null;
    if (isSupabaseConfigured()) {
      try {
        const { data } = await getSupabaseClient().from('users').select('*').eq('email', email.toLowerCase()).maybeSingle();
        if (data) return { ...data, _id: data._id || data.id };
      } catch (e) {}
    }
    if (isMongoConnected()) {
      return await User.findOne({ email: email.toLowerCase() }).lean();
    }
    loadStore();
    const user = store.users.find(u => u.email === email.toLowerCase());
    return user ? { ...user } : null;
  },

  async findById(id) {
    if (!id) return null;
    const idStr = String(id).trim();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
        let res = null;

        if (isUuid) {
          res = await client.from('users').select('*').eq('id', idStr).maybeSingle();
          if (!res.data) {
            res = await client.from('users').select('*').eq('_id', idStr).maybeSingle();
          }
        } else {
          res = await client.from('users').select('*').eq('_id', idStr).maybeSingle();
          if (!res.data) {
            res = await client.from('users').select('*').eq('id', idStr).maybeSingle();
          }
        }

        if (res && res.data) {
          const { password, ...rest } = res.data;
          return {
            ...rest,
            _id: res.data._id || res.data.id,
            role: rest.role || 'salesperson',
            approved: rest.approved !== false,
            active: rest.active !== false
          };
        }
      } catch (e) {
        console.error('[Supabase] findById error:', e);
      }
    }
    if (isMongoConnected()) {
      try {
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(id)) {
          const user = await User.findById(id).lean();
          if (user) {
            const { password, ...rest } = user;
            if (!rest.role) rest.role = 'admin';
            if (rest.approved === undefined) rest.approved = true;
            if (rest.active === undefined) rest.active = true;
            return rest;
          }
        }
      } catch (e) {}
    }
    loadStore();
    const user = store.users.find(u => u._id === id || u._id?.toString() === id.toString() || u.id === id);
    if (!user) return null;
    const { password, ...userWithoutPassword } = user;
    if (!userWithoutPassword.role) userWithoutPassword.role = 'admin';
    if (userWithoutPassword.approved === undefined) userWithoutPassword.approved = true;
    if (userWithoutPassword.active === undefined) userWithoutPassword.active = true;
    return userWithoutPassword;
  },

  async findByIdWithPassword(id) {
    if (!id) return null;
    const idStr = String(id).trim();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
        let res = null;
        if (isUuid) {
          res = await client.from('users').select('*').eq('id', idStr).maybeSingle();
          if (!res?.data) res = await client.from('users').select('*').eq('_id', idStr).maybeSingle();
        } else {
          res = await client.from('users').select('*').eq('_id', idStr).maybeSingle();
          if (!res?.data) res = await client.from('users').select('*').eq('id', idStr).maybeSingle();
        }
        if (!res?.data && idStr.includes('@')) {
          res = await client.from('users').select('*').eq('email', idStr.toLowerCase()).maybeSingle();
        }
        if (res && res.data) return { ...res.data, _id: res.data._id || res.data.id };
      } catch (e) {}
    }
    if (isMongoConnected()) {
      try {
        const mongoose = require('mongoose');
        let user = null;
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          user = await User.findById(idStr).lean();
        }
        if (!user) {
          user = await User.findOne({ $or: [{ _id: idStr }, { email: idStr.toLowerCase() }] }).lean();
        }
        if (user) return user;
      } catch (e) {}
    }
    const user = store.users.find(u => (u._id || u.id)?.toString() === idStr || u.email?.toLowerCase() === idStr.toLowerCase());
    return user ? { ...user } : null;
  },

  async create({ name, email, password, role, approved, _id, id, tokenVersion }) {
    const now = new Date();
    const salt = await bcrypt.genSalt(10);
    const pwd = password || 'SecureTemporaryDefault123!';
    const hashedPassword = pwd.startsWith('$2a$') || pwd.startsWith('$2b$') ? pwd : await bcrypt.hash(pwd, salt);
    const userId = _id || id || generateId();

    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await getSupabaseClient().from('users').insert([{
          _id: userId,
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          role: role || 'salesperson',
          approved: approved !== undefined ? approved : false,
          active: true,
          last_active: now.toISOString(),
          last_login: now.toISOString(),
          created_at: now.toISOString()
        }]).select().single();
        if (data) {
          const { password: _, ...rest } = data;
          return { ...rest, _id: data._id || data.id };
        }
      } catch (e) { console.error('Supabase user insert error:', e); }
    }

    if (isMongoConnected()) {
      const user = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role || 'salesperson',
        approved: approved !== undefined ? approved : false,
        lastActive: now,
        lastLogin: now,
        createdAt: now
      });
      const { password: _, ...rest } = user.toObject();
      return rest;
    }

    const newUser = {
      _id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: role || 'salesperson',
      approved: approved !== undefined ? approved : false,
      lastActive: now.toISOString(),
      lastLogin: now.toISOString(),
      createdAt: now.toISOString()
    };
    store.users.push(newUser);
    saveStore();
    const { password: _, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  },

  async matchPassword(enteredPassword, hashedPassword) {
    return await bcrypt.compare(enteredPassword, hashedPassword);
  },

  async update(id, updateData) {
    const uId = String(id || '').trim();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        // Only send columns that exist in the Supabase users table
        const supabaseAllowedFields = ['name', 'email', 'password', 'role', 'approved', 'active', 'last_active', 'last_login', 'created_at'];
        const cleanPayload = {};
        for (const [k, v] of Object.entries(updateData)) {
          if (supabaseAllowedFields.includes(k) && v !== undefined) {
            cleanPayload[k] = v;
          }
        }

        if (Object.keys(cleanPayload).length > 0) {
          let query = client.from('users').update(cleanPayload);
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uId);
          if (uId.includes('@')) {
            query = query.eq('email', uId.toLowerCase());
          } else if (isUuid) {
            query = query.eq('id', uId);
          } else {
            query = query.eq('_id', uId);
          }
          const { data, error } = await query.select().maybeSingle();
          if (error) {
            console.error('[Supabase UserStore.update Error]:', error.message);
          } else if (data) {
            const memIdx = (store.users || []).findIndex(u => 
              (u._id || u.id)?.toString() === uId || 
              (u.email && data.email && u.email.toLowerCase() === data.email.toLowerCase())
            );
            if (memIdx !== -1) {
              store.users[memIdx] = { ...store.users[memIdx], ...updateData };
              saveStore();
            }
            return { ...data, _id: data._id || data.id };
          }
        }
      } catch (e) {
        console.warn('Supabase user update notice:', e.message);
      }
    }
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(uId, updateData, { new: true }).lean();
    }
    const idx = (store.users || []).findIndex(u => (u._id || u.id)?.toString() === uId || u.email?.toLowerCase() === uId.toLowerCase());
    if (idx === -1) return null;
    store.users[idx] = { ...store.users[idx], ...updateData };
    saveStore();
    return store.users[idx];
  },

  async delete(id) {
    const uId = String(id);
    if (isSupabaseConfigured()) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uId);
        let query = getSupabaseClient().from('users').delete();
        if (isUuid) query = query.eq('id', uId);
        else query = query.eq('_id', uId);
        await query;
      } catch (e) {}
    }
    if (isMongoConnected()) {
      await User.findByIdAndDelete(uId);
    }
    store.users = store.users.filter(u => (u._id || u.id)?.toString() !== uId);
    saveStore();
    return true;
  },

  async updateProfile(id, updateData) {
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password').lean();
    }
    const idx = store.users.findIndex(u => u._id === id);
    if (idx === -1) return null;
    store.users[idx] = { ...store.users[idx], ...updateData };
    saveStore();
    const { password: _, ...rest } = store.users[idx];
    return rest;
  },

  async updateLastActive(id) {
    const now = new Date();
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { lastActive: now }, { new: true }).select('-password').lean();
    }
    const idx = store.users.findIndex(u => u._id === id);
    if (idx === -1) return null;
    store.users[idx].lastActive = now.toISOString();
    saveStore();
    const { password: _, ...rest } = store.users[idx];
    return rest;
  },

  async updateLastLogin(id) {
    const now = new Date();
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { lastLogin: now, lastActive: now }, { new: true }).select('-password').lean();
    }
    const idx = store.users.findIndex(u => u._id === id);
    if (idx === -1) return null;
    store.users[idx].lastLogin = now.toISOString();
    store.users[idx].lastActive = now.toISOString();
    saveStore();
    const { password: _, ...rest } = store.users[idx];
    return rest;
  },

  async findPendingUsers() {
    if (isMongoConnected()) {
      return await User.find({ approved: false }).sort({ createdAt: -1 }).select('-password').lean();
    }
    return (store.users || [])
      .filter(u => u.approved === false)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(({ password, ...rest }) => rest);
  },

  async findAllUsers() {
    if (isSupabaseConfigured()) {
      try {
        const { data } = await getSupabaseClient().from('users').select('id, _id, name, email, role, approved, active, last_active, last_login, created_at').order('created_at', { ascending: false });
        if (data) return data.map(u => ({ ...u, _id: u._id || u.id }));
      } catch (e) {}
    }
    if (isMongoConnected()) {
      return await User.find().sort({ createdAt: -1 }).select('-password').lean();
    }
    return (store.users || [])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(({ password, ...rest }) => rest);
  },

  async findOnlineUsers() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (isSupabaseConfigured()) {
      try {
        const { data } = await getSupabaseClient().from('users').select('id, _id, name, email, role, approved, active, last_active, last_login').gte('last_active', fiveMinutesAgo.toISOString()).eq('approved', true).order('last_active', { ascending: false });
        if (data) return data.map(u => ({ ...u, _id: u._id || u.id }));
      } catch (e) {}
    }
    if (isMongoConnected()) {
      return await User.find({ lastActive: { $gte: fiveMinutesAgo }, approved: true })
        .sort({ lastActive: -1 })
        .select('-password')
        .lean();
    }
    return (store.users || [])
      .filter(u => u.approved && u.lastActive && new Date(u.lastActive) >= fiveMinutesAgo)
      .sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0))
      .map(({ password, ...rest }) => rest);
  },

  async approveUser(id) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(id).trim();
        const isEmail = idStr.includes('@');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);

        let res = null;
        if (isEmail) {
          res = await client.from('users').update({ approved: true, active: true }).eq('email', idStr.toLowerCase()).select();
        } else if (isUuid) {
          res = await client.from('users').update({ approved: true, active: true }).eq('id', idStr).select();
          if (!res.data || res.data.length === 0) {
            res = await client.from('users').update({ approved: true, active: true }).eq('_id', idStr).select();
          }
        } else {
          res = await client.from('users').update({ approved: true, active: true }).eq('_id', idStr).select();
        }

        if (res && res.data && res.data.length > 0) {
          const { password, ...rest } = res.data[0];
          return { ...rest, _id: res.data[0]._id || res.data[0].id };
        }
      } catch (e) {
        console.error('[Supabase] approveUser error:', e);
      }
    }
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { approved: true, active: true }, { new: true }).select('-password').lean();
    }
    const user = store.users.find(u => u._id === id || u._id?.toString() === id.toString() || u.email === id);
    if (!user) return null;
    user.approved = true;
    user.active = true;
    saveStore();
    const { password, ...rest } = user;
    return rest;
  },

  async rejectUser(id) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(id).trim();
        const isEmail = idStr.includes('@');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);

        let delRes;
        if (isEmail) {
          delRes = await client.from('users').delete().eq('email', idStr.toLowerCase()).select();
        } else if (isUuid) {
          delRes = await client.from('users').delete().eq('id', idStr).select();
          if (!delRes.data || delRes.data.length === 0) {
            delRes = await client.from('users').delete().eq('_id', idStr).select();
          }
        } else {
          delRes = await client.from('users').delete().eq('_id', idStr).select();
        }

        console.log(`[Supabase] Permanently erased user '${idStr}' from database.`);
        return true;
      } catch (e) {
        console.error('[Supabase rejectUser Error]:', e.message);
      }
    }
    if (isMongoConnected()) {
      await User.findByIdAndDelete(id);
      return true;
    }
    const initialLength = store.users.length;
    store.users = store.users.filter(u => u._id !== id && u.email !== id);
    const deleted = store.users.length < initialLength;
    if (deleted) saveStore();
    return deleted;
  },

  async updateRole(id, role) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(id).trim();
        const isEmail = idStr.includes('@');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);

        let res = null;
        if (isEmail) {
          res = await client.from('users').update({ role }).eq('email', idStr.toLowerCase()).select();
        } else if (isUuid) {
          res = await client.from('users').update({ role }).eq('id', idStr).select();
          if (!res.data || res.data.length === 0) {
            res = await client.from('users').update({ role }).eq('_id', idStr).select();
          }
        } else {
          res = await client.from('users').update({ role }).eq('_id', idStr).select();
        }

        if (res && res.data && res.data.length > 0) {
          const { password, ...rest } = res.data[0];
          return { ...rest, _id: res.data[0]._id || res.data[0].id };
        }
      } catch (e) {}
    }
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { role }, { new: true }).select('-password').lean();
    }
    const idx = store.users.findIndex(u => u._id === id || u.email === id);
    if (idx === -1) return null;
    store.users[idx].role = role;
    saveStore();
    const { password: _, ...rest } = store.users[idx];
    return rest;
  }
};

// --- Call Operations ---
export const CallStore = {
  async create({ userId, leadId, callSid, from, to, status, startTime, duration, recordingUrl, recordingSid, recordingDuration, notes, direction = 'outbound' }) {
    const now = new Date();
    const isoStart = startTime ? new Date(startTime).toISOString() : now.toISOString();

    const callPayload = {
      _id: 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      user_id: userId ? String(userId) : null,
      userId: userId ? String(userId) : null,
      lead_id: leadId ? String(leadId) : null,
      leadId: leadId ? String(leadId) : null,
      callSid: callSid || 'call_mock_' + Date.now(),
      call_sid: callSid || 'call_mock_' + Date.now(),
      twilio_call_sid: callSid || 'call_mock_' + Date.now(),
      from: from || 'Softphone WebRTC',
      from_number: from || 'Softphone WebRTC',
      to: to || 'Unknown',
      to_number: to || 'Unknown',
      direction: direction || 'outbound',
      status: status || 'queued',
      duration: parseInt(duration) || 0,
      recordingUrl: recordingUrl || null,
      recording_url: recordingUrl || null,
      recordingSid: recordingSid || null,
      recording_sid: recordingSid || null,
      recordingDuration: parseInt(recordingDuration) || 0,
      notes: notes || `Outbound Call ${from || ''} -> ${to || ''} (${duration || 0}s)`,
      startTime: isoStart,
      start_time: isoStart,
      started_at: isoStart,
      created_at: now.toISOString(),
      createdAt: now.toISOString()
    };

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data, error } = await client.from('calls').insert([{
          _id: callPayload._id,
          user_id: callPayload.user_id,
          lead_id: callPayload.lead_id,
          call_sid: callPayload.callSid,
          twilio_call_sid: callPayload.callSid,
          from_number: callPayload.from,
          to_number: callPayload.to,
          direction: callPayload.direction,
          status: callPayload.status,
          duration: callPayload.duration,
          notes: callPayload.notes,
          recording_url: callPayload.recording_url,
          recording_sid: callPayload.recording_sid,
          start_time: callPayload.start_time,
          started_at: callPayload.started_at,
          created_at: callPayload.created_at
        }]).select();

        if (data && data.length > 0) {
          return { ...callPayload, ...data[0], _id: data[0]._id || data[0].id };
        }
        if (error) console.warn('[Supabase CallStore.create Notice]:', error.message);
      } catch (e) {
        console.warn('[Supabase CallStore.create Exception]:', e.message);
      }
    }

    if (isMongoConnected()) {
      return await Call.create({ userId, callSid: callPayload.callSid, from, to, status: status || 'queued', startTime });
    }

    store.calls.unshift(callPayload);
    saveStore();
    return callPayload;
  },

  async findByUserId(userId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(userId);
        const { data: calls } = await client.from('calls')
          .select('*')
          .eq('user_id', idStr)
          .order('created_at', { ascending: false });

        if (calls && calls.length > 0) {
          return calls.map(c => ({
            ...c,
            _id: c._id || c.id,
            userId: c.user_id,
            leadId: c.lead_id,
            callSid: c.twilio_call_sid || c.call_sid || c.callSid,
            from: c.from_number || c.from,
            to: c.to_number || c.to,
            recordingUrl: c.recording_url,
            createdAt: c.created_at
          }));
        }
      } catch (e) {
        console.warn('[Supabase CallStore.findByUserId Error]:', e.message);
      }
    }

    if (isMongoConnected()) {
      return await Call.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return store.calls
      .filter(c => c.userId === userId.toString() || c.user_id === userId.toString())
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  async findOneAndUpdate(query, updateData) {
    const callSid = query.callSid || query.call_sid || query.twilio_call_sid;

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const supabaseUpdate = {};
        if (updateData.status) supabaseUpdate.status = updateData.status;
        if (updateData.duration !== undefined) supabaseUpdate.duration = updateData.duration;
        if (updateData.recordingUrl) supabaseUpdate.recording_url = updateData.recordingUrl;
        if (updateData.recordingSid) supabaseUpdate.recording_sid = updateData.recordingSid;
        if (updateData.recordingDuration !== undefined) supabaseUpdate.recording_duration = updateData.recordingDuration;
        if (updateData.notes) supabaseUpdate.notes = updateData.notes;
        if (updateData.errorCode) supabaseUpdate.error_code = String(updateData.errorCode);
        if (updateData.errorMessage) supabaseUpdate.error_message = updateData.errorMessage;
        if (updateData.endTime) {
          supabaseUpdate.end_time = new Date(updateData.endTime).toISOString();
          supabaseUpdate.ended_at = new Date(updateData.endTime).toISOString();
        }

        let dbQuery = client.from('calls').update(supabaseUpdate);
        if (callSid) {
          dbQuery = dbQuery.or(`call_sid.eq.${callSid},twilio_call_sid.eq.${callSid}`);
        } else if (query._id) {
          dbQuery = dbQuery.eq('_id', query._id);
        }

        const { data: updated, error } = await dbQuery.select();
        if (updated && updated.length > 0) {
          return { ...updated[0], _id: updated[0]._id || updated[0].id };
        }
      } catch (e) {
        console.warn('[Supabase CallStore.findOneAndUpdate Exception]:', e.message);
      }
    }

    if (isMongoConnected() && callSid) {
      return await Call.findOneAndUpdate({ callSid }, updateData, { new: true }).lean();
    }

    const callIndex = store.calls.findIndex(c => 
      (callSid && (c.callSid === callSid || c.twilio_call_sid === callSid || c.call_sid === callSid)) || 
      (query._id && c._id === query._id)
    );
    if (callIndex !== -1) {
      store.calls[callIndex] = {
        ...store.calls[callIndex],
        ...updateData,
        ...(updateData.endTime ? { endTime: new Date(updateData.endTime).toISOString() } : {})
      };
      saveStore();
      return store.calls[callIndex];
    }
    return null;
  }
};

// --- Message Operations ---
export const MessageStore = {
  async create({ userId, messageSid, from, to, body, status, channel = 'sms', direction = 'outbound', leadId, blastCampaignId, errorCode, errorMessage }) {
    const now = new Date().toISOString();
    const msgPayload = {
      _id: generateId(),
      userId: userId ? userId.toString() : null,
      user_id: userId ? userId.toString() : null,
      leadId: leadId ? leadId.toString() : null,
      lead_id: leadId ? leadId.toString() : null,
      messageSid: messageSid || `msg_${Date.now()}`,
      message_sid: messageSid || `msg_${Date.now()}`,
      twilio_message_sid: messageSid || `msg_${Date.now()}`,
      from: from || '',
      from_number: from || '',
      to: to || '',
      to_number: to || '',
      body: body || '',
      status: status || 'queued',
      channel: channel || 'sms',
      direction: direction || 'outbound',
      blastCampaignId: blastCampaignId ? blastCampaignId.toString() : null,
      errorCode: errorCode || null,
      errorMessage: errorMessage || null,
      created_at: now,
      createdAt: now,
      updated_at: now,
      updatedAt: now
    };

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data, error } = await client.from('messages').insert([{
          user_id: msgPayload.user_id,
          lead_id: msgPayload.lead_id,
          message_sid: msgPayload.messageSid,
          twilio_message_sid: msgPayload.messageSid,
          from_number: msgPayload.from,
          to_number: msgPayload.to,
          from_email: msgPayload.from || 'sms',
          to_email: msgPayload.to || 'sms',
          body: msgPayload.body,
          status: msgPayload.status,
          channel: msgPayload.channel,
          direction: msgPayload.direction,
          provider: 'twilio',
          created_at: now,
          updated_at: now
        }]).select();

        if (data && data.length > 0) {
          return { ...msgPayload, ...data[0], _id: data[0]._id || data[0].id };
        }
      } catch (e) {
        console.warn('[Supabase MessageStore.create Exception]:', e.message);
      }
    }

    if (isMongoConnected()) {
      return await Message.create({ userId, messageSid: msgPayload.messageSid, from, to, body, status: status || 'queued', channel, direction, leadId, blastCampaignId });
    }

    store.messages.unshift(msgPayload);
    saveStore();
    return msgPayload;
  },

  async findByUserId(userId) {
    if (isMongoConnected()) {
      return await Message.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return store.messages
      .filter(m => m.userId === userId.toString() || m.user_id === userId.toString())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findByCampaignId(campaignId) {
    if (isMongoConnected()) {
      return await Message.find({ blastCampaignId: campaignId }).sort({ createdAt: -1 }).lean();
    }
    return store.messages
      .filter(m => m.blastCampaignId?.toString() === campaignId.toString())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findOneAndUpdate(query, updateData) {
    const msgSid = query.messageSid || query.message_sid || query.twilio_message_sid;

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const updatePayload = { updated_at: new Date().toISOString() };
        if (updateData.status) updatePayload.status = updateData.status;
        if (updateData.errorCode) updatePayload.error_code = String(updateData.errorCode);
        if (updateData.errorMessage) updatePayload.error_message = updateData.errorMessage;

        let dbQuery = client.from('messages').update(updatePayload);
        if (msgSid) {
          dbQuery = dbQuery.or(`message_sid.eq.${msgSid},twilio_message_sid.eq.${msgSid}`);
        } else if (query._id || query.id) {
          dbQuery = dbQuery.eq('id', query._id || query.id);
        }

        const { data: updated } = await dbQuery.select();
        if (updated && updated.length > 0) {
          return { ...updated[0], _id: updated[0]._id || updated[0].id };
        }
      } catch (e) {
        console.warn('[Supabase MessageStore.findOneAndUpdate Exception]:', e.message);
      }
    }

    if (isMongoConnected() && msgSid) {
      return await Message.findOneAndUpdate({ messageSid: msgSid }, updateData, { new: true }).lean();
    }
    const idx = store.messages.findIndex(m => {
      if (msgSid && (m.messageSid === msgSid || m.message_sid === msgSid || m.twilio_message_sid === msgSid)) return true;
      if (query.to && m.to === query.to) return true;
      if (query._id && m._id === query._id) return true;
      return false;
    });
    if (idx === -1) return null;
    store.messages[idx] = { ...store.messages[idx], ...updateData, updatedAt: new Date().toISOString() };
    saveStore();
    return store.messages[idx];
  },

  async findLastByToPhone(toPhone) {
    if (isMongoConnected()) {
      return await Message.findOne({ to: toPhone, direction: 'outbound' }).sort({ createdAt: -1 }).lean();
    }
    return store.messages
      .filter(m => m.to === toPhone && m.direction === 'outbound')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }
};

// --- Lead Operations ---
export const LeadStore = {
  async create(data) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const customId = data._id || data.id || 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const assignedToVal = data.assignedTo || data.assigned_to || data.userId || null;
        
        const row = {
          _id: customId,
          name: data.contact?.name || data.name || 'N/A',
          email: data.contact?.email || data.email || null,
          phone: data.contact?.phone || data.phone || null,
          company: data.company?.name || data.company || null,
          city: data.geography?.city || data.city || null,
          country: data.geography?.country || data.country || null,
          status: data.status || 'new',
          assigned_to: assignedToVal ? String(assignedToVal) : null,
          priority: data.assignment?.priority || 0,
          created_at: new Date().toISOString()
        };

        const { data: inserted, error } = await client.from('leads').insert([row]).select().single();
        if (error) {
          console.error('[Supabase LeadStore.create Error]:', error.message);
        } else if (inserted) {
          const leadObj = { ...data, ...inserted, _id: inserted._id || inserted.id };
          const existingIdx = store.leads.findIndex(l => (l._id === leadObj._id || l.id === leadObj._id));
          if (existingIdx !== -1) store.leads[existingIdx] = leadObj;
          else store.leads.push(leadObj);
          saveStore();
          return leadObj;
        }
      } catch (err) {
        console.error('[Supabase LeadStore.create Exception]:', err.message);
      }
    }


    if (isMongoConnected()) {
      return await Lead.create(data);
    }
    loadStore();
    const lead = { _id: data._id || data.id || generateId(), ...data, createdAt: new Date().toISOString() };
    store.leads.push(lead);
    saveStore();
    return lead;
  },

  async createBulk(leads) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const rows = leads.map(data => ({
          _id: data._id || data.id || 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          name: data.contact?.name || data.name || 'N/A',
          email: data.contact?.email || data.email || null,
          phone: data.contact?.phone || data.phone || null,
          company: data.company?.name || data.company || null,
          city: data.geography?.city || data.city || null,
          country: data.geography?.country || data.country || null,
          status: data.status || 'new',
          assigned_to: (data.assignedTo || data.assigned_to || data.userId) ? String(data.assignedTo || data.assigned_to || data.userId) : null,
          priority: data.assignment?.priority || 0,
          created_at: new Date().toISOString()
        }));
        const { data: inserted, error } = await client.from('leads').insert(rows).select();
        if (error) {
          console.error('[Supabase LeadStore.createBulk Error]:', error.message);
        } else if (inserted) {
          const newLeads = rows.map((r, i) => ({ ...r, ...(leads[i] || {}) }));
          store.leads.push(...newLeads);
          saveStore();
          return inserted;
        }
      } catch (err) {
        console.error('[Supabase LeadStore.createBulk Error]:', err.message);
      }
    }

    if (isMongoConnected()) {
      return await Lead.insertMany(leads);
    }
    const newLeads = leads.map(l => ({ _id: generateId(), ...l, createdAt: new Date().toISOString() }));
    store.leads.push(...newLeads);
    saveStore();
    return newLeads;
  },

  async findAll() {
    let results = [];
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data: leads } = await client.from('leads').select('*').is('deleted_at', null).order('created_at', { ascending: false });
        if (leads && leads.length > 0) {
          results = leads.map(l => ({
            ...l,
            _id: l._id || l.id,
            stage: l.stage || l.status || 'NEW',
            status: l.status || l.stage || 'NEW',
            stage_updated_at: l.stage_updated_at || l.stageUpdatedAt || l.updated_at || l.created_at,
            last_activity_note: l.last_activity_note || l.lastActivityNote || '',
            name: l.name || l.contact?.name || 'N/A',
            email: l.email || l.contact?.email || '',
            phone: l.phone || l.contact?.phone || '',
            company: typeof l.company === 'string' ? l.company : (l.company?.name || 'N/A'),
            city: l.city || l.geography?.city || '',
            country: l.country || l.geography?.country || '',
            priority: l.priority || 0,
            contact: {
              name: l.name || l.contact?.name || 'N/A',
              email: l.email || l.contact?.email || '',
              phone: l.phone || l.contact?.phone || '',
              position: l.position || l.title || l.contact?.position || ''
            },
            companyObj: {
              name: typeof l.company === 'string' ? l.company : (l.company?.name || 'N/A'),
              niche: l.niche || l.industry || ''
            },
            geography: {
              city: l.city || l.geography?.city || '',
              country: l.country || l.geography?.country || ''
            },
            assignment: {
              priority: l.priority || 0
            },
            assignedTo: l.assigned_to,
            assigned_to: l.assigned_to
          }));
        }
      } catch (e) {
        console.warn('[LeadStore.findAll Supabase Error]:', e.message);
      }
    }


    if (results.length === 0 && isMongoConnected()) {
      return await Lead.find().sort({ createdAt: -1 }).lean();
    }

    loadStore();
    if (Array.isArray(store.leads) && store.leads.length > 0) {
      const existingIds = new Set(results.map(r => String(r._id || r.id)));
      for (const sl of store.leads) {
        const sId = String(sl._id || sl.id);
        if (!existingIds.has(sId)) {
          existingIds.add(sId);
          if (!sl.deleted_at) {
            results.push({
              ...sl,
              _id: sId,
              stage: sl.stage || 'new_lead',
              stage_updated_at: sl.stage_updated_at || sl.stageUpdatedAt || sl.createdAt || new Date().toISOString(),
              last_activity_note: sl.last_activity_note || sl.lastActivityNote || '',
              name: sl.name || sl.contact?.name || 'N/A',
              email: sl.email || sl.contact?.email || '',
              phone: sl.phone || sl.contact?.phone || '',
              company: typeof sl.company === 'string' ? sl.company : (sl.company?.name || 'N/A'),
              priority: sl.priority || sl.assignment?.priority || 0,
              contact: {
                name: sl.name || sl.contact?.name || 'N/A',
                email: sl.email || sl.contact?.email || '',
                phone: sl.phone || sl.contact?.phone || '',
                position: sl.position || sl.title || sl.contact?.position || ''
              },
              assignedTo: sl.assigned_to || sl.assignedTo || sl.userId,
              assigned_to: sl.assigned_to || sl.assignedTo || sl.userId
            });
          }
        }
      }
    }

    return results.filter(l => !l.deleted_at).sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
  },


  async findDeleted() {
    let results = [];
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data: leads } = await client.from('leads').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
        if (leads && leads.length > 0) {
          results = leads.map(l => ({
            ...l,
            _id: l._id || l.id,
            name: l.name || l.contact?.name || 'N/A',
            email: l.email || l.contact?.email || '',
            phone: l.phone || l.contact?.phone || '',
            company: typeof l.company === 'string' ? l.company : (l.company?.name || 'N/A'),
            contact: { name: l.name || 'N/A', email: l.email || '', phone: l.phone || '' },
            companyObj: { name: l.company || '' },
            deleted_at: l.deleted_at,
            deleted_by: l.deleted_by,
            deletion_reason: l.deletion_reason || 'Soft deleted by manager'
          }));
        }
      } catch (e) {
        console.warn('[LeadStore.findDeleted Supabase Error]:', e.message);
      }
    }

    loadStore();
    if (Array.isArray(store.leads) && store.leads.length > 0) {
      const existingIds = new Set(results.map(r => String(r._id || r.id)));
      const memDeleted = store.leads.filter(l => l.deleted_at && !existingIds.has(String(l._id || l.id)));
      results.push(...memDeleted);
    }

    return results.sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  },


  async findById(id) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(id);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
        let query = client.from('leads').select('*');
        if (isUuid) {
          query = query.eq('id', idStr);
        } else {
          const mem = (store.leads || []).find(x => x._id === idStr);
          if (mem && mem.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mem.id)) {
            query = query.eq('id', mem.id);
          } else {
            query = query.eq('_id', idStr);
          }
        }
        const { data: leads } = await query;
        if (leads && leads.length > 0) {
          const l = leads[0];
          return {
            ...l,
            _id: l._id || l.id,
            stage: l.stage || l.status || 'NEW',
            status: l.status || l.stage || 'NEW',
            stage_updated_at: l.stage_updated_at || l.stageUpdatedAt || l.updated_at || l.created_at,
            last_activity_note: l.last_activity_note || l.lastActivityNote || '',
            contact: {
              name: l.name || l.contact?.name || 'N/A',
              email: l.email || l.contact?.email || '',
              phone: l.phone || l.contact?.phone || '',
              position: l.position || l.title || l.contact?.position || ''
            },
            company: {
              name: l.company || l.company?.name || '—',
              niche: l.niche || l.industry || l.company?.niche || ''
            },
            geography: {
              city: l.city || l.geography?.city || '—',
              country: l.country || l.geography?.country || '—',
              timezone: l.timezone || l.geography?.timezone || 'UTC'
            },
            assignment: {
              priority: l.priority || l.assignment?.priority || 0
            },
            assignedTo: l.assigned_to || l.assignedTo,
            assigned_to: l.assigned_to || l.assignedTo
          };
        }
      } catch (e) {}
    }

    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await Lead.findById(id).lean();
    }
    loadStore();
    return store.leads.find(l => (l._id === id || l.id === id)) || null;
  },

  async findByUser(userId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const targetUser = await UserStore.findById(userId);
        const userIds = targetUser 
          ? Array.from(new Set([String(targetUser._id), String(targetUser.id), String(userId)].filter(Boolean)))
          : [String(userId)];

        const { data: leads } = await client.from('leads')
          .select('*')
          .in('assigned_to', userIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (leads) {
          return leads.map(l => ({
            ...l,
            _id: l._id || l.id,
            contact: { name: l.name, email: l.email, phone: l.phone, position: l.title },
            company: { name: l.company, niche: l.industry },
            assignedTo: l.assigned_to,
            assigned_to: l.assigned_to
          }));
        }
      } catch (e) {}
    }
    if (isMongoConnected()) return await Lead.find({ userId, deleted_at: null }).sort({ createdAt: -1 }).lean();
    return store.leads.filter(l => (l.userId === userId || l.assigned_to === userId) && !l.deleted_at).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findByCampaign(campaignId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data: leads } = await client.from('leads')
          .select('*')
          .eq('campaign_id', String(campaignId))
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (leads) {
          return leads.map(l => ({
            ...l,
            _id: l._id || l.id,
            contact: { name: l.name, email: l.email, phone: l.phone, position: l.title },
            company: { name: l.company, niche: l.industry },
            assignedTo: l.assigned_to,
            assigned_to: l.assigned_to
          }));
        }
      } catch (e) {}
    }
    if (isMongoConnected()) return await Lead.find({ campaignId, deleted_at: null }).sort({ createdAt: -1 }).lean();
    return store.leads.filter(l => l.campaignId === campaignId && !l.deleted_at);
  },

  async claimNextLead(userId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data: candidates } = await client.from('leads')
          .select('*')
          .or('assigned_to.is.null,assigned_to.eq.')
          .is('deleted_at', null)
          .eq('status', 'new')
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1);

        if (candidates && candidates.length > 0) {
          const target = candidates[0];
          const targetId = target.id || target._id;
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(targetId));
          
          let query = client.from('leads')
            .update({ assigned_to: String(userId) })
            .or('assigned_to.is.null,assigned_to.eq.');

          if (isUuid) {
            query = query.eq('id', targetId);
          } else {
            query = query.eq('_id', targetId);
          }

          const { data: claimed } = await query.select();

          if (claimed && claimed.length > 0) {
            const lead = claimed[0];
            try {
              await client.from('lead_assignments').insert([{
                lead_id: String(lead._id || lead.id),
                to_user: String(userId),
                assigned_by: String(userId),
                reason: 'salesperson_queue_claim'
              }]);
            } catch (e) {}
            return { ...lead, _id: lead._id || lead.id };
          }
        }
      } catch (e) {
        console.error('[Supabase] claimNextLead error:', e.message);
      }
    }

    const now = new Date();
    const lockExpiry = 5 * 60 * 1000;
    
    const candidates = store.leads.filter(l => {
      const isUnassigned = !l.userId && !l.assigned_to;
      const isNew = l.status === 'new';
      const isNotDeleted = !l.deleted_at;
      const isNotWorked = !l.currentlyBeingWorked || 
                          !l.currentlyBeingWorkedAt || 
                          (now - new Date(l.currentlyBeingWorkedAt)) >= lockExpiry ||
                          !l.currentlyBeingWorkedBy;
      return isUnassigned && isNew && isNotDeleted && isNotWorked;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const pA = a.assignment?.priority || 0;
      const pB = b.assignment?.priority || 0;
      if (pB !== pA) return pB - pA;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    const lead = candidates[0];
    lead.userId = userId;
    lead.assigned_to = userId;
    lead.currentlyBeingWorked = true;
    lead.currentlyBeingWorkedBy = userId;
    lead.currentlyBeingWorkedAt = now.toISOString();
    if (!lead.assignment) lead.assignment = {};
    lead.assignment.dateAssigned = now.toISOString();

    saveStore();
    return lead;
  },

  async findDailyQueue(userId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const targetUser = await UserStore.findById(userId);
        const userIds = targetUser 
          ? Array.from(new Set([String(targetUser._id), String(targetUser.id), String(userId)].filter(Boolean)))
          : [String(userId)];

        const { data: leads } = await client.from('leads')
          .select('*')
          .in('assigned_to', userIds)
          .is('deleted_at', null)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false });

        if (leads && leads.length > 0) {
          const mapped = leads.map(l => ({
            ...l,
            _id: l._id || l.id,
            contact: {
              name: l.name || l.contact?.name || 'N/A',
              email: l.email || l.contact?.email || '',
              phone: l.phone || l.contact?.phone || '',
              position: l.position || l.title || l.contact?.position || ''
            },
            company: {
              name: l.company || l.company?.name || '—',
              niche: l.niche || l.industry || l.company?.niche || ''
            },
            geography: {
              city: l.city || l.geography?.city || '—',
              country: l.country || l.geography?.country || '—',
              timezone: l.timezone || l.geography?.timezone || 'UTC'
            },
            assignment: {
              priority: l.priority || l.assignment?.priority || 0
            },
            assignedTo: l.assigned_to,
            assigned_to: l.assigned_to
          }));

          return {
            replies: mapped.filter(l => l.hasUnansweredReply),
            overdue: mapped.filter(l => l.status === 'callback' && l.callbackDate && new Date(l.callbackDate) < new Date()),
            dueToday: mapped.filter(l => l.status === 'callback' && l.callbackDate && new Date(l.callbackDate) >= new Date()),
            interested: mapped.filter(l => l.status === 'interested'),
            newLeads: mapped.filter(l => l.status === 'new' || l.status === 'assigned' || !l.status).slice(0, 50)
          };
        }
      } catch (e) {
        console.error('[Supabase findDailyQueue error]:', e.message);
      }
    }

    const userLeads = store.leads.filter(l => (l.userId === userId || l.assigned_to === userId) && !l.deleted_at);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);
    return {
      replies: userLeads.filter(l => l.hasUnansweredReply).sort((a, b) => new Date(b.lastReplyAt || 0) - new Date(a.lastReplyAt || 0)),
      overdue: userLeads.filter(l => l.status === 'callback' && l.callbackDate && new Date(l.callbackDate) < now),
      dueToday: userLeads.filter(l => l.status === 'callback' && l.callbackDate && new Date(l.callbackDate) >= today && new Date(l.callbackDate) <= endOfDay),
      interested: userLeads.filter(l => l.status === 'interested' && !l.coldOutreachStopped),
      newLeads: userLeads.filter(l => l.status === 'new').sort((a, b) => (b.assignment?.priority || 0) - (a.assignment?.priority || 0)).slice(0, 50)
    };
  },

  async acquireAtomicLock(leadId, userId) {
    const lockExpiryMs = 5 * 60 * 1000; // 5 minutes TTL
    const now = new Date();
    const nowIso = now.toISOString();
    const idStr = String(leadId).trim();
    const uIdStr = String(userId).trim();

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
        let query = client.from('leads').select('*');
        if (isUuid) query = query.eq('id', idStr);
        else query = query.eq('_id', idStr);
        const { data: leads } = await query;
        if (!leads || leads.length === 0) return { success: false, status: 404, message: 'Lead not found.' };

        const lead = leads[0];
        const lockHolder = lead.locked_by || lead.currently_being_worked_by || lead.currentlyBeingWorkedBy;
        const lockTime = lead.locked_at || lead.currently_being_worked_at || lead.currentlyBeingWorkedAt;

        if (
          lockHolder &&
          String(lockHolder) !== uIdStr &&
          lockTime &&
          (now - new Date(lockTime)) < lockExpiryMs
        ) {
          return {
            success: false,
            status: 423,
            message: 'This lead is currently being contacted by another agent.',
            lockedBy: lockHolder
          };
        }

        // Atomically acquire lock
        const patch = {
          locked_by: uIdStr,
          locked_at: nowIso,
          lock_heartbeat_at: nowIso,
          currently_being_worked: true,
          currently_being_worked_by: uIdStr,
          currently_being_worked_at: nowIso
        };

        let updateQuery = client.from('leads').update(patch);
        if (isUuid) updateQuery = updateQuery.eq('id', idStr);
        else updateQuery = updateQuery.eq('_id', idStr);
        const { data: updated } = await updateQuery.select();

        return { success: true, lead: updated ? updated[0] : lead };
      } catch (err) {
        console.error('[Supabase acquireAtomicLock Exception]:', err.message);
      }
    }

    const lead = store.leads.find(l => (l._id === idStr || l.id === idStr));
    if (!lead) return { success: false, status: 404, message: 'Lead not found.' };

    if (
      lead.currentlyBeingWorked &&
      lead.currentlyBeingWorkedBy &&
      String(lead.currentlyBeingWorkedBy) !== uIdStr &&
      lead.currentlyBeingWorkedAt &&
      (now - new Date(lead.currentlyBeingWorkedAt)) < lockExpiryMs
    ) {
      return {
        success: false,
        status: 423,
        message: 'This lead is currently being contacted by another agent.',
        lockedBy: lead.currentlyBeingWorkedBy
      };
    }

    lead.currentlyBeingWorked = true;
    lead.currentlyBeingWorkedBy = uIdStr;
    lead.currentlyBeingWorkedAt = nowIso;
    lead.locked_by = uIdStr;
    lead.locked_at = nowIso;
    lead.lock_heartbeat_at = nowIso;
    saveStore();

    return { success: true, lead };
  },

  async renewLockHeartbeat(leadId, userId) {
    const nowIso = new Date().toISOString();
    return await this.update(leadId, {
      locked_at: nowIso,
      lock_heartbeat_at: nowIso,
      currentlyBeingWorkedAt: nowIso,
      currently_being_worked_at: nowIso
    });
  },

  async releaseLock(leadId, userId = null, force = false) {
    const idStr = String(leadId).trim();
    const patch = {
      locked_by: null,
      locked_at: null,
      lock_heartbeat_at: null,
      currently_being_worked: false,
      currently_being_worked_by: null,
      currently_being_worked_at: null,
      currentlyBeingWorked: false,
      currentlyBeingWorkedBy: null,
      currentlyBeingWorkedAt: null
    };

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
        let query = client.from('leads').update(patch);
        if (isUuid) query = query.eq('id', idStr);
        else query = query.eq('_id', idStr);

        if (!force && userId) {
          query = query.eq('locked_by', String(userId));
        }
        await query;
        return true;
      } catch (e) {}
    }

    const lead = store.leads.find(l => (l._id === idStr || l.id === idStr));
    if (lead) {
      if (force || !userId || String(lead.currentlyBeingWorkedBy || lead.locked_by) === String(userId)) {
        Object.assign(lead, patch);
        saveStore();
        return true;
      }
    }
    return false;
  },

  async findPendingByPhone(phone) {
    if (!phone) return [];
    const cleanPhone = String(phone).trim();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data } = await client.from('leads').select('*').eq('phone', cleanPhone).is('deleted_at', null);
        if (data && data.length > 0) return data.map(d => ({ ...d, _id: d._id || d.id }));
      } catch (e) {}
    }
    return (store.leads || []).filter(l => (l.contact?.phone || l.phone) === cleanPhone && !l.deleted_at);
  },

  async findPendingByEmail(email) {
    if (!email) return [];
    const lowerEmail = email.toLowerCase().trim();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { data } = await client.from('leads').select('*').ilike('email', lowerEmail).is('deleted_at', null);
        if (data && data.length > 0) return data.map(d => ({ ...d, _id: d._id || d.id }));
      } catch (e) {}
    }
    return (store.leads || []).filter(l => (l.contact?.email || l.email)?.toLowerCase() === lowerEmail && !l.deleted_at);
  },

  async update(id, updateData) {
    const now = new Date().toISOString();
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const idStr = String(id);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);

        const patch = {};
        if (updateData.status) patch.status = updateData.status;
        if (updateData.stage) patch.stage = updateData.stage;
        if (updateData.stage_updated_at) patch.stage_updated_at = updateData.stage_updated_at;
        if (updateData.last_activity_note) patch.last_activity_note = updateData.last_activity_note;
        if (updateData.assignedTo !== undefined || updateData.assigned_to !== undefined) {
          patch.assigned_to = updateData.assignedTo || updateData.assigned_to || null;
        }
        if (updateData.contact?.name || updateData.name) patch.name = updateData.contact?.name || updateData.name;
        if (updateData.contact?.email || updateData.email) patch.email = updateData.contact?.email || updateData.email;
        if (updateData.contact?.phone || updateData.phone) patch.phone = updateData.contact?.phone || updateData.phone;
        if (updateData.company?.name || updateData.company) patch.company = updateData.company?.name || updateData.company;
        if (updateData.priority !== undefined) patch.priority = updateData.priority;
        if (updateData.deleted_at !== undefined) patch.deleted_at = updateData.deleted_at;
        if (updateData.deleted_by !== undefined) patch.deleted_by = updateData.deleted_by;
        let query = client.from('leads').update(patch);
        if (isUuid) {
          query = query.eq('id', idStr);
        } else {
          const mem = (store.leads || []).find(x => x._id === idStr);
          if (mem && mem.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mem.id)) {
            query = query.eq('id', mem.id);
          } else {
            query = query.eq('_id', idStr);
          }
        }

        let { data: updated, error } = await query.select();
        if (error) {
          if (error.message && (error.message.includes('stage') || error.message.includes('last_activity_note'))) {
            delete patch.stage;
            delete patch.stage_updated_at;
            delete patch.last_activity_note;
            let fallbackQuery = client.from('leads').update(patch);
            if (isUuid) fallbackQuery = fallbackQuery.eq('id', idStr);
            else fallbackQuery = fallbackQuery.eq('_id', idStr);
            const { data: fallbackUpdated } = await fallbackQuery.select();
            if (fallbackUpdated) updated = fallbackUpdated;
          }
        }
        if (updated && updated.length > 0) {
          const l = updated[0];
          const fullLead = {
            ...l,
            ...updateData,
            _id: l._id || l.id,
            stage: updateData.stage || l.stage || 'new_lead',
            stage_updated_at: updateData.stage_updated_at || l.stage_updated_at || now,
            last_activity_note: updateData.last_activity_note || l.last_activity_note || '',
            contact: { name: l.name, email: l.email, phone: l.phone },
            company: { name: l.company },
            assignedTo: l.assigned_to || updateData.assigned_to || updateData.assignedTo,
            assigned_to: l.assigned_to || updateData.assigned_to || updateData.assignedTo,
            deleted_at: updateData.deleted_at !== undefined ? updateData.deleted_at : (l.deleted_at || null),
            deleted_by: updateData.deleted_by !== undefined ? updateData.deleted_by : (l.deleted_by || null),
            deletion_reason: updateData.deletion_reason !== undefined ? updateData.deletion_reason : (l.deletion_reason || null)
          };
          if (Array.isArray(store.leads)) {
            store.leads.forEach(x => {
              if (x._id === id || x.id === id || x._id === l._id || x.id === l.id) {
                Object.assign(x, fullLead);
                // Unflatten dot-notation keys
                for (const [k, v] of Object.entries(updateData)) {
                  if (k.includes('.')) {
                    const parts = k.split('.');
                    let curr = x;
                    for (let i = 0; i < parts.length - 1; i++) {
                      curr[parts[i]] = curr[parts[i]] || {};
                      curr = curr[parts[i]];
                    }
                    curr[parts[parts.length - 1]] = v;
                  }
                }
              }
            });
            saveStore();
          }
          return fullLead;

        }
      } catch (e) {
        console.error('[Supabase LeadStore.update error]:', e.message);
      }
    }
    let matched = null;
    if (Array.isArray(store.leads)) {
      store.leads.forEach(l => {
        if (l._id === id || l.id === id) {
          Object.assign(l, updateData);
          // Unflatten dot-notation keys
          for (const [k, v] of Object.entries(updateData)) {
            if (k.includes('.')) {
              const parts = k.split('.');
              let curr = l;
              for (let i = 0; i < parts.length - 1; i++) {
                curr[parts[i]] = curr[parts[i]] || {};
                curr = curr[parts[i]];
              }
              curr[parts[parts.length - 1]] = v;
            }
          }
          matched = l;
        }
      });
      if (matched) saveStore();
    }
    return matched;

  },

  async updateStage(id, newStage, note = null) {
    const now = new Date().toISOString();
    const updatePayload = {
      stage: newStage,
      status: newStage,
      stage_updated_at: now,
      ...(note ? { last_activity_note: note, notes: note } : {})
    };

    return await this.update(id, updatePayload);
  },

  async findPipelineLeads(filterUserId = null) {
    let allLeads = [];
    if (filterUserId) {
      allLeads = await this.findByUser(filterUserId);
    } else {
      allLeads = await this.findAll();
    }

    return allLeads
      .filter(l => !l.deleted_at)
      .map(l => ({
        ...l,
        _id: l._id || l.id,
        stage: l.stage || l.status || 'NEW',
        status: l.status || l.stage || 'NEW',
        stage_updated_at: l.stage_updated_at || l.updated_at || l.created_at || new Date().toISOString(),
        last_activity_note: l.last_activity_note || l.notes || ''
      }))
      .sort((a, b) => new Date(b.stage_updated_at || 0) - new Date(a.stage_updated_at || 0));
  },

  // --- Safe Lead Deletion (Phase 2) ---

  async softDelete(id, userId = null, reason = 'Deleted by user') {
    const nowIso = new Date().toISOString();
    await this.releaseLock(id, null, true);

    const updated = await this.update(id, {
      deleted_at: nowIso,
      deleted_by: userId ? String(userId) : null,
      deletion_reason: reason
    });

    return Boolean(updated);
  },

  async softDeleteBulk(ids, userId = null, reason = 'Bulk deleted by user') {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const nowIso = new Date().toISOString();
    let count = 0;

    for (const id of ids) {
      const res = await this.softDelete(id, userId, reason);
      if (res) count++;
    }
    return count;
  },

  async restore(id) {
    const updated = await this.update(id, {
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null
    });
    return Boolean(updated);
  },

  async purgePermanent(id) {
    if (!id) return false;
    const idStr = String(id).trim();
    let deleted = false;

    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        let query = client.from('leads').delete();
        if (isUuid) {
          query = query.eq('id', idStr);
        } else {
          const mem = (store.leads || []).find(x => x._id === idStr);
          if (mem && mem.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mem.id)) {
            query = query.eq('id', mem.id);
          } else {
            query = query.eq('_id', idStr);
          }
        }

        const { data, error } = await query.select();
        if (!error && data && data.length > 0) deleted = true;

        try {
          await client.from('lead_assignments').delete().eq('lead_id', idStr);
        } catch (e) {}
      } catch (e) {
        console.error('[Supabase LeadStore.purgePermanent error]:', e.message);
      }
    }

    if (isMongoConnected()) {
      try {
        const mongoose = require('mongoose');
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          const res = await Lead.findByIdAndDelete(idStr);
          if (res) deleted = true;
        }
      } catch (e) {}
    }

    const initialLen = (store.leads || []).length;
    store.leads = (store.leads || []).filter(l => (l._id || l.id)?.toString() !== idStr);
    if (store.leads.length < initialLen) deleted = true;
    if (Array.isArray(store.leadAssignments)) {
      store.leadAssignments = store.leadAssignments.filter(a => String(a.leadId || a.lead_id) !== idStr);
    }
    saveStore();

    return deleted;
  },

  async purgeBulk(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    let purged = 0;
    for (const id of ids) {
      const res = await this.purgePermanent(id);
      if (res) purged++;
    }
    return purged;
  },

  // Legacy delete delegates to softDelete for safe lifecycle
  async delete(id, userId = null, reason = 'Deleted by user') {
    return await this.softDelete(id, userId, reason);
  },

  async deleteBulk(ids, userId = null, reason = 'Bulk deleted by user') {
    return await this.softDeleteBulk(ids, userId, reason);
  },

  async countByUser(userId) {
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const { count } = await client.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', String(userId));
        return count || 0;
      } catch (e) {}
    }
    return store.leads.filter(l => l.userId === userId).length;
  },

  async getManagerMetrics(userId) {
    if (isMongoConnected()) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const total = await Lead.countDocuments({ userId });
      const contacted = await Lead.countDocuments({ userId, status: { $ne: 'new' } });
      const interested = await Lead.countDocuments({ userId, status: 'interested' });
      const booked = await Lead.countDocuments({ userId, status: 'meeting-booked' });
      const callbacksOverdue = await Lead.countDocuments({ userId, status: 'callback', callbackDate: { $lt: now } });
      const untouched = await Lead.countDocuments({ userId, status: 'new' });
      return { total, contacted, interested, booked, callbacksOverdue, untouched };
    }
    const leads = store.leads.filter(l => l.userId === userId);
    const now = new Date();
    return {
      total: leads.length,
      contacted: leads.filter(l => l.status !== 'new').length,
      interested: leads.filter(l => l.status === 'interested').length,
      booked: leads.filter(l => l.status === 'meeting-booked').length,
      callbacksOverdue: leads.filter(l => l.status === 'callback' && l.callbackDate && new Date(l.callbackDate) < now).length,
      untouched: leads.filter(l => l.status === 'new').length
    };
  }
};

// --- Campaign Operations ---
export const CampaignStore = {
  async create(data) {
    if (isMongoConnected()) return await Campaign.create(data);
    const campaign = { _id: generateId(), ...data, totalLeads: 0, createdAt: new Date().toISOString() };
    store.campaigns.push(campaign);
    saveStore();
    return campaign;
  },

  async findAll() {
    if (isMongoConnected()) return await Campaign.find().sort({ createdAt: -1 }).lean();
    return store.campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findById(id) {
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await Campaign.findById(id).lean();
    }
    return store.campaigns.find(c => c._id === id) || null;
  },

  async update(id, data) {
    if (isMongoConnected()) return await Campaign.findByIdAndUpdate(id, data, { new: true }).lean();
    const idx = store.campaigns.findIndex(c => c._id === id);
    if (idx === -1) return null;
    store.campaigns[idx] = { ...store.campaigns[idx], ...data };
    saveStore();
    return store.campaigns[idx];
  },

  async delete(id) {
    if (isMongoConnected()) { await Campaign.findByIdAndDelete(id); return true; }
    const len = store.campaigns.length;
    store.campaigns = store.campaigns.filter(c => c._id !== id);
    if (store.campaigns.length < len) { saveStore(); return true; }
    return false;
  }
};

// --- ActivityLog Operations ---
export const ActivityLogStore = {
  async create(data) {
    if (isMongoConnected()) return await ActivityLog.create(data);
    const log = { _id: generateId(), ...data, timestamp: new Date().toISOString() };
    store.activityLogs.unshift(log);
    saveStore();
    return log;
  },

  async findByLead(leadId) {
    if (isMongoConnected()) return await ActivityLog.find({ leadId }).sort({ timestamp: -1 }).lean();
    return store.activityLogs.filter(l => l.leadId === leadId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  async findByUser(userId, limit = 100) {
    if (isMongoConnected()) return await ActivityLog.find({ userId }).sort({ timestamp: -1 }).limit(limit).lean();
    return store.activityLogs.filter(l => l.userId === userId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  },

  async getUserStats(userId) {
    if (isMongoConnected()) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const calls = await ActivityLog.countDocuments({ userId, action: 'call', timestamp: { $gte: today } });
      const emails = await ActivityLog.countDocuments({ userId, action: 'email', timestamp: { $gte: today } });
      const smss = await ActivityLog.countDocuments({ userId, action: 'sms', channel: { $ne: 'whatsapp' }, timestamp: { $gte: today } });
      const whatsapp = await ActivityLog.countDocuments({ userId, action: 'sms', channel: 'whatsapp', timestamp: { $gte: today } });
      const notes = await ActivityLog.countDocuments({ userId, action: 'note', timestamp: { $gte: today } });

      const mongoose = require('mongoose');
      let targetUserId = userId;
      if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
        targetUserId = new mongoose.Types.ObjectId(userId);
      } else if (userId && typeof userId.toString === 'function' && mongoose.Types.ObjectId.isValid(userId.toString())) {
        targetUserId = new mongoose.Types.ObjectId(userId.toString());
      }

      const totalTalkTime = await ActivityLog.aggregate([
        { $match: { userId: targetUserId, action: 'call', timestamp: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$duration' } } }
      ]);
      return { callsToday: calls, emailsToday: emails, smsToday: smss, whatsappToday: whatsapp, notesToday: notes, talkTimeToday: totalTalkTime[0]?.total || 0 };
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const userLogs = store.activityLogs.filter(l => l.userId === userId && new Date(l.timestamp) >= today);
    return {
      callsToday: userLogs.filter(l => l.action === 'call').length,
      emailsToday: userLogs.filter(l => l.action === 'email').length,
      smsToday: userLogs.filter(l => l.action === 'sms' && l.channel !== 'whatsapp').length,
      whatsappToday: userLogs.filter(l => l.action === 'sms' && l.channel === 'whatsapp').length,
      notesToday: userLogs.filter(l => l.action === 'note').length,
      talkTimeToday: userLogs.filter(l => l.action === 'call').reduce((sum, l) => sum + (l.duration || 0), 0)
    };
  }
};

// --- EmailTemplate Operations ---
export const EmailTemplateStore = {
  async create(data) {
    if (isMongoConnected()) return await EmailTemplate.create(data);
    const tpl = { _id: generateId(), ...data, createdAt: new Date().toISOString() };
    store.emailTemplates.push(tpl);
    saveStore();
    return tpl;
  },
  async findAll() {
    if (isMongoConnected()) return await EmailTemplate.find({ active: true }).sort({ createdAt: -1 }).lean();
    return store.emailTemplates.filter(t => t.active !== false);
  },
  async findById(id) {
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await EmailTemplate.findById(id).lean();
    }
    return store.emailTemplates.find(t => t._id === id) || null;
  },
  async update(id, data) {
    if (isMongoConnected()) return await EmailTemplate.findByIdAndUpdate(id, data, { new: true }).lean();
    const idx = store.emailTemplates.findIndex(t => t._id === id);
    if (idx === -1) return null;
    store.emailTemplates[idx] = { ...store.emailTemplates[idx], ...data };
    saveStore();
    return store.emailTemplates[idx];
  },
  async delete(id) {
    if (isMongoConnected()) { await EmailTemplate.findByIdAndDelete(id); return true; }
    const len = store.emailTemplates.length;
    store.emailTemplates = store.emailTemplates.filter(t => t._id !== id);
    if (store.emailTemplates.length < len) { saveStore(); return true; }
    return false;
  }
};

// --- LoginSession Operations ---
export const LoginSessionStore = {
  async create(data) {
    if (isMongoConnected()) return await LoginSession.create(data);
    const session = { _id: generateId(), ...data, loginAt: new Date().toISOString() };
    store.loginSessions.push(session);
    saveStore();
    return session;
  },
  async findToday(userId) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) return await LoginSession.findOne({ userId, date: today }).lean();
    return store.loginSessions.find(s => s.userId === userId && s.date === today) || null;
  },
  async updateSession(id, data) {
    if (isMongoConnected()) return await LoginSession.findByIdAndUpdate(id, data, { new: true }).lean();
    const idx = store.loginSessions.findIndex(s => s._id === id);
    if (idx === -1) return null;
    store.loginSessions[idx] = { ...store.loginSessions[idx], ...data };
    saveStore();
    return store.loginSessions[idx];
  },
  async toggleBreak(userId) {
    const today = new Date().toISOString().slice(0, 10);
    let session;
    const now = new Date();
    if (isMongoConnected()) {
      session = await LoginSession.findOne({ userId, date: today });
      if (!session) {
        session = await LoginSession.create({ userId, date: today });
      }
      if (session.isOnBreak) {
        const breakStart = session.breakStartedAt ? new Date(session.breakStartedAt) : now;
        const elapsed = Math.floor((now - breakStart) / 1000);
        session.breakTimeSeconds = (session.breakTimeSeconds || 0) + elapsed;
        session.isOnBreak = false;
        session.breakStartedAt = null;
        session.lastActivityAt = now;
      } else {
        session.isOnBreak = true;
        session.breakStartedAt = now;
      }
      await session.save();
      return session.toObject();
    }
    session = await this.findToday(userId);
    if (!session) {
      session = await this.create({ userId, date: today, breakTimeSeconds: 0, isOnBreak: false });
    }
    if (session.isOnBreak) {
      const breakStart = session.breakStartedAt ? new Date(session.breakStartedAt) : now;
      const elapsed = Math.floor((now - breakStart) / 1000);
      session.breakTimeSeconds = (session.breakTimeSeconds || 0) + elapsed;
      session.isOnBreak = false;
      session.breakStartedAt = null;
      session.lastActivityAt = now.toISOString();
    } else {
      session.isOnBreak = true;
      session.breakStartedAt = now.toISOString();
    }
    await this.updateSession(session._id, session);
    return session;
  },
  async getUserStats(userId) {
    const today = new Date().toISOString().slice(0, 10);
    let session;
    if (isMongoConnected()) {
      session = await LoginSession.findOne({ userId, date: today }).lean();
    } else {
      session = await this.findToday(userId);
    }
    let breakTime = session?.breakTimeSeconds || 0;
    if (session?.isOnBreak && session?.breakStartedAt) {
      breakTime += Math.floor((Date.now() - new Date(session.breakStartedAt).getTime()) / 1000);
    }
    return {
      activeTimeSeconds: session?.activeTimeSeconds || 0,
      dialingTimeSeconds: session?.dialingTimeSeconds || 0,
      breakTimeSeconds: breakTime,
      isOnBreak: !!session?.isOnBreak
    };
  }
};

// --- SendingInbox Operations ---
export const SendingInboxStore = {
  async createInbox(data) {
    if (isMongoConnected()) {
      return await SendingInbox.create(data);
    }
    if (!store.sendingInboxes) store.sendingInboxes = [];
    const newInbox = {
      _id: generateId(),
      name: data.name || 'Default Inbox',
      fromEmail: data.fromEmail || '',
      fromName: data.fromName || '',
      dailyLimit: data.dailyLimit || 50,
      status: 'healthy',
      active: true,
      createdBy: data.createdBy,
      dailyCounters: [],
      createdAt: new Date().toISOString()
    };
    store.sendingInboxes.push(newInbox);
    saveStore();
    return newInbox;
  },

  async findAllInboxes() {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      const inboxes = await SendingInbox.find({ active: { $ne: false } }).lean();
      return inboxes.map(inbox => {
        const counter = (inbox.dailyCounters || []).find(c => c.date === today);
        return {
          ...inbox,
          emailsSentToday: counter ? counter.emailsSent : 0
        };
      });
    }
    if (!store.sendingInboxes) store.sendingInboxes = [];
    return store.sendingInboxes.filter(i => i.active !== false).map(inbox => {
      const counter = (inbox.dailyCounters || []).find(c => c.date === today);
      return {
        ...inbox,
        emailsSentToday: counter ? counter.emailsSent : 0
      };
    });
  },

  async findInboxById(id) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      const inbox = await SendingInbox.findById(id).lean();
      if (!inbox) return null;
      const counter = (inbox.dailyCounters || []).find(c => c.date === today);
      return {
        ...inbox,
        emailsSentToday: counter ? counter.emailsSent : 0
      };
    }
    if (!store.sendingInboxes) return null;
    const inbox = store.sendingInboxes.find(i => i._id === id);
    if (!inbox) return null;
    const counter = (inbox.dailyCounters || []).find(c => c.date === today);
    return {
      ...inbox,
      emailsSentToday: counter ? counter.emailsSent : 0
    };
  },

  async updateInbox(id, data) {
    if (isMongoConnected()) {
      return await SendingInbox.findByIdAndUpdate(id, data, { new: true }).lean();
    }
    if (!store.sendingInboxes) return null;
    const idx = store.sendingInboxes.findIndex(i => i._id === id);
    if (idx === -1) return null;
    store.sendingInboxes[idx] = { ...store.sendingInboxes[idx], ...data };
    saveStore();
    return store.sendingInboxes[idx];
  },

  async deleteInbox(id) {
    if (isMongoConnected()) {
      await SendingInbox.findByIdAndUpdate(id, { active: false });
      return true;
    }
    if (!store.sendingInboxes) return false;
    const idx = store.sendingInboxes.findIndex(i => i._id === id);
    if (idx === -1) return false;
    store.sendingInboxes[idx].active = false;
    saveStore();
    return true;
  },

  async incrementInboxUsage(inboxId) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      const inbox = await SendingInbox.findById(inboxId);
      if (!inbox) return null;
      if (!inbox.dailyCounters) inbox.dailyCounters = [];
      const counterIdx = inbox.dailyCounters.findIndex(c => c.date === today);
      if (counterIdx !== -1) {
        inbox.dailyCounters[counterIdx].emailsSent += 1;
      } else {
        inbox.dailyCounters.push({ date: today, emailsSent: 1 });
      }
      await inbox.save();
      return inbox.toObject();
    }
    if (!store.sendingInboxes) return null;
    const inbox = store.sendingInboxes.find(i => i._id === inboxId);
    if (!inbox) return null;
    if (!inbox.dailyCounters) inbox.dailyCounters = [];
    const counterIdx = inbox.dailyCounters.findIndex(c => c.date === today);
    if (counterIdx !== -1) {
      inbox.dailyCounters[counterIdx].emailsSent += 1;
    } else {
      inbox.dailyCounters.push({ date: today, emailsSent: 1 });
    }
    saveStore();
    return inbox;
  },

  // Backwards compatibility methods
  async getToday(userId) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      let inbox = await SendingInbox.findOne({ userId, date: today }).lean();
      if (!inbox) {
        inbox = await SendingInbox.create({ userId, date: today, emailsSent: 0, smsSent: 0, callsMade: 0, status: 'healthy' });
        return inbox.toObject ? inbox.toObject() : inbox;
      }
      return inbox;
    }
    if (!store.sendingInboxes) store.sendingInboxes = [];
    let inbox = store.sendingInboxes.find(i => i.userId === userId && i.date === today);
    if (!inbox) {
      inbox = { _id: generateId(), userId, date: today, emailsSent: 0, smsSent: 0, callsMade: 0, status: 'healthy' };
      store.sendingInboxes.push(inbox);
      saveStore();
    }
    return inbox;
  },

  async incrementEmail(userId) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      return await SendingInbox.findOneAndUpdate(
        { userId, date: today },
        { $inc: { emailsSent: 1 }, $setOnInsert: { status: 'healthy' } },
        { upsert: true, new: true }
      ).lean();
    }
    const inbox = await this.getToday(userId);
    inbox.emailsSent = (inbox.emailsSent || 0) + 1;
    saveStore();
    return inbox;
  },

  async incrementCalls(userId) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      return await SendingInbox.findOneAndUpdate(
        { userId, date: today },
        { $inc: { callsMade: 1 }, $setOnInsert: { status: 'healthy' } },
        { upsert: true, new: true }
      ).lean();
    }
    const inbox = await this.getToday(userId);
    inbox.callsMade = (inbox.callsMade || 0) + 1;
    saveStore();
    return inbox;
  },

  async setStatus(userId, status) {
    const today = new Date().toISOString().slice(0, 10);
    if (isMongoConnected()) {
      return await SendingInbox.findOneAndUpdate({ userId, date: today }, { status }, { new: true }).lean();
    }
    const inbox = await this.getToday(userId);
    inbox.status = status;
    saveStore();
    return inbox;
  }
};

// --- EmailSequence Operations ---
export const EmailSequenceStore = {
  async create(data) {
    if (isMongoConnected()) return await EmailSequence.create(data);
    const seq = { _id: generateId(), ...data, createdAt: new Date().toISOString() };
    store.emailSequences.push(seq);
    saveStore();
    return seq;
  },
  async findAll() {
    if (isMongoConnected()) return await EmailSequence.find({ active: true }).sort({ createdAt: -1 }).lean();
    return store.emailSequences.filter(s => s.active !== false);
  },
  async findById(id) {
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await EmailSequence.findById(id).lean();
    }
    return store.emailSequences.find(s => s._id === id) || null;
  },
  async update(id, data) {
    if (isMongoConnected()) return await EmailSequence.findByIdAndUpdate(id, data, { new: true }).lean();
    const idx = store.emailSequences.findIndex(s => s._id === id);
    if (idx === -1) return null;
    store.emailSequences[idx] = { ...store.emailSequences[idx], ...data };
    saveStore();
    return store.emailSequences[idx];
  },
  async delete(id) {
    if (isMongoConnected()) { await EmailSequence.findByIdAndDelete(id); return true; }
    const len = store.emailSequences.length;
    store.emailSequences = store.emailSequences.filter(s => s._id !== id);
    if (store.emailSequences.length < len) { saveStore(); return true; }
    return false;
  }
};

// --- WhatsAppTemplate Operations ---
export const WhatsAppTemplateStore = {
  async create(data) {
    if (isMongoConnected()) return await WhatsAppTemplate.create(data);
    const tpl = { _id: generateId(), ...data, createdAt: new Date().toISOString() };
    store.whatsappTemplates.push(tpl);
    saveStore();
    return tpl;
  },
  async findAll() {
    if (isMongoConnected()) return await WhatsAppTemplate.find({ active: true }).sort({ createdAt: -1 }).lean();
    return store.whatsappTemplates.filter(t => t.active !== false);
  },
  async findById(id) {
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await WhatsAppTemplate.findById(id).lean();
    }
    return store.whatsappTemplates.find(t => t._id === id) || null;
  },
  async update(id, data) {
    if (isMongoConnected()) return await WhatsAppTemplate.findByIdAndUpdate(id, data, { new: true }).lean();
    const idx = store.whatsappTemplates.findIndex(t => t._id === id);
    if (idx === -1) return null;
    store.whatsappTemplates[idx] = { ...store.whatsappTemplates[idx], ...data };
    saveStore();
    return store.whatsappTemplates[idx];
  },
  async delete(id) {
    if (isMongoConnected()) { await WhatsAppTemplate.findByIdAndDelete(id); return true; }
    const len = store.whatsappTemplates.length;
    store.whatsappTemplates = store.whatsappTemplates.filter(t => t._id !== id);
    if (store.whatsappTemplates.length < len) { saveStore(); return true; }
    return false;
  }
};

// --- SystemConfig Operations ---
export const SystemConfigStore = {
  async getConfig() {
    if (isMongoConnected()) {
      let config = await SystemConfig.findOne({ key: 'main_config' });
      if (!config) {
        config = await SystemConfig.create({ key: 'main_config' });
      }
      return config.toObject ? config.toObject() : config;
    }
    if (!store.systemConfigs) store.systemConfigs = [];
    let config = store.systemConfigs.find(c => c.key === 'main_config');
    if (!config) {
      config = {
        _id: generateId(),
        key: 'main_config',
        callRecordingEnabled: false,
        allowedHoursStart: 8,
        allowedHoursEnd: 18,
        crmWebhookUrl: '',
        updatedAt: new Date().toISOString()
      };
      store.systemConfigs.push(config);
      saveStore();
    }
    return config;
  },

  async updateConfig(data) {
    if (isMongoConnected()) {
      return await SystemConfig.findOneAndUpdate(
        { key: 'main_config' },
        { ...data, updatedAt: new Date() },
        { new: true, upsert: true }
      ).lean();
    }
    const config = await this.getConfig();
    const idx = store.systemConfigs.findIndex(c => c.key === 'main_config');
    if (idx !== -1) {
      store.systemConfigs[idx] = { ...config, ...data, updatedAt: new Date().toISOString() };
      saveStore();
      return store.systemConfigs[idx];
    }
    return config;
  }
};

// --- BlastCampaign Operations ---
export const BlastCampaignStore = {
  async create(data) {
    if (isMongoConnected()) {
      const BlastCampaign = require('../models/BlastCampaign').default || require('../models/BlastCampaign');
      return await BlastCampaign.create(data);
    }
    if (!store.blastCampaigns) store.blastCampaigns = [];
    const campaign = {
      _id: generateId(),
      ...data,
      status: data.status || 'draft',
      stats: {
        total: data.stats?.total || 0,
        sent: data.stats?.sent || 0,
        failed: data.stats?.failed || 0,
        skipped: data.stats?.skipped || 0,
      },
      createdAt: new Date().toISOString()
    };
    store.blastCampaigns.push(campaign);
    saveStore();
    return campaign;
  },

  async findAll() {
    if (isMongoConnected()) {
      const BlastCampaign = require('../models/BlastCampaign').default || require('../models/BlastCampaign');
      return await BlastCampaign.find().sort({ createdAt: -1 }).lean();
    }
    if (!store.blastCampaigns) store.blastCampaigns = [];
    return store.blastCampaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findById(id) {
    if (!id) return null;
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(id)) {
        const BlastCampaign = require('../models/BlastCampaign').default || require('../models/BlastCampaign');
        const camp = await BlastCampaign.findById(id).lean();
        if (camp) return camp;
      }
    }
    if (!store.blastCampaigns) store.blastCampaigns = [];
    return store.blastCampaigns.find(c => c._id?.toString() === id?.toString()) || null;
  },

  async update(id, data) {
    if (!id) return null;
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(id)) {
        const BlastCampaign = require('../models/BlastCampaign').default || require('../models/BlastCampaign');
        const updated = await BlastCampaign.findByIdAndUpdate(id, data, { new: true }).lean();
        if (updated) return updated;
      }
    }
    if (!store.blastCampaigns) store.blastCampaigns = [];
    const idx = store.blastCampaigns.findIndex(c => c._id?.toString() === id?.toString());
    if (idx === -1) return null;
    store.blastCampaigns[idx] = { ...store.blastCampaigns[idx], ...data };
    saveStore();
    return store.blastCampaigns[idx];
  },

  async delete(id) {
    if (isMongoConnected()) {
      const BlastCampaign = require('../models/BlastCampaign').default || require('../models/BlastCampaign');
      await BlastCampaign.findByIdAndDelete(id);
      return true;
    }
    if (!store.blastCampaigns) store.blastCampaigns = [];
    const len = store.blastCampaigns.length;
    store.blastCampaigns = store.blastCampaigns.filter(c => c._id !== id);
    if (store.blastCampaigns.length < len) { saveStore(); return true; }
    return false;
  }
};

// --- AI Email Personalization Drafts Store ---
export const AiEmailGenerationStore = {
  async create(data) {
    const item = {
      _id: data._id || generateId(),
      userId: data.userId ? String(data.userId) : null,
      leadId: data.leadId ? String(data.leadId) : null,
      campaignId: data.campaignId ? String(data.campaignId) : null,
      subject: data.subject || '',
      body: data.body || '',
      model: data.model || 'claude-3-5-sonnet',
      status: data.status || 'generated', // pending, generating, generated, approved, skipped, generation_failed
      generationInstruction: data.generationInstruction || '',
      customInstruction: data.customInstruction || '',
      goal: data.goal || 'Cold outreach',
      tone: data.tone || 'Professional',
      length: data.length || 'Short',
      tokens: data.tokens || { input: 0, output: 0 },
      error: data.error || null,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    // If generation for this lead and campaign already exists, replace it
    const existingIdx = store.aiEmailGenerations.findIndex(
      g => g.leadId === item.leadId && (item.campaignId ? g.campaignId === item.campaignId : true)
    );
    if (existingIdx !== -1) {
      store.aiEmailGenerations[existingIdx] = { ...store.aiEmailGenerations[existingIdx], ...item, _id: store.aiEmailGenerations[existingIdx]._id };
      saveStore();
      return store.aiEmailGenerations[existingIdx];
    }

    store.aiEmailGenerations.unshift(item);
    saveStore();
    return item;
  },

  async findByCampaign(campaignId) {
    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    if (!campaignId) return store.aiEmailGenerations;
    return store.aiEmailGenerations.filter(g => String(g.campaignId) === String(campaignId));
  },

  async findByLead(leadId) {
    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    return store.aiEmailGenerations.filter(g => String(g.leadId) === String(leadId));
  },

  async findById(id) {
    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    return store.aiEmailGenerations.find(g => String(g._id) === String(id) || String(g.id) === String(id)) || null;
  },

  async update(id, updateData) {
    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    const idx = store.aiEmailGenerations.findIndex(g => String(g._id) === String(id) || String(g.id) === String(id));
    if (idx === -1) return null;
    store.aiEmailGenerations[idx] = {
      ...store.aiEmailGenerations[idx],
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    saveStore();
    return store.aiEmailGenerations[idx];
  },

  async updateStatus(id, status) {
    return await this.update(id, { status });
  },

  async delete(id) {
    if (!store.aiEmailGenerations) store.aiEmailGenerations = [];
    const prev = store.aiEmailGenerations.length;
    store.aiEmailGenerations = store.aiEmailGenerations.filter(g => String(g._id) !== String(id) && String(g.id) !== String(id));
    if (store.aiEmailGenerations.length < prev) {
      saveStore();
      return true;
    }
    return false;
  }
};

// --- AI Usage Tracking & Token Store ---
export const AiUsageStore = {
  async logUsage({ userId, campaignId, leadId, model, inputTokens = 0, outputTokens = 0, status = 'success' }) {
    const entry = {
      _id: generateId(),
      userId: userId ? String(userId) : null,
      campaignId: campaignId ? String(campaignId) : null,
      leadId: leadId ? String(leadId) : null,
      model: model || 'claude-3-5-sonnet',
      inputTokens: Number(inputTokens) || 0,
      outputTokens: Number(outputTokens) || 0,
      totalTokens: (Number(inputTokens) || 0) + (Number(outputTokens) || 0),
      estimatedCost: ((Number(inputTokens) || 0) * 0.000003 + (Number(outputTokens) || 0) * 0.000015).toFixed(6),
      status,
      createdAt: new Date().toISOString()
    };

    if (!store.aiUsageLogs) store.aiUsageLogs = [];
    store.aiUsageLogs.unshift(entry);
    saveStore();
    return entry;
  },

  async getStats(filterUserId = null) {
    if (!store.aiUsageLogs) store.aiUsageLogs = [];
    let logs = store.aiUsageLogs;
    if (filterUserId) {
      logs = logs.filter(l => String(l.userId) === String(filterUserId));
    }

    const totalGenerations = logs.length;
    const successfulGenerations = logs.filter(l => l.status === 'success').length;
    const failedGenerations = logs.filter(l => l.status === 'failed').length;
    const totalInputTokens = logs.reduce((acc, l) => acc + (l.inputTokens || 0), 0);
    const totalOutputTokens = logs.reduce((acc, l) => acc + (l.outputTokens || 0), 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalEstimatedCost = logs.reduce((acc, l) => acc + Number(l.estimatedCost || 0), 0).toFixed(4);

    return {
      totalGenerations,
      successfulGenerations,
      failedGenerations,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalEstimatedCost: `$${totalEstimatedCost}`,
      recentLogs: logs.slice(0, 25)
    };
  },

  async getUsageByUser(userId) {
    const stats = await this.getStats(userId);
    return stats.recentLogs || [];
  }
};

// Load store on launch
loadStore();
