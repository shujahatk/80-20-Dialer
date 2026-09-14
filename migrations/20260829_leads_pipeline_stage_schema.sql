-- 80/20 Outbound System: OneThread Visual Kanban Pipeline & Stage Lifecycle Schema
-- Adds 11-stage pipeline tracking, timestamps, activity notes, and performance indexes

BEGIN;

-- 1. Add stage column with strict check constraints
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'new_lead' 
CHECK (stage IN (
  'new_lead', 
  'contacted', 
  'call_1', 
  'call_2', 
  'call_3', 
  'call_4', 
  'qualified', 
  'appointment_booked', 
  'proposal_sent', 
  'follow_up', 
  'won', 
  'lost'
));

-- 2. Add timestamp tracking for last stage movement
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_activity_note TEXT DEFAULT NULL;

-- 3. High-performance index for fast column-by-column Kanban queries
CREATE INDEX IF NOT EXISTS idx_leads_stage_assigned ON leads(stage, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_stage_updated ON leads(stage_updated_at DESC);

COMMIT;
