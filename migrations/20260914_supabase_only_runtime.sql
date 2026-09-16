-- Standalone upgrade for the legacy four-table schema, a fresh database, or the
-- existing core/hardening/Twilio schema. Run this entire file in the SQL editor.
-- No application data is deleted. Safe to rerun. Use the service_role app key.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CREATE TABLE IF NOT EXISTS alone does not add fields to older tables.
-- Ensure every field used below exists before converting data or creating RPCs.
CREATE TABLE IF NOT EXISTS public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS _id text,
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email text UNIQUE,
  ADD COLUMN IF NOT EXISTS password text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'salesperson',
  ADD COLUMN IF NOT EXISTS approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_active timestamptz,
  ADD COLUMN IF NOT EXISTS last_login timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reset_password_token text,
  ADD COLUMN IF NOT EXISTS reset_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_lead_target integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS daily_email_limit integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS calendar_link text,
  ADD COLUMN IF NOT EXISTS crm_webhook_url text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';
CREATE TABLE IF NOT EXISTS public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS _id text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS company jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS niche text,
  ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS stage_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_note text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS campaign_id text,
  ADD COLUMN IF NOT EXISTS suppression jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS custom_context text,
  ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Normalize the older flat company column without discarding company names.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='company' AND data_type='text') THEN
    ALTER TABLE public.leads ALTER COLUMN company DROP DEFAULT;
    ALTER TABLE public.leads ALTER COLUMN company TYPE jsonb USING jsonb_build_object('name',company);
    ALTER TABLE public.leads ALTER COLUMN company SET DEFAULT '{}'::jsonb;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.outbound_identifier_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW._id := COALESCE(NEW._id,NEW.id::text); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS outbound_identifier ON public.users;
