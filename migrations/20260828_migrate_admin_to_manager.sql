-- 80/20 Outbound System: 4-Tier to 3-Tier RBAC Migration Script
-- Consolidates 'admin' and 'manager' into a single operational 'manager' role.
-- Allowed roles: 'owner', 'manager', 'salesperson'

BEGIN;

-- 1. Migrate all legacy 'admin' accounts to 'manager'
UPDATE users 
SET role = 'manager' 
WHERE role = 'admin';

-- 2. Drop legacy role check constraints if present
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;

-- 3. Add updated 3-Tier RBAC CHECK constraint
ALTER TABLE users 
ADD CONSTRAINT users_role_check 
CHECK (role IN ('owner', 'manager', 'salesperson'));

-- 4. Ensure default role column constraint remains 'salesperson'
ALTER TABLE users 
ALTER COLUMN role SET DEFAULT 'salesperson';

COMMIT;
