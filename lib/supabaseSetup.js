export const SUPABASE_SCHEMA_SQL = `
-- 80/20 OUTBOUND DIALER — SUPABASE POSTGRESQL PRODUCTION HARDENED SCHEMA

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
  userId TEXT,
  lead_id TEXT,
  leadId TEXT,
  twilio_call_sid TEXT,
  call_sid TEXT,
  callSid TEXT,
  from_number TEXT,
  "from" TEXT,
  to_number TEXT,
  "to" TEXT,
  direction TEXT DEFAULT 'outbound',
  status TEXT DEFAULT 'queued',
  duration INT DEFAULT 0,
  duration_seconds INT DEFAULT 0,
  outcome TEXT,
  recording_url TEXT,
  recordingUrl TEXT,
  recording_sid TEXT,
  recordingSid TEXT,
  recording_duration INT DEFAULT 0,
  recordingDuration INT DEFAULT 0,
  recording_consent_status TEXT DEFAULT 'not_applicable',
  error_code TEXT,
  error_message TEXT,
  notes TEXT,
  start_time TIMESTAMPTZ DEFAULT now(),
  startTime TIMESTAMPTZ DEFAULT now(),
  end_time TIMESTAMPTZ,
  endTime TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  lead_id TEXT,
  blast_campaign_id TEXT,
  twilio_message_sid TEXT,
  message_sid TEXT,
  channel TEXT DEFAULT 'sms',
  direction TEXT DEFAULT 'outbound',
  from_number TEXT,
  to_number TEXT,
  from_address TEXT,
  to_address TEXT,
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  content TEXT,
  status TEXT DEFAULT 'sent',
  provider TEXT DEFAULT 'twilio',
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4.1 Suppression List (Permanent DNC)
CREATE TABLE IF NOT EXISTS public.suppression_list (
  id TEXT PRIMARY KEY,
  email_normalized TEXT,
  phone_normalized TEXT,
  channel TEXT DEFAULT 'all',
  reason TEXT DEFAULT 'opt_out',
  source TEXT DEFAULT 'system',
  lead_id TEXT,
  created_by TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
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

-- 7. Audit Logs Table (Enterprise Operational Auditability)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT 'system',
  entity_id TEXT,
  lead_id TEXT,
  channel TEXT,
  notes TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Lead Assignments Audit Trail
CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  _id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  lead_id TEXT NOT NULL,
  from_user TEXT,
  to_user TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  reason TEXT DEFAULT 'manual_assignment',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- --- INDEXES FOR PRODUCTION QUERY PERFORMANCE ---
CREATE INDEX IF NOT EXISTS idx_leads_assigned_status ON public.leads(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_calls_user_created ON public.calls(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_campaign ON public.messages(user_id, blast_campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON public.lead_assignments(lead_id);
`;
