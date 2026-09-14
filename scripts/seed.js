const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.SUPABASE_URL || 'https://bstfivqqzciixiztioqw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock_service_key_for_seed';
const client = createClient(supabaseUrl, supabaseKey);

async function seedDatabase() {
  console.log('--- 80/20 Outbound System 3-Tier Seed Script ---');

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('DialerMVP@Admin2026', salt);

  const seedUsers = [
    {
      _id: 'usr_owner_seed',
      name: 'System Owner',
      email: 'owner@dialermvp.com',
      password: passwordHash,
      role: 'owner',
      approved: true,
      active: true
    },
    {
      _id: 'usr_manager_seed',
      name: 'Sales Manager',
      email: 'manager@dialermvp.com',
      password: passwordHash,
      role: 'manager',
      approved: true,
      active: true
    },
    {
      _id: 'usr_rep_seed',
      name: 'Sales Representative',
      email: 'rep@dialermvp.com',
      password: passwordHash,
      role: 'salesperson',
      approved: true,
      active: true
    }
  ];

  for (const u of seedUsers) {
    const { data: existing } = await client.from('users').select('*').eq('email', u.email).single();
    if (!existing) {
      const { error } = await client.from('users').insert([u]);
      if (error) {
        console.error(`Failed to seed user ${u.email}:`, error.message);
      } else {
        console.log(`✅ Seeded 3-tier user: ${u.email} (${u.role})`);
      }
    } else {
      console.log(`ℹ️ User ${u.email} already exists.`);
    }
  }

  console.log('--- Seeding Complete ---');
}

seedDatabase();
