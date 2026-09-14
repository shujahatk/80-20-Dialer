import nextEnv from '@next/env';
import { LeadStore } from '../lib/store.js';
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes('--apply')) throw new Error('Add --apply to soft-delete all active leads in the configured Supabase project.');
let count = 0;
for (const lead of await LeadStore.findAll()) if (await LeadStore.softDelete(lead.id, null, 'Explicit cleanup script')) count++;
console.log('Soft-deleted ' + count + ' leads; permanent suppression and historical records retained.');
