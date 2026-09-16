import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import nextEnv from '@next/env';
import { getSupabaseClient, queryResult } from '../lib/supabase.js';
nextEnv.loadEnvConfig(process.cwd());
const path = 'data/store.json';
if (!fs.existsSync(path)) { console.log('No legacy local records found.'); process.exit(0); }
const local = JSON.parse(fs.readFileSync(path, 'utf8'));
const collections = ['campaigns','emailTemplates','loginSessions','sendingInboxes','emailSequences','whatsappTemplates','systemConfigs','aiEmailGenerations','aiUsageLogs'];
console.log(JSON.stringify(Object.fromEntries([...collections,'blastCampaigns'].map(key => [key, (local[key] || []).length])), null, 2));
if (!process.argv.includes('--apply')) { console.log('Dry run only. Add --apply after core users/leads exist in Supabase.'); process.exit(0); }
const client = getSupabaseClient();
async function all(table) {
  const rows = [];
  for (let start=0; ; start+=1000) {
    const batch = await queryResult(client.from(table).select('*').order('id').range(start,start+999));
    rows.push(...batch); if (batch.length<1000) return rows;
  }
}
const users = await all('users');
const leads = await all('leads');
const userMap = new Map(users.flatMap(row => [[row.id,row.id],[row._id,row.id],[row.email,row.id]]));
for (const row of local.users || []) {
  const target = userMap.get(row.email);
  if (target) userMap.set(row._id || row.id,target);
}
const leadMap = new Map(leads.flatMap(row => [[row.id,row.id],[row._id,row.id]]));
function map(value, index, type) {
  if (!value || value==='default') return value;
  const target = index.get(String(value));
  if (!target) throw new Error('An imported ' + type + ' reference has no Supabase record. Resolve core records before --apply.');
  return target;
}
const records=[];
for (const collection of collections) for (const source of local[collection] || []) {
  const data={...source};
  for (const field of ['userId','createdBy']) if (data[field]) data[field]=map(data[field],userMap,'user');
  if (data.leadId) data.leadId=map(data.leadId,leadMap,'lead');
  let targetCollection=collection;
  let id=String(data._id || data.id || randomUUID());
  if (collection==='systemConfigs') id='main_config';
  if (collection==='loginSessions') id=`${data.userId}/${data.date}`;
  if (collection==='sendingInboxes' && data.userId && data.date) { targetCollection='sendingCounters'; id=`${data.userId}/${data.date}`; }
  records.push({collection:targetCollection,id,data});
}
const blasts=(local.blastCampaigns || []).map(source => ({
  id: randomUUID(), status: ['completed','cancelled','failed','draft'].includes(source.status) ? source.status : 'needs_review',
  data: { ...source, localLegacyId: source._id || source.id, originalLegacyStatus: source.status,
    createdBy: map(source.createdBy,userMap,'user'), leadIds:(source.leadIds || []).map(id => map(id,leadMap,'lead')),
    recipients:(source.recipients || []).map(recipient => ({ ...recipient, lead_id:map(recipient.lead_id || recipient.leadId,leadMap,'lead'),
      status:['sent','failed','skipped'].includes(recipient.status) ? recipient.status : 'unknown' })) }
}));
// Validate every reference before inserting anything; never overwrite current rows.
for (let start=0;start<records.length;start+=500) await queryResult(client.from('app_records').upsert(records.slice(start,start+500),{onConflict:'collection,id',ignoreDuplicates:true}));
const existing=await all('outbound_blast_campaigns');
const imported=new Set(existing.map(row => row.data?.localLegacyId));
for (const blast of blasts) if (!imported.has(blast.data.localLegacyId)) await queryResult(client.from('outbound_blast_campaigns').insert(blast));
console.log('Ancillary Supabase import complete. Imported active campaigns are held for provider reconciliation.');
