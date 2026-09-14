import { seedUsers } from './seed.js';
const names = ['Sammar', 'James', 'Oliver', 'Emily', 'Sophie', 'Chloe', 'Daniel', 'Jack', 'Lucy', 'Grace'];
const domain = process.env.SEED_EMAIL_DOMAIN;
if (!domain) throw new Error('SEED_EMAIL_DOMAIN is required.');
await seedUsers(names.map(name => ({ name, email: name.toLowerCase() + '@' + domain, role: 'salesperson' })));
