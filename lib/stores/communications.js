import { getSupabaseClient, queryResult } from '../supabase.js';
const db = () => getSupabaseClient();
function decode(row) {
  return row ? { ...row, _id: row.id, userId: row.user_id, leadId: row.lead_id,
    blastCampaignId: row.blast_campaign_id, messageSid: row.message_sid,
    callSid: row.call_sid, from: row.from_number || row.from_email,
    to: row.to_number || row.to_email, startTime: row.start_time, endTime: row.end_time,
    recordingUrl: row.recording_url, recordingSid: row.recording_sid, recordingDuration: row.recording_duration,
    createdAt: row.created_at } : null;
}
async function list(table, filter = query => query) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const batch = await queryResult(filter(db().from(table).select('*')).order('id').range(start, start + 999));
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows.map(decode).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
export const CallStore = {
  async create(data) {
    return decode(await queryResult(db().from('calls').insert({
      user_id: data.userId || null, lead_id: data.leadId || null,
      call_sid: data.callSid || null, twilio_call_sid: data.callSid || null,
      from_number: data.from || '', to_number: data.to || '', status: data.status || 'queued',
      direction: data.direction || 'outbound', duration: Number(data.duration) || 0,
      start_time: data.startTime || new Date().toISOString(), recording_url: data.recordingUrl || null,
      recording_sid: data.recordingSid || null, recording_duration: Number(data.recordingDuration) || 0,
      notes: data.notes || ''
    }).select().single()));
  },
  async findByUserId(id) { return list('calls', query => query.eq('user_id', String(id))); },
  async findOneAndUpdate(query, data) {
    const aliases = { recordingUrl: 'recording_url', recordingSid: 'recording_sid', recordingDuration: 'recording_duration', endTime: 'end_time', errorCode: 'error_code', errorMessage: 'error_message' };
    const allowed = new Set(['status', 'duration', 'recording_url', 'recording_sid', 'recording_duration', 'end_time', 'error_code', 'error_message', 'notes']);
    const patch = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(data)) if (allowed.has(aliases[key] || key)) patch[aliases[key] || key] = value;
    let update = db().from('calls').update(patch);
    const sid = query.callSid || query.call_sid || query.twilio_call_sid;
    if (sid) update = update.eq('call_sid', sid);
    else if (query._id || query.id) update = update.eq('id', query._id || query.id);
    else throw new Error('Call update requires an ID or SID.');
    return decode(await queryResult(update.select().maybeSingle()));
  }
};
export const MessageStore = {
  async create(data) {
    const email = data.channel === 'email';
    return decode(await queryResult(db().from('messages').insert({
      user_id: data.userId || null, lead_id: data.leadId || null, blast_campaign_id: data.blastCampaignId || null,
      message_sid: data.messageSid || null, twilio_message_sid: email ? null : data.messageSid || null,
      from_number: email ? null : data.from || '', to_number: email ? null : data.to || '',
      from_email: email ? data.from || '' : '', to_email: email ? data.to || '' : '',
      body: data.body || '', subject: data.subject || null, status: data.status || 'queued',
      channel: data.channel || 'sms', direction: data.direction || 'outbound', provider: email ? 'resend' : 'twilio',
      error_code: data.errorCode || null, error_message: data.errorMessage || null
    }).select().single()));
  },
  async findAll() { return list('messages'); },
  async findByUserId(id) { return list('messages', query => query.eq('user_id', String(id))); },
  async findByCampaignId(id) { return list('messages', query => query.eq('blast_campaign_id', String(id))); },
  async findOneAndUpdate(query, data) {
    const aliases = { errorCode: 'error_code', errorMessage: 'error_message' };
    const patch = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(data)) if (['status', 'error_code', 'error_message', 'body'].includes(aliases[key] || key)) patch[aliases[key] || key] = value;
    let update = db().from('messages').update(patch);
    const sid = query.messageSid || query.message_sid || query.twilio_message_sid;
    if (sid) update = update.eq('message_sid', sid);
    else if (query._id || query.id) update = update.eq('id', query._id || query.id);
    else throw new Error('Message update requires an ID or SID.');
    return decode(await queryResult(update.select().maybeSingle()));
  },
  async findLastByToPhone(phone) {
    return decode(await queryResult(db().from('messages').select('*').eq('to_number', phone)
      .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle()));
  }
};
