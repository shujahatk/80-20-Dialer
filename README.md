# 80/20 Outbound System

An outbound sales workstation and manager dashboard built with Next.js, React, Supabase PostgreSQL, Twilio, Resend, Listmonk, and Anthropic.

Supabase is the only application database. There is no MongoDB connection, local JSON fallback, or successful mock delivery. Server queries require SUPABASE_SERVICE_ROLE_KEY; never expose that key through NEXT_PUBLIC variables.

## Setup

1. Install dependencies with npm install (Node.js 24 is used for the isolated tests).
2. Configure .env using .env.example.
3. Run the entire migrations/20260914_supabase_only_runtime.sql file in the Supabase SQL editor. It is a standalone, transactional migration for a fresh database, the legacy four-table schema, and databases with the older core/hardening/Twilio migrations. You do not need to rerun those older migrations. The runtime migration adds missing tables and columns before creating RPCs, preserves legacy contacts, messages, assignments and opt-outs, and is safe to rerun. Back up the database before applying schema changes.
4. Run npm run dev.
5. Start the blast worker separately with npm run worker. Run it under a process supervisor in production.
6. For production, run npm run build followed by npm start.

The runtime migration restricts tables and RPCs to the service_role. Application JWT authorization and ownership checks happen in API routes. Pipeline updates refresh through authenticated API readers every 10 seconds and immediately through local browser broadcasts; the browser does not have anonymous access to lead records.

## Campaign delivery

Manager and salesperson blasts are queued in outbound_blast_campaigns. The worker claims campaigns atomically with a database lease, persists recipient reservations before dispatch, and checkpoints delivery results before secondary logging. Pause and cancellation are checked before each send. Requests already in flight can finish.

Resend requests use a stable HTTP Idempotency-Key and a persisted immutable payload. Resend retains keys for 24 hours; the worker uses a conservative 23-hour retry window and at most three attempts. SMS deliveries with an uncertain result are never automatically replayed. Uncertain deliveries produce needs_review campaigns and unknown recipients. Reconcile these against provider logs before creating a replacement campaign.

Listmonk remains available for subscriber synchronization and settings. Blast creation uses the worker dispatch path and does not launch a second provider campaign.

## Authentication

Access JWTs expire after 15 minutes. Refresh JWTs expire after seven days and are stored as hashes in refresh_sessions. Rotation atomically revokes the old refresh token. Refresh tokens cannot authenticate ordinary API routes. Account approval, active status, and token_version are checked against Supabase.

The browser refreshes and retries expired authenticated API requests. Refresh cookies are HttpOnly and SameSite=Lax. Set APP_URL to the public origin when running behind a reverse proxy. Logout revokes the refresh token and clears cookies; password changes revoke existing access and refresh tokens through token_version.

## Verification and monitoring

- npm test runs isolated regression tests with mocked HTTP/providers and a local PostgreSQL engine for migration tests. It never uses .env, mutates live Supabase records, or sends messages. The migration tests cover the legacy, fresh, and prior-migration schemas, data preservation, reruns, permissions, and runtime RPCs.
- npm run lint checks source.
- npm run build checks the production bundle.
- GET /api/health returns 200 only when database queries succeed, authentication/email configuration is valid, and a worker heartbeat is fresh. Dependency failure returns 503. Telephony and AI fields indicate configuration, not provider connectivity.
- Legacy scripts/test_*.js mutate data and some invoke providers. They are excluded from npm test and require an explicit integration-test opt-in and a separate test Supabase project. Their historical fixtures require adaptation to UUID-based records before use.

Older data/store.json files are not loaded. scripts/migrate_local_records.js defaults to a dry run; its --apply mode copies ancillary local records to Supabase and holds imported campaigns for review. It never provisions users or imports core lead records. Resolve core users/leads in Supabase first.

Seed and cleanup scripts require an explicit --apply flag and configured Supabase credentials. Seed passwords must be supplied in SEED_PASSWORD or ADMIN_PASSWORD. No default passwords or secrets are printed.
