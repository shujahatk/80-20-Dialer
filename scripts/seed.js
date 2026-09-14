import nextEnv from '@next/env';
import { UserStore } from '../lib/store.js';
import { validatePasswordStrength } from '../lib/auth/passwordValidator.js';
nextEnv.loadEnvConfig(process.cwd());
export async function seedUsers(users) {
  if (!process.argv.includes('--apply')) throw new Error('Add --apply to provision Supabase users.');
  const password = process.env.SEED_PASSWORD || process.env.ADMIN_PASSWORD;
  const validation = validatePasswordStrength(password);
  if (!validation.valid) throw new Error('Supply a strong SEED_PASSWORD or ADMIN_PASSWORD: ' + validation.error);
  for (const user of users) {
    if (!await UserStore.findOne({ email: user.email })) await UserStore.create({ ...user, password, approved: true });
  }
  console.log('Supabase user provisioning complete.');
}
if (process.argv[1]?.endsWith('seed.js')) {
  const email = process.env.ADMIN_EMAIL;
  if (!email) throw new Error('ADMIN_EMAIL is required.');
  await seedUsers([{ name: 'System Owner', email, role: 'owner' }]);
}
