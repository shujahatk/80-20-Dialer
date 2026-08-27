import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { isMongoConnected } from './db';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

import User from '../models/User';
import Call from '../models/Call';
import Message from '../models/Message';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import ActivityLog from '../models/ActivityLog';
import EmailTemplate from '../models/EmailTemplate';
import LoginSession from '../models/LoginSession';
import SendingInbox from '../models/SendingInbox';
import EmailSequence from '../models/EmailSequence';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import SystemConfig from '../models/SystemConfig';

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
  leadAssignments: []
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
    const user = store.users.find(u => u.email === email.toLowerCase());
    return user ? { ...user } : null;
  },

  async findById(id) {
    if (!id) return null;
    if (isSupabaseConfigured()) {
      try {
        const { data } = await getSupabaseClient().from('users').select('*').or(`_id.eq.${id},id.eq.${id}`).maybeSingle();
        if (data) {
          const { password, ...rest } = data;
          return { ...rest, _id: data._id || data.id, role: rest.role || 'admin', approved: rest.approved !== false, active: rest.active !== false };
        }
      } catch (e) {}
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
    const user = store.users.find(u => u._id === id || u._id?.toString() === id.toString());
    if (!user) return null;
    const { password, ...userWithoutPassword } = user;
    if (!userWithoutPassword.role) userWithoutPassword.role = 'admin';
    if (userWithoutPassword.approved === undefined) userWithoutPassword.approved = true;
    if (userWithoutPassword.active === undefined) userWithoutPassword.active = true;
    return userWithoutPassword;
  },

  async create({ name, email, password, role, approved }) {
    const now = new Date();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = password.startsWith('$2a$') || password.startsWith('$2b$') ? password : await bcrypt.hash(password, salt);
    const userId = generateId();

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
        const { data } = await getSupabaseClient().from('users').update({ approved: true, active: true }).or(`_id.eq.${id},id.eq.${id}`).select().single();
        if (data) {
          const { password, ...rest } = data;
          return { ...rest, _id: data._id || data.id };
        }
      } catch (e) {}
    }
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { approved: true, active: true }, { new: true }).select('-password').lean();
    }
    const user = store.users.find(u => u._id === id || u._id?.toString() === id.toString());
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
        await getSupabaseClient().from('users').delete().or(`_id.eq.${id},id.eq.${id}`);
        return true;
      } catch (e) {}
    }
    if (isMongoConnected()) {
      await User.findByIdAndDelete(id);
      return true;
    }
    const initialLength = store.users.length;
    store.users = store.users.filter(u => u._id !== id);
    const deleted = store.users.length < initialLength;
    if (deleted) saveStore();
    return deleted;
  },

  async updateRole(id, role) {
    if (isMongoConnected()) {
      return await User.findByIdAndUpdate(id, { role }, { new: true }).select('-password').lean();
    }
    const user = store.users.find(u => u._id === id);
    if (!user) return null;
    user.role = role;
    saveStore();
    const { password, ...rest } = user;
    return rest;
  }
};

