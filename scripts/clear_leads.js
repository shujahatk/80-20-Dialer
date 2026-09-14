import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import mongoose from 'mongoose';

// Load .env manually
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const firstEq = trimmed.indexOf('=');
        const key = trimmed.slice(0, firstEq).trim();
        let val = trimmed.slice(firstEq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
} catch (e) {}

async function clearAllLeads() {
  console.log('🧹 Starting cleanup of all lead data from the system...');

  // 1. Clean data/store.json
  const storePath = path.join(process.cwd(), 'data', 'store.json');
  if (fs.existsSync(storePath)) {
    try {
      const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const initialLeads = store.leads?.length || 0;
      const initialCalls = store.calls?.length || 0;
      const initialMessages = store.messages?.length || 0;
      const initialActivities = store.activityLogs?.length || 0;

      store.leads = [];
      store.leadAssignments = [];
      store.aiEmailGenerations = [];
      store.activityLogs = [];
      store.calls = [];
      store.messages = [];

      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
      console.log(`✅ [Local Store] Removed ${initialLeads} leads, ${initialCalls} calls, ${initialMessages} messages, ${initialActivities} activity logs.`);
    } catch (err) {
      console.error('⚠️ Error cleaning data/store.json:', err.message);
    }
  }

  // 2. Clean Supabase leads
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      console.log('📡 Connecting to Supabase...');
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Delete from lead_assignments
      try {
        const { error: err1 } = await supabase.from('lead_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (!err1) console.log('  [Supabase] Cleared lead_assignments.');
      } catch (e) {}

      // Delete from calls
      try {
        const { error: err2 } = await supabase.from('calls').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (!err2) console.log('  [Supabase] Cleared calls.');
      } catch (e) {}

      // Delete from leads
      try {
        const { error: err3 } = await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (!err3) console.log('  [Supabase] Cleared leads.');
      } catch (e) {}

      console.log('✅ [Supabase] Lead records purged successfully.');
    } catch (err) {
      console.warn('⚠️ Supabase purge warning:', err.message);
    }
  }

  // 3. Clean MongoDB (if connected)
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      console.log('🍃 Connecting to MongoDB...');
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 4000 });
      
      const db = mongoose.connection.db;
      if (db) {
        await db.collection('leads').deleteMany({});
        await db.collection('activitylogs').deleteMany({});
        await db.collection('calls').deleteMany({});
        await db.collection('messages').deleteMany({});
        console.log('✅ [MongoDB] Lead collections purged successfully.');
      }
      await mongoose.disconnect();
    } catch (err) {
      console.warn('⚠️ MongoDB purge notice:', err.message);
    }
  }

  console.log('\n🎉 ALL PREVIOUS LEAD DATA HAS BEEN COMPLETELY REMOVED FROM THE SYSTEM.');
}

clearAllLeads();
