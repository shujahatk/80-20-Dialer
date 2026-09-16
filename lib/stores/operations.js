import { recordStore } from './records.js';
import { getSupabaseClient, queryResult, queryRecord } from '../supabase.js';
const today = () => new Date().toISOString().slice(0, 10);
const timestamp = () => new Date().toISOString();
function activeStore(collection) {
  const records = recordStore(collection);
  return { ...records, async findAll() { return (await records.findAll()).filter(record => record.active !== false); } };
}
export const CampaignStore = recordStore('campaigns');
export const EmailTemplateStore = activeStore('emailTemplates');
export const EmailSequenceStore = activeStore('emailSequences');
export const WhatsAppTemplateStore = activeStore('whatsappTemplates');

function activity(row) { return { ...row, _id: row.id, userId: row.user_id, leadId: row.lead_id, timestamp: row.created_at }; }
export const ActivityLogStore = {
  async create(data) {
    return activity(await queryResult(getSupabaseClient().from('activity_logs').insert({
      user_id: data.userId || null, lead_id: data.leadId || null, action: data.action,
      channel: data.channel || '', direction: data.direction || 'outbound', outcome: data.outcome || '',
      notes: data.notes || '', message_sid: data.messageSid || null, duration: data.duration || 0
    }).select().single()));
  },
  async findByLead(id) {
    return (await queryResult(getSupabaseClient().from('activity_logs').select('*').eq('lead_id', id)
      .order('created_at', { ascending: false }))).map(activity);
  },
  async findByUser(id, limit = 100) {
    return (await queryResult(getSupabaseClient().from('activity_logs').select('*').eq('user_id', id)
      .order('created_at', { ascending: false }).limit(Math.min(10000, Math.max(1, limit))))).map(activity);
  },
  async getUserStats(id) {
    const logs = (await queryResult(getSupabaseClient().from('activity_logs').select('*').eq('user_id', id).gte('created_at', `${today()}T00:00:00Z`))).map(activity);
    const callLogs = logs.filter(log => log.action === 'call');
    return {
      callsToday: callLogs.length,
      connectedCallsToday: callLogs.filter(log => (log.duration && log.duration > 0) || ['completed', 'answered', 'connected'].includes(String(log.outcome).toLowerCase())).length,
      emailsToday: logs.filter(log => log.action === 'email').length,
      smsToday: logs.filter(log => log.action === 'sms' && log.channel !== 'whatsapp').length,
      whatsappToday: logs.filter(log => log.channel === 'whatsapp').length,
      notesToday: logs.filter(log => log.action === 'note').length,
      talkTimeToday: callLogs.reduce((sum, log) => sum + (log.duration || 0), 0)
    };
  }
};
const sessions = recordStore('loginSessions');
export const LoginSessionStore = {
  async create(data) {
    const id = `${data.userId}/${data.date || today()}`;
    // A database UPSERT protects simultaneous first heartbeat/login requests.
    const row = await queryRecord(getSupabaseClient().rpc('ensure_app_record', { p_collection: 'loginSessions', p_id: id,
      p_data: { activeTimeSeconds: 0, dialingTimeSeconds: 0, breakTimeSeconds: 0, isOnBreak: false, loginAt: timestamp(), lastActivityAt: timestamp(), ...data } }));
    return { ...row.data, _id: row.id, id: row.id };
  },
  async findToday(userId) { return sessions.findById(`${userId}/${today()}`); },
  async updateSession(id, data) { return sessions.update(id, data); },
  async toggleBreak(userId) {
    await this.create({ userId, date: today() });
    const row = await queryRecord(getSupabaseClient().rpc('toggle_outbound_break', { p_id: `${userId}/${today()}` }));
    return { ...row.data, _id: row.id };
  },
  async getUserStats(userId) {
    const session = await this.findToday(userId);
    let breakTimeSeconds = session?.breakTimeSeconds || 0;
    if (session?.isOnBreak && session.breakStartedAt) breakTimeSeconds += Math.max(0, Math.floor((Date.now() - new Date(session.breakStartedAt)) / 1000));
    return { activeTimeSeconds: session?.activeTimeSeconds || 0, dialingTimeSeconds: session?.dialingTimeSeconds || 0,
      breakTimeSeconds, isOnBreak: Boolean(session?.isOnBreak) };
  }
};
const inboxes = recordStore('sendingInboxes');
const counters = recordStore('sendingCounters');
function inboxCounter(inbox) {
  if (!inbox) return null;
  return { ...inbox, emailsSentToday: (inbox.dailyCounters || []).find(counter => counter.date === today())?.emailsSent || 0 };
}
export const SendingInboxStore = {
  async createInbox(data) { return inboxes.create({ name: 'Default Inbox', fromEmail: '', dailyLimit: 50, status: 'healthy', active: true, dailyCounters: [], ...data }); },
  async findAllInboxes() { return (await inboxes.findAll()).filter(inbox => inbox.active !== false).map(inboxCounter); },
  async findInboxById(id) { return inboxCounter(await inboxes.findById(id)); },
  async updateInbox(id, data) { return inboxes.update(id, data); },
  async deleteInbox(id) { return Boolean(await inboxes.update(id, { active: false })); },
  async incrementInboxUsage(id) {
    const row = await queryRecord(getSupabaseClient().rpc('increment_outbound_inbox', { p_id: String(id), p_date: today() }));
    return row ? inboxCounter({ ...row.data, _id: row.id }) : null;
  },
  async getToday(userId) {
    const row = await queryRecord(getSupabaseClient().rpc('ensure_app_record', { p_collection: 'sendingCounters', p_id: `${userId}/${today()}`,
      p_data: { userId, date: today(), emailsSent: 0, callsMade: 0, smsSent: 0, status: 'healthy' } }));
    return { ...row.data, _id: row.id };
  },
  async incrementEmail(userId) { return this.increment(userId, 'emailsSent'); },
  async incrementCalls(userId) { return this.increment(userId, 'callsMade'); },
  async increment(userId, field) {
    await this.getToday(userId);
    const row = await queryRecord(getSupabaseClient().rpc('increment_app_record', { p_collection: 'sendingCounters', p_id: `${userId}/${today()}`, p_field: field, p_amount: 1 }));
    return { ...row.data, _id: row.id };
  },
  async setStatus(userId, status) { const counter = await this.getToday(userId); return counters.update(counter._id, { status }); }
};
const configs = recordStore('systemConfigs');
export const SystemConfigStore = {
  async getConfig() {
    const row = await queryRecord(getSupabaseClient().rpc('ensure_app_record', { p_collection: 'systemConfigs', p_id: 'main_config',
      p_data: { key: 'main_config', callRecordingEnabled: false, allowedHoursStart: 8, allowedHoursEnd: 18, crmWebhookUrl: '' } }));
    return { ...row.data, _id: row.id };
  },
  async updateConfig(data) { await this.getConfig(); return configs.update('main_config', data); }
};
const generations = recordStore('aiEmailGenerations');
export const AiEmailGenerationStore = {
  ...generations,
  async create(data) {
    const id = `${data.userId}/${data.campaignId || 'individual'}/${data.leadId}`;
    await queryRecord(getSupabaseClient().rpc('ensure_app_record', { p_collection: 'aiEmailGenerations', p_id: id, p_data: {} }));
    return generations.update(id, { createdAt: timestamp(), status: 'generated', ...data });
  },
  async findByCampaign(id) { return (await generations.findAll()).filter(record => !id || String(record.campaignId) === String(id)); },
  async findByLead(id) { return (await generations.findAll()).filter(record => String(record.leadId) === String(id)); },
  async updateStatus(id, status) { return generations.update(id, { status }); }
};
const usage = recordStore('aiUsageLogs');
export const AiUsageStore = {
  async logUsage(data) {
    const inputTokens = Number(data.inputTokens) || 0;
    const outputTokens = Number(data.outputTokens) || 0;
    return usage.create({ ...data, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCost: inputTokens * 0.000003 + outputTokens * 0.000015 });
  },
  async getStats(userId = null) {
    const logs = (await usage.findAll()).filter(log => !userId || String(log.userId) === String(userId));
    return { totalGenerations: logs.length, successfulGenerations: logs.filter(log => log.status === 'success').length,
      failedGenerations: logs.filter(log => log.status === 'failed').length,
      totalInputTokens: logs.reduce((sum, log) => sum + log.inputTokens, 0), totalOutputTokens: logs.reduce((sum, log) => sum + log.outputTokens, 0),
      totalTokens: logs.reduce((sum, log) => sum + log.totalTokens, 0), totalEstimatedCost: `$${logs.reduce((sum, log) => sum + Number(log.estimatedCost), 0).toFixed(4)}`, recentLogs: logs.slice(0, 25) };
  },
  async getUsageByUser(userId) { return (await this.getStats(userId)).recentLogs; }
};
