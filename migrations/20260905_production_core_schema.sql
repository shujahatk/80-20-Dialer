-- 80/20 Outbound System — Production Supabase / PostgreSQL Core Schema
-- Complete relational architecture for Leads, Campaigns, Persistent Queue, AI Generations, RBAC, and Audit Logging

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'salesperson', -- 'admin', 'manager', 'owner', 'salesperson'
    approved BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- 3. LEADS TABLE
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'NEW', -- 'NEW', 'CONTACTED', 'QUALIFIED', 'MEETING_BOOKED', 'UNRESPONSIVE', 'CLOSED_WON', 'DO_NOT_CONTACT'
    contact JSONB NOT NULL DEFAULT '{"name": "", "email": "", "phone": ""}'::jsonb,
    company JSONB NOT NULL DEFAULT '{"name": "", "industry": "", "website": ""}'::jsonb,
    suppression JSONB NOT NULL DEFAULT '{"email": false, "phone": false, "sms": false}'::jsonb,
    notes TEXT DEFAULT '',
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    custom_context TEXT DEFAULT '',
    locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. CAMPAIGNS TABLE
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'email', -- 'email', 'sms'
    created_by UUID REFERENCES users(id) ON DELETE CASCADE,
    template_subject TEXT DEFAULT '',
    template_body TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'completed', 'failed', 'paused', 'cancelled'
    stats JSONB NOT NULL DEFAULT '{"total": 0, "eligible": 0, "sent": 0, "failed": 0, "skipped": 0}'::jsonb,
    listmonk_campaign_id INTEGER,
    listmonk_list_id INTEGER,
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. CAMPAIGN RECIPIENTS (Persistent Queue & State Machine)
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT,
    company TEXT,
    listmonk_subscriber_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'sent', 'failed', 'skipped'
    scheduled_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    provider_message_id TEXT,
    error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_campaign_recipient UNIQUE (campaign_id, lead_id)
);

-- 6. AI EMAIL GENERATIONS TABLE (Claude 3.5 Sonnet Drafts)
CREATE TABLE IF NOT EXISTS ai_email_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
    goal TEXT DEFAULT 'Cold outreach',
    tone TEXT DEFAULT 'Professional',
    length TEXT DEFAULT 'Short',
    prompt_instructions TEXT DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    status TEXT NOT NULL DEFAULT 'generated', -- 'generated', 'approved', 'skipped', 'sent', 'generation_failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. AI USAGE LOGS TABLE (Telemetry & Token Accounting)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    model TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    status TEXT NOT NULL DEFAULT 'success',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. MESSAGES & DISPATCHES
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    message_sid TEXT,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent', -- 'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
    channel TEXT NOT NULL DEFAULT 'email', -- 'email', 'sms'
    direction TEXT NOT NULL DEFAULT 'outbound',
    provider TEXT NOT NULL DEFAULT 'resend', -- 'resend', 'listmonk', 'twilio'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'call', 'email', 'sms', 'status_change', 'note', 'ai_generation'
    channel TEXT DEFAULT 'email',
    direction TEXT DEFAULT 'outbound',
    outcome TEXT DEFAULT 'sent',
    notes TEXT,
    message_sid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. REFRESH SESSIONS & TOKEN ROTATION
CREATE TABLE IF NOT EXISTS refresh_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    refresh_token_jti TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    replaced_by UUID,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_locked_by ON leads(locked_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_camp_status ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_lead ON campaign_recipients(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_generations_camp ON ai_email_generations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ai_generations_lead ON ai_email_generations(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user ON ai_email_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_lead ON messages(user_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_sid ON messages(message_sid);
CREATE INDEX IF NOT EXISTS idx_activity_lead ON activity_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user_hash ON refresh_sessions(user_id, token_hash);

-- 13. ROW LEVEL SECURITY (RLS) ENFORCEMENT
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_email_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY service_role_all_leads ON leads FOR ALL USING (true);
CREATE POLICY service_role_all_campaigns ON campaigns FOR ALL USING (true);
CREATE POLICY service_role_all_recipients ON campaign_recipients FOR ALL USING (true);
CREATE POLICY service_role_all_ai ON ai_email_generations FOR ALL USING (true);
CREATE POLICY service_role_all_messages ON messages FOR ALL USING (true);
CREATE POLICY service_role_all_activities ON activity_logs FOR ALL USING (true);
CREATE POLICY service_role_all_sessions ON refresh_sessions FOR ALL USING (true);