// --- Call Operations ---
export const CallStore = {
  async create({ userId, callSid, from, to, status, startTime }) {
    if (isMongoConnected()) {
      return await Call.create({ userId, callSid, from, to, status: status || 'queued', startTime });
    }

    const newCall = {
      _id: generateId(),
      userId: userId.toString(),
      callSid,
      from,
      to,
      status: status || 'queued',
      duration: 0,
      startTime: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
      endTime: null,
      recordingUrl: null,
      recordingSid: null,
      recordingDuration: 0,
      createdAt: new Date().toISOString()
    };
    store.calls.unshift(newCall);
    saveStore();
    return newCall;
  },

  async findByUserId(userId) {
    if (isMongoConnected()) {
      return await Call.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return store.calls
      .filter(c => c.userId === userId.toString())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findOneAndUpdate({ callSid }, updateData) {
    if (isMongoConnected()) {
      return await Call.findOneAndUpdate({ callSid }, updateData, { new: true }).lean();
    }

    const callIndex = store.calls.findIndex(c => c.callSid === callSid);
    if (callIndex === -1) return null;
    store.calls[callIndex] = {
      ...store.calls[callIndex],
      ...updateData,
      ...(updateData.endTime ? { endTime: new Date(updateData.endTime).toISOString() } : {})
    };
    saveStore();
    return store.calls[callIndex];
  }
};

// --- Message Operations ---
export const MessageStore = {
  async create({ userId, messageSid, from, to, body, status, channel, direction, leadId, blastCampaignId }) {
    if (isMongoConnected()) {
      return await Message.create({ userId, messageSid, from, to, body, status: status || 'queued', channel, direction, leadId, blastCampaignId });
    }

    const newMessage = {
      _id: generateId(),
      userId: userId ? userId.toString() : null,
      leadId: leadId ? leadId.toString() : null,
      messageSid,
      from,
      to,
      body,
      status: status || 'queued',
      channel: channel || 'sms',
      direction: direction || 'outbound',
      blastCampaignId: blastCampaignId ? blastCampaignId.toString() : null,
      createdAt: new Date().toISOString()
    };
    store.messages.unshift(newMessage);
    saveStore();
    return newMessage;
  },

  async findByUserId(userId) {
    if (isMongoConnected()) {
      return await Message.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return store.messages
      .filter(m => m.userId === userId.toString())
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
    if (isMongoConnected()) {
      return await Message.findOneAndUpdate(query, updateData, { new: true }).lean();
    }
    const idx = store.messages.findIndex(m => {
      if (query.messageSid && m.messageSid !== query.messageSid) return false;
      if (query.to && m.to !== query.to) return false;
      return true;
    });
    if (idx === -1) return null;
    store.messages[idx] = { ...store.messages[idx], ...updateData };
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
    if (isMongoConnected()) {
      return await Lead.create(data);
    }
    const lead = { _id: generateId(), ...data, createdAt: new Date().toISOString() };
    store.leads.push(lead);
    saveStore();
    return lead;
  },

  async createBulk(leads) {
    if (isMongoConnected()) {
      return await Lead.insertMany(leads);
    }
    const newLeads = leads.map(l => ({ _id: generateId(), ...l, createdAt: new Date().toISOString() }));
    store.leads.push(...newLeads);
    saveStore();
    return newLeads;
  },

  async findAll() {
    if (isMongoConnected()) {
      return await Lead.find().sort({ createdAt: -1 }).lean();
    }
    return store.leads.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  async findById(id) {
    if (isMongoConnected()) {
      const mongoose = require('mongoose');
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
      return await Lead.findById(id).lean();
    }
    return store.leads.find(l => l._id === id) || null;
  },

  async findByUser(userId) {
    if (isMongoConnected()) return await Lead.find({ userId }).sort({ createdAt: -1 }).lean();
    return store.leads.filter(l => l.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findByCampaign(campaignId) {
    if (isMongoConnected()) return await Lead.find({ campaignId }).sort({ createdAt: -1 }).lean();
    return store.leads.filter(l => l.campaignId === campaignId);
  },

  async claimNextLead(userId) {
    if (isMongoConnected()) {
      const now = new Date();
      const lockExpiry = 5 * 60 * 1000;
      const lockCutoff = new Date(now - lockExpiry);

      const lead = await Lead.findOneAndUpdate(
        {
          $or: [{ userId: null }, { userId: { $exists: false } }],
          status: 'new',
          $or: [
            { currentlyBeingWorked: { $ne: true } },
            { currentlyBeingWorkedAt: { $lt: lockCutoff } },
            { currentlyBeingWorkedBy: null }
          ]
        },
        {
          $set: {
            userId: userId,
            currentlyBeingWorked: true,
            currentlyBeingWorkedBy: userId,
            currentlyBeingWorkedAt: now,
            'assignment.dateAssigned': now
          }
        },
        {
          sort: { 'assignment.priority': -1, createdAt: 1 },
          new: true
        }
      ).lean();
      return lead;
    }

    const now = new Date();
    const lockExpiry = 5 * 60 * 1000;
    
    const candidates = store.leads.filter(l => {
      const isUnassigned = !l.userId;
      const isNew = l.status === 'new';
      const isNotWorked = !l.currentlyBeingWorked || 
                          !l.currentlyBeingWorkedAt || 
                          (now - new Date(l.currentlyBeingWorkedAt)) >= lockExpiry ||
                          !l.currentlyBeingWorkedBy;
      return isUnassigned && isNew && isNotWorked;
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
    lead.currentlyBeingWorked = true;
    lead.currentlyBeingWorkedBy = userId;
    lead.currentlyBeingWorkedAt = now.toISOString();
    if (!lead.assignment) lead.assignment = {};
    lead.assignment.dateAssigned = now.toISOString();

    saveStore();
    return lead;
  },

  async findDailyQueue(userId) {
    if (isMongoConnected()) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const replies = await Lead.find({ userId, hasUnansweredReply: true }).sort({ lastReplyAt: -1 }).lean();
      const overdue = await Lead.find({ userId, status: 'callback', callbackDate: { $lt: now } }).sort({ callbackDate: 1 }).lean();
      const dueToday = await Lead.find({ userId, status: 'callback', callbackDate: { $gte: today, $lte: endOfDay } }).sort({ callbackDate: 1 }).lean();
      const interested = await Lead.find({ userId, status: 'interested', coldOutreachStopped: false }).sort({ 'assignment.priority': -1 }).lean();
      const newLeads = await Lead.find({ userId, status: 'new' }).sort({ 'assignment.priority': -1 }).limit(50).lean();

      return { replies, overdue, dueToday, interested, newLeads };
    }
    const userLeads = store.leads.filter(l => l.userId === userId);
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

  async findPendingByPhone(phone) {
    if (isMongoConnected()) return await Lead.find({ 'contact.phone': phone }).lean();
    return store.leads.filter(l => l.contact?.phone === phone);
  },

  async findPendingByEmail(email) {
    if (isMongoConnected()) return await Lead.find({ 'contact.email': email.toLowerCase() }).lean();
    return store.leads.filter(l => l.contact?.email?.toLowerCase() === email.toLowerCase());
  },

  async update(id, updateData) {
    if (isMongoConnected()) return await Lead.findByIdAndUpdate(id, updateData, { new: true }).lean();
    const idx = store.leads.findIndex(l => l._id === id);
    if (idx === -1) return null;
    store.leads[idx] = { ...store.leads[idx], ...updateData };
    saveStore();
    return store.leads[idx];
  },

  async delete(id) {
    if (isMongoConnected()) { await Lead.findByIdAndDelete(id); return true; }
    const len = store.leads.length;
    store.leads = store.leads.filter(l => l._id !== id);
    if (store.leads.length < len) { saveStore(); return true; }
    return false;
  },

  async countByUser(userId) {
    if (isMongoConnected()) return await Lead.countDocuments({ userId });
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

// Load store on launch
loadStore();
