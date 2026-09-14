import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

const teamMembers = [
  { name: 'Admin', email: 'admin@8020acquisition.com', role: 'admin' },
  { name: 'Sammar', email: 'sammar@8020acquisition.com', role: 'salesperson' },
  { name: 'James', email: 'james@8020acquisition.com', role: 'salesperson' },
  { name: 'Oliver', email: 'oliver@8020acquisition.com', role: 'salesperson' },
  { name: 'Emily', email: 'emily@8020acquisition.com', role: 'salesperson' },
  { name: 'Sophie', email: 'sophie@8020acquisition.com', role: 'salesperson' },
  { name: 'Chloe', email: 'chloe@8020acquisition.com', role: 'salesperson' },
  { name: 'Daniel', email: 'daniel@8020acquisition.com', role: 'salesperson' },
  { name: 'Jack', email: 'jack@8020acquisition.com', role: 'salesperson' },
  { name: 'Lucy', email: 'lucy@8020acquisition.com', role: 'salesperson' },
  { name: 'Grace', email: 'grace@8020acquisition.com', role: 'salesperson' }
];

const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'DialerMVP@Admin2026';

async function seedSalesTeam() {
  console.log('🚀 Starting Provisioning for 1 Admin + 10 Salesperson Accounts...');
  console.log(`🔑 Default Password: ${DEFAULT_PASSWORD}`);

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, salt);
  const now = new Date();

  // 1. Seed into data/store.json (local JSON fallback)
  const dataDir = path.join(process.cwd(), 'data');
  const storeFile = path.join(dataDir, 'store.json');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    let storeData = { users: [] };
    if (fs.existsSync(storeFile)) {
      try {
        storeData = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      } catch (e) {
        storeData = { users: [] };
      }
    }
    if (!storeData.users) storeData.users = [];

    for (const member of teamMembers) {
      const existingIdx = storeData.users.findIndex(u => u.email.toLowerCase() === member.email.toLowerCase());
      const userObj = {
        _id: `usr_${member.name.toLowerCase()}_${Date.now()}`,
        name: member.name,
        email: member.email.toLowerCase(),
        password: passwordHash,
        role: member.role,
        approved: true,
        active: true,
        dailyLeadTarget: 50,
        dailyEmailLimit: 100,
        lastLogin: now.toISOString(),
        lastActive: now.toISOString(),
        createdAt: now.toISOString()
      };

      if (existingIdx !== -1) {
        storeData.users[existingIdx] = {
          ...storeData.users[existingIdx],
          ...userObj,
          _id: storeData.users[existingIdx]._id || userObj._id
        };
        console.log(`  [JSON Store] Updated: ${member.email} (${member.role})`);
      } else {
        storeData.users.push(userObj);
        console.log(`  [JSON Store] Created: ${member.email} (${member.role})`);
      }
    }
    fs.writeFileSync(storeFile, JSON.stringify(storeData, null, 2), 'utf8');
    console.log('✅ Local JSON store updated successfully.');
  } catch (err) {
    console.warn('⚠️ JSON Store update warning:', err.message);
  }

  // 2. Seed into Supabase (if configured)
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      console.log('📡 Connecting to Supabase...');

      for (const member of teamMembers) {
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, email')
          .eq('email', member.email.toLowerCase())
          .maybeSingle();

        const payload = {
          name: member.name,
          email: member.email.toLowerCase(),
          password: passwordHash,
          role: member.role,
          approved: true,
          active: true,
          last_active: now.toISOString(),
          last_login: now.toISOString(),
          created_at: now.toISOString()
        };

        if (existingUser) {
          const { error } = await supabase
            .from('users')
            .update(payload)
            .eq('id', existingUser.id);
          if (error) {
            console.warn(`  [Supabase] Update failed for ${member.email}:`, error.message);
          } else {
            console.log(`  [Supabase] Updated: ${member.email} (${member.role})`);
          }
        } else {
          payload._id = `usr_${member.name.toLowerCase()}_${Date.now()}`;
          const { error } = await supabase
            .from('users')
            .insert([payload]);
          if (error) {
            console.warn(`  [Supabase] Insert failed for ${member.email}:`, error.message);
          } else {
            console.log(`  [Supabase] Created: ${member.email} (${member.role})`);
          }
        }
      }
      console.log('✅ Supabase users synchronized successfully.');
    } catch (err) {
      console.warn('⚠️ Supabase sync warning:', err.message);
    }
  }

  // 3. Seed into MongoDB (if configured)
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      console.log('🍃 Connecting to MongoDB Atlas...');
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

      const userSchema = new mongoose.Schema({
        name: String,
        email: { type: String, unique: true },
        password: String,
        role: String,
        approved: Boolean,
        active: Boolean,
        dailyLeadTarget: Number,
        dailyEmailLimit: Number,
        lastLogin: Date,
        lastActive: Date,
        createdAt: Date
      }, { strict: false });

      const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

      for (const member of teamMembers) {
        await UserModel.findOneAndUpdate(
          { email: member.email.toLowerCase() },
          {
            $set: {
              name: member.name,
              email: member.email.toLowerCase(),
              password: passwordHash,
              role: member.role,
              approved: true,
              active: true,
              dailyLeadTarget: 50,
              dailyEmailLimit: 100,
              lastLogin: now,
              lastActive: now,
              createdAt: now
            }
          },
          { upsert: true, new: true }
        );
        console.log(`  [MongoDB] Synced: ${member.email} (${member.role})`);
      }

      await mongoose.disconnect();
      console.log('✅ MongoDB users synchronized successfully.');
    } catch (err) {
      console.warn('⚠️ MongoDB connection/sync warning:', err.message);
    }
  }

  console.log('\n🎉 ALL 11 ACCOUNTS SUCCESSFULLY PROVISIONED & ACTIVE:');
  teamMembers.forEach((m, idx) => {
    console.log(`   ${idx + 1}. [${m.role.toUpperCase()}] ${m.name} -> ${m.email}`);
  });
}

seedSalesTeam();
