-- 80/20 Outbound System: Lead Allocation & Pool Schema Update
-- Adds assigned_to tracking and performance indexes for pool allocation

BEGIN;

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

COMMIT;
