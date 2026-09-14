-- ==============================================================================
-- 80/20 OUTBOUND SYSTEM: TWILIO VOICE & SMS ENTERPRISE SCHEMA MIGRATION
-- Adds support for WebRTC Browser Dialer, PSTN calls, SMS, status callbacks & idempotency
-- ==============================================================================

BEGIN;

-- 1. Hardening & Enhancements for `calls` table
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    _id TEXT,
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
    duration INTEGER DEFAULT 0,
    recording_url TEXT,
    recordingUrl TEXT,
    recording_sid TEXT,
    recordingSid TEXT,
    recording_duration INTEGER DEFAULT 0,
    recordingDuration INTEGER DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    notes TEXT,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    startTime TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist if table was already created
ALTER TABLE calls 
ADD COLUMN IF NOT EXISTS twilio_call_sid TEXT,
ADD COLUMN IF NOT EXISTS from_number TEXT,
ADD COLUMN IF NOT EXISTS to_number TEXT,
ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'outbound',
ADD COLUMN IF NOT EXISTS error_code TEXT,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Performance and Idempotency Indexes for calls
CREATE INDEX IF NOT EXISTS idx_calls_twilio_call_sid ON calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_call_sid ON calls(call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);

-- 2. Hardening & Enhancements for `messages` table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS twilio_message_sid TEXT,
ADD COLUMN IF NOT EXISTS from_number TEXT,
ADD COLUMN IF NOT EXISTS to_number TEXT,
ADD COLUMN IF NOT EXISTS error_code TEXT,
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Performance and Idempotency Indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_twilio_message_sid ON messages(twilio_message_sid);
CREATE INDEX IF NOT EXISTS idx_messages_message_sid ON messages(message_sid);
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

COMMIT;
