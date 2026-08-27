export const SUPABASE_SCHEMA_SQL = `
-- 80/20 OUTBOUND DIALER — SUPABASE POSTGRESQL SCHEMA

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'salesperson',
  approved BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  last_active TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Leads Table
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  city TEXT,
  country TEXT,
  status TEXT DEFAULT 'new',
  assigned_to TEXT,
  priority INT DEFAULT 0,
  suppression_email BOOLEAN DEFAULT false,
  suppression_sms BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Calls Table
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  lead_id TEXT,
  phone TEXT,
  duration_seconds INT DEFAULT 0,
  outcome TEXT,
  recording_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  lead_id TEXT,
  blast_campaign_id TEXT,
  channel TEXT,
  direction TEXT DEFAULT 'outbound',
  to_address TEXT,
  from_address TEXT,
  content TEXT,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Blast Campaigns Table
CREATE TABLE IF NOT EXISTS public.blast_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'email',
  created_by TEXT,
  sending_inbox_id TEXT,
  template_subject TEXT,
  template_body TEXT,
  tone TEXT DEFAULT 'professional',
  sales_objective TEXT,
  use_ai_personalization BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'queued',
  stats JSONB DEFAULT '{"total":0,"sent":0,"failed":0,"skipped":0}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Login Sessions Table
CREATE TABLE IF NOT EXISTS public.login_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  date TEXT,
  active_time_seconds INT DEFAULT 0,
  dialing_time_seconds INT DEFAULT 0,
  break_time_seconds INT DEFAULT 0,
  is_on_break BOOLEAN DEFAULT false,
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  last_heartbeat TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
`;
