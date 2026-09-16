-- Column names/types match the legacy Supabase REST schema. All data is synthetic.
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), _id text, name text NOT NULL,
  email text UNIQUE NOT NULL, password text NOT NULL, role text DEFAULT 'salesperson',
  approved boolean, active boolean, last_active timestamptz, last_login timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), _id text, name text, email text,
  phone text, company text, city text, country text, status text DEFAULT 'NEW',
  assigned_to text, priority integer, suppression_email boolean, suppression_sms boolean,
  notes text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), _id text, user_id text, lead_id text,
  phone text, duration_seconds integer, outcome text, recording_url text, notes text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), _id text, user_id text, lead_id text,
  blast_campaign_id text, channel text, direction text, to_address text, from_address text,
  content text, status text, created_at timestamptz DEFAULT now()
);
INSERT INTO public.users(id,_id,name,email,password,approved,active) VALUES
  ('11111111-1111-4111-8111-111111111111','legacy-agent','Test Agent','agent@example.test','test-hash',true,true);
INSERT INTO public.leads(id,_id,name,email,phone,company,assigned_to,suppression_email,suppression_sms,notes) VALUES
  ('22222222-2222-4222-8222-222222222222','legacy-lead','Test Contact','contact@example.test','+1 202 555 0123','Test Company','legacy-agent',true,true,'Keep this note');
INSERT INTO public.calls(id,user_id,lead_id,phone,duration_seconds,outcome) VALUES
  ('33333333-3333-4333-8333-333333333333','legacy-agent','legacy-lead','+12025550123',75,'connected');
INSERT INTO public.messages(id,user_id,lead_id,channel,direction,to_address,from_address,content,status) VALUES
  ('44444444-4444-4444-8444-444444444444','legacy-agent','legacy-lead','email','outbound','contact@example.test','agent@example.test','Keep this email','sent'),
  ('55555555-5555-4555-8555-555555555555','legacy-agent','legacy-lead','sms','outbound','+12025550123','+12025550124','Keep this SMS','delivered');
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.leads TO anon, authenticated;
CREATE POLICY legacy_open_leads ON public.leads FOR ALL USING (true);