CREATE TRIGGER outbound_identifier BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.outbound_identifier_default();
DROP TRIGGER IF EXISTS outbound_identifier ON public.leads;
CREATE TRIGGER outbound_identifier BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.outbound_identifier_default();
CREATE TABLE IF NOT EXISTS public.calls (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS _id text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_sid text,
  ADD COLUMN IF NOT EXISTS twilio_call_sid text,
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS to_number text,
  ADD COLUMN IF NOT EXISTS direction text DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS duration integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS recording_duration integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recording_sid text,
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS start_time timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS _id text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_sid text,
  ADD COLUMN IF NOT EXISTS twilio_message_sid text,
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS to_number text,
  ADD COLUMN IF NOT EXISTS body text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS channel text DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS direction text DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS blast_campaign_id uuid,
  ADD COLUMN IF NOT EXISTS from_email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS to_email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL, channel text, direction text DEFAULT 'outbound',
  outcome text, notes text, message_sid text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.activity_logs ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS duration integer DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL, entity_type text, entity_id text, notes text,
  ip_address text, user_agent text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS old_value jsonb,
  ADD COLUMN IF NOT EXISTS new_value jsonb;
CREATE TABLE IF NOT EXISTS public.refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, refresh_token_jti text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by uuid,
  last_used_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_normalized text, phone_normalized text,
  channel text NOT NULL DEFAULT 'all', reason text DEFAULT 'opt_out', source text DEFAULT 'system',
  lead_id uuid, active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_records (
  collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS public.outbound_blast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'draft',
  data jsonb NOT NULL DEFAULT '{}'::jsonb, worker_id text, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_blast_queue ON public.outbound_blast_campaigns(status, lease_until);
CREATE INDEX IF NOT EXISTS messages_blast_campaign ON public.messages(blast_campaign_id);
CREATE TABLE IF NOT EXISTS public.worker_health (id text PRIMARY KEY, heartbeat_at timestamptz NOT NULL);

-- Convert legacy values once. Keep the old columns and IDs for traceability.
-- A transaction marker prevents a rerun from overwriting later user changes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.app_records WHERE collection='schemaMigrations' AND id='20260914_supabase_only_runtime_legacy') THEN RETURN; END IF;

  UPDATE public.leads l SET assigned_to=u.id FROM public.users u WHERE l.assigned_to::text=u._id AND l.assigned_to::text<>u.id::text;
  UPDATE public.leads l SET locked_by=u.id FROM public.users u WHERE l.locked_by::text=u._id AND l.locked_by::text<>u.id::text;
  UPDATE public.calls c SET user_id=u.id FROM public.users u WHERE c.user_id::text=u._id AND c.user_id::text<>u.id::text;
  UPDATE public.messages m SET user_id=u.id FROM public.users u WHERE m.user_id::text=u._id AND m.user_id::text<>u.id::text;
  UPDATE public.calls c SET lead_id=l.id FROM public.leads l WHERE c.lead_id::text=l._id AND c.lead_id::text<>l.id::text;
  UPDATE public.messages m SET lead_id=l.id FROM public.leads l WHERE m.lead_id::text=l._id AND m.lead_id::text<>l.id::text;

  UPDATE public.leads l SET
    contact=jsonb_strip_nulls(jsonb_build_object('name',l.name,'email',l.email,'phone',l.phone)) || COALESCE(l.contact,'{}'),
    suppression=jsonb_build_object('email',COALESCE((to_jsonb(l)->>'suppression_email')::boolean,false),
      'sms',COALESCE((to_jsonb(l)->>'suppression_sms')::boolean,false)) || COALESCE(l.suppression,'{}');

  UPDATE public.calls c SET
    duration=COALESCE(NULLIF(c.duration,0),(to_jsonb(c)->>'duration_seconds')::integer,0),
    to_number=COALESCE(c.to_number,to_jsonb(c)->>'phone'),
    notes=COALESCE(c.notes,to_jsonb(c)->>'outcome');
  UPDATE public.messages m SET
    body=COALESCE(NULLIF(m.body,''),to_jsonb(m)->>'content',''),
    from_email=CASE WHEN m.channel='email' THEN COALESCE(NULLIF(m.from_email,''),to_jsonb(m)->>'from_address','') ELSE m.from_email END,
    to_email=CASE WHEN m.channel='email' THEN COALESCE(NULLIF(m.to_email,''),to_jsonb(m)->>'to_address','') ELSE m.to_email END,
    from_number=CASE WHEN m.channel<>'email' THEN COALESCE(m.from_number,to_jsonb(m)->>'from_address') ELSE m.from_number END,
    to_number=CASE WHEN m.channel<>'email' THEN COALESCE(m.to_number,to_jsonb(m)->>'to_address') ELSE m.to_number END;

  -- Retain opt-outs independently of the lead so deletion cannot erase them.
  INSERT INTO public.suppression_list(email_normalized,channel,reason,source,lead_id)
    SELECT lower(btrim(COALESCE(NULLIF(l.contact->>'email',''),l.email))),'email','opt_out','legacy_migration',l.id
    FROM public.leads l WHERE COALESCE((l.suppression->>'email')::boolean,false)
      AND NULLIF(btrim(COALESCE(NULLIF(l.contact->>'email',''),l.email)),'') IS NOT NULL;
  INSERT INTO public.suppression_list(phone_normalized,channel,reason,source,lead_id)
    SELECT regexp_replace(COALESCE(NULLIF(l.contact->>'phone',''),l.phone),'[^0-9]','','g'),'sms','opt_out','legacy_migration',l.id
    FROM public.leads l WHERE COALESCE((l.suppression->>'sms')::boolean,false)
      AND length(regexp_replace(COALESCE(NULLIF(l.contact->>'phone',''),l.phone),'[^0-9]','','g'))>=6;

  INSERT INTO public.app_records(collection,id,data) VALUES('schemaMigrations','20260914_supabase_only_runtime_legacy',jsonb_build_object('appliedAt',now()));
END $$;

CREATE INDEX IF NOT EXISTS outbound_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS outbound_leads_queue ON public.leads(status,deleted_at,locked_by);
CREATE INDEX IF NOT EXISTS outbound_calls_user_lead ON public.calls(user_id,lead_id);
CREATE INDEX IF NOT EXISTS outbound_calls_sid ON public.calls(call_sid);
CREATE INDEX IF NOT EXISTS outbound_messages_user_lead ON public.messages(user_id,lead_id);
CREATE INDEX IF NOT EXISTS outbound_messages_sid ON public.messages(message_sid);
CREATE INDEX IF NOT EXISTS outbound_activity_lead ON public.activity_logs(lead_id);
CREATE INDEX IF NOT EXISTS outbound_refresh_user ON public.refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS outbound_suppression_email ON public.suppression_list(email_normalized);
CREATE INDEX IF NOT EXISTS outbound_suppression_phone ON public.suppression_list(phone_normalized);

CREATE OR REPLACE FUNCTION public.ensure_app_record(p_collection text, p_id text, p_data jsonb)
RETURNS public.app_records LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.app_records;
BEGIN
  INSERT INTO public.app_records(collection,id,data) VALUES(p_collection,p_id,p_data) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.app_records WHERE collection=p_collection AND id=p_id;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.patch_app_record(p_collection text, p_id text, p_patch jsonb)
RETURNS public.app_records LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.app_records;
BEGIN
  UPDATE public.app_records SET data=data || p_patch || jsonb_build_object('updatedAt',now())
    WHERE collection=p_collection AND id=p_id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.increment_app_record(p_collection text, p_id text, p_field text, p_amount integer)
RETURNS public.app_records LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.app_records;
BEGIN
  UPDATE public.app_records SET data=jsonb_set(data,ARRAY[p_field],to_jsonb(COALESCE((data->>p_field)::integer,0)+p_amount))
    WHERE collection=p_collection AND id=p_id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.toggle_outbound_break(p_id text)
RETURNS public.app_records LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.app_records; elapsed integer;
BEGIN
  SELECT * INTO r FROM public.app_records WHERE collection='loginSessions' AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE((r.data->>'isOnBreak')::boolean,false) THEN
    elapsed := greatest(0,floor(extract(epoch FROM now()-COALESCE((r.data->>'breakStartedAt')::timestamptz,now())))::integer);
    r.data := r.data || jsonb_build_object('isOnBreak',false,'breakStartedAt',NULL,'lastActivityAt',now(),
      'breakTimeSeconds',COALESCE((r.data->>'breakTimeSeconds')::integer,0)+elapsed);
  ELSE r.data := r.data || jsonb_build_object('isOnBreak',true,'breakStartedAt',now()); END IF;
  UPDATE public.app_records SET data=r.data WHERE collection='loginSessions' AND id=p_id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.increment_outbound_inbox(p_id text, p_date text)
RETURNS public.app_records LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.app_records; counters jsonb; item jsonb; found_counter boolean := false; result jsonb := '[]';
BEGIN
  SELECT * INTO r FROM public.app_records WHERE collection='sendingInboxes' AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  counters := COALESCE(r.data->'dailyCounters','[]');
  FOR item IN SELECT value FROM jsonb_array_elements(counters) LOOP
    IF item->>'date'=p_date THEN
      item := item || jsonb_build_object('emailsSent',COALESCE((item->>'emailsSent')::integer,0)+1); found_counter := true;
    END IF;
    result := result || jsonb_build_array(item);
  END LOOP;
  IF NOT found_counter THEN result := result || jsonb_build_array(jsonb_build_object('date',p_date,'emailsSent',1)); END IF;
  UPDATE public.app_records SET data=jsonb_set(data,'{dailyCounters}',result)
    WHERE collection='sendingInboxes' AND id=p_id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.register_outbound_user(p_name text, p_email text, p_password text)
RETURNS public.users LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.users; first_user boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(80202026);
  SELECT NOT EXISTS(SELECT 1 FROM public.users) INTO first_user;
  INSERT INTO public.users(name,email,password,role,approved,active)
    VALUES(p_name,p_email,p_password,CASE WHEN first_user THEN 'owner' ELSE 'salesperson' END,first_user,true)
    RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.rotate_outbound_refresh(p_old_hash text, p_user uuid, p_version integer, p_new_hash text, p_new_jti text, p_expires timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE previous public.refresh_sessions; replacement uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id=p_user AND active=true AND approved=true AND token_version=p_version FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO previous FROM public.refresh_sessions WHERE token_hash=p_old_hash AND user_id=p_user
    AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.refresh_sessions(user_id,token_hash,refresh_token_jti,expires_at)
    VALUES(p_user,p_new_hash,p_new_jti,p_expires) RETURNING id INTO replacement;
  UPDATE public.refresh_sessions SET revoked_at=now(),last_used_at=now(),replaced_by=replacement WHERE id=previous.id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.claim_outbound_lead(p_user uuid)
RETURNS public.leads LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.leads;
BEGIN
  SELECT * INTO r FROM public.leads WHERE assigned_to IS NULL AND deleted_at IS NULL AND lower(status)='new'
    AND (locked_by IS NULL OR locked_at<now()-interval '5 minutes')
    ORDER BY priority DESC NULLS LAST,created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.leads SET assigned_to=p_user,locked_by=p_user,locked_at=now(),lock_heartbeat_at=now(),updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.lock_outbound_lead(p_lead uuid, p_user uuid)
RETURNS public.leads LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.leads;
BEGIN
  UPDATE public.leads SET locked_by=p_user,locked_at=now(),lock_heartbeat_at=now()
    WHERE id=p_lead AND deleted_at IS NULL AND (locked_by IS NULL OR locked_by::text=p_user::text OR locked_at<now()-interval '5 minutes') RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.patch_outbound_lead(p_identifier text, p_patch jsonb)
RETURNS public.leads LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.leads; merged public.leads;
BEGIN
  SELECT * INTO r FROM public.leads WHERE id::text=p_identifier OR _id=p_identifier FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO merged FROM jsonb_populate_record(r,p_patch || jsonb_build_object('data',r.data || COALESCE(p_patch->'data','{}')));
  UPDATE public.leads SET contact=merged.contact,company=merged.company,name=merged.name,email=merged.email,phone=merged.phone,
    city=merged.city,country=merged.country,timezone=merged.timezone,industry=merged.industry,niche=merged.niche,priority=merged.priority,
    stage=merged.stage,status=merged.status,assigned_to=merged.assigned_to,campaign_id=merged.campaign_id,notes=merged.notes,
    suppression=merged.suppression,tags=merged.tags,custom_context=merged.custom_context,data=merged.data,
    locked_by=merged.locked_by,locked_at=merged.locked_at,lock_heartbeat_at=merged.lock_heartbeat_at,
    deleted_at=merged.deleted_at,deleted_by=merged.deleted_by,deletion_reason=merged.deletion_reason,
    stage_updated_at=merged.stage_updated_at,last_activity_note=merged.last_activity_note,last_activity_at=merged.last_activity_at,updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.patch_outbound_blast(p_id uuid, p_patch jsonb)
RETURNS public.outbound_blast_campaigns LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.outbound_blast_campaigns; next_status text;
BEGIN
  SELECT * INTO r FROM public.outbound_blast_campaigns WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  next_status := COALESCE(p_patch->>'status',r.status);
  IF r.status IN ('completed','cancelled') AND next_status<>r.status THEN RAISE EXCEPTION 'Campaign is already terminal'; END IF;
  IF next_status<>r.status AND NOT (
    (next_status='paused' AND r.status IN ('queued','processing','running')) OR
    (next_status='queued' AND r.status IN ('draft','paused')) OR
    (next_status='cancelled' AND r.status NOT IN ('completed','cancelled'))
  ) THEN RAISE EXCEPTION 'Invalid campaign transition'; END IF;
  UPDATE public.outbound_blast_campaigns SET data=data || (p_patch-'status'),status=next_status,updated_at=now()
    WHERE id=p_id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.claim_outbound_blast(p_worker text)
RETURNS public.outbound_blast_campaigns LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.outbound_blast_campaigns;
BEGIN
  SELECT * INTO r FROM public.outbound_blast_campaigns WHERE status IN ('queued','processing')
    AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.outbound_blast_campaigns SET worker_id=p_worker,lease_until=now()+interval '2 minutes',status='processing',updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.checkpoint_outbound_blast(p_id uuid,p_worker text,p_patch jsonb,p_terminal_status text DEFAULT NULL)
RETURNS public.outbound_blast_campaigns LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.outbound_blast_campaigns;
BEGIN
  UPDATE public.outbound_blast_campaigns SET data=data || p_patch,
    status=CASE WHEN status='processing' AND p_terminal_status IS NOT NULL THEN p_terminal_status ELSE status END,
    lease_until=now()+interval '2 minutes',updated_at=now()
    WHERE id=p_id AND worker_id=p_worker AND lease_until>now() RETURNING * INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.release_outbound_blast(p_id uuid,p_worker text)
RETURNS void LANGUAGE sql SET search_path = public AS $$
  UPDATE public.outbound_blast_campaigns SET worker_id=NULL,lease_until=NULL WHERE id=p_id AND worker_id=p_worker;
$$;

-- Custom application JWTs are authorized by the API, not Supabase Auth.
-- Revoke broad policies from previous migrations. The service_role bypasses RLS.
DO $$ DECLARE item record; table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','leads','calls','campaigns','campaign_recipients','ai_email_generations','ai_usage_logs','messages','activity_logs','audit_logs','refresh_sessions','suppression_list','app_records','outbound_blast_campaigns','worker_health'] LOOP
    -- Older dedicated campaign/AI tables are optional; the runtime uses app_records.
    IF to_regclass(format('public.%I',table_name)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    FOR item IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=table_name LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',item.policyname,table_name);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',table_name);
  END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('ensure_app_record','patch_app_record','increment_app_record','toggle_outbound_break','increment_outbound_inbox','register_outbound_user','rotate_outbound_refresh','claim_outbound_lead','lock_outbound_lead','patch_outbound_lead','patch_outbound_blast','claim_outbound_blast','checkpoint_outbound_blast','release_outbound_blast') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',item.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',item.signature);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
