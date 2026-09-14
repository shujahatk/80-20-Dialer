-- 80/20 Outbound System: Advanced Operations Engine Schema
-- Lead Locking, Call Dispositions, Stage Lifecycle & Round-Robin Tracking

BEGIN;

-- 1. Add locking, attempts, and disqualification tracking to leads
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS locked_by TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS call_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS disqualification_reason TEXT DEFAULT NULL;

-- 2. Create call dispositions audit log table
CREATE TABLE IF NOT EXISTS call_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  _id TEXT,
  lead_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('no_answer', 'voicemail', 'meeting_booked', 'not_interested', 'no-answer', 'callback', 'wrong-number', 'dnc')),
  notes TEXT,
  disqualification_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. High-performance indexes for lock queries and disposition history
CREATE INDEX IF NOT EXISTS idx_leads_locked_by ON leads(locked_by, locked_at);
CREATE INDEX IF NOT EXISTS idx_dispositions_lead ON call_dispositions(lead_id);
CREATE INDEX IF NOT EXISTS idx_dispositions_user ON call_dispositions(user_id);
CREATE INDEX IF NOT EXISTS idx_dispositions_created ON call_dispositions(created_at DESC);

COMMIT;
