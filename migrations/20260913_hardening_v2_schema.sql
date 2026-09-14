-- 80/20 Outbound System — Production Hardening Migration (Phase 1 to Phase 7)
-- Supports Safe Lead Soft-Deletion, Permanent Suppression, Atomic Locks, and Campaign Idempotency

-- 1. EXTEND LEADS TABLE FOR SOFT DELETION & ATOMIC LOCKING
ALTER TABLE IF EXISTS leads 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS deletion_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lock_heartbeat_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
CREATE INDEX IF NOT EXISTS idx_leads_locked_by ON leads(locked_by);
CREATE INDEX IF NOT EXISTS idx_leads_locked_at ON leads(locked_at);

-- 2. DEDICATED PERMANENT SUPPRESSION TABLE (Survives Lead Deletion)
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_normalized TEXT,
    phone_normalized TEXT,
    channel TEXT NOT NULL DEFAULT 'all', -- 'all', 'email', 'phone', 'sms', 'whatsapp'
    reason TEXT DEFAULT 'opt_out',
    source TEXT DEFAULT 'system',
    lead_id UUID,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email_normalized);
CREATE INDEX IF NOT EXISTS idx_suppression_phone ON suppression_list(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_suppression_active ON suppression_list(active);

-- 3. CAMPAIGN RECIPIENTS IDEMPOTENCY & CRASH-RECOVERY EXTENSIONS
ALTER TABLE IF EXISTS campaign_recipients
ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS provider_message_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_recipients_idempotency ON campaign_recipients(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_recipients_reserved_at ON campaign_recipients(reserved_at);
CREATE INDEX IF NOT EXISTS idx_recipients_status ON campaign_recipients(status);

-- 4. ENABLE RLS FOR NEW TABLES
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_suppression ON suppression_list FOR ALL USING (true);
