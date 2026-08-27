# 80/20 Outbound System — Enterprise Production Hardened

An enterprise-grade outbound sales dialer, multi-channel marketing platform, and salesperson workstation built on Next.js, Node.js, MongoDB, Twilio Voice WebRTC, Resend, and AI (OpenAI / Gemini).

---

## 🚀 Key Features & Upgrades

### 📧 1. Workstation Blast Email Center (`/workstation/blast-email`)
* **Salesperson Blast Capabilities**: Authorized salespeople can create, filter, personalize, test send, launch, pause, and monitor blast campaigns directly within their Salesperson Workstation.
* **Lead Scoping & Ownership**: Salespeople are restricted to blasting leads assigned to them or authorized for them.
* **Recipient Audit Breakdown**: Real-time pre-launch audit calculations for **Eligible**, **Suppressed**, **Missing Email**, and **Excluded** records.
* **Sending Identity Control**: Salespeople can select authorized sending identities without exposing raw API keys, passwords, or secrets.
* **AI Message Personalization**: Optional AI generation for intros and body text with tone controls (`professional`, `casual`, `urgent`).
* **Test Dispatching**: Instant test email sending capability before launching campaigns.
* **Safety & Double Confirmation**: Mandatory review flow and secondary confirmation dialog for large blasts (>100 leads).

### 🛡️ 2. RBAC & Security Hardening
* **Server-Side Authorization (`lib/middleware/authGuard.js`)**: Independent authentication and role enforcement on all API routes (`requireAuth`, `requireRole`, `canAccessResource`).
* **Secret Credential Sanitization (`lib/serializers.js`)**: Serializes models to strip `apiKey`, `smtpPassword`, and secret tokens before sending JSON to client applications.
* **Audit Trail (`lib/auditLogger.js`)**: Audit logs for security actions (campaign dispatches, role updates, user approvals) saved to `ActivityLog`.

### ⚙️ 3. Asynchronous Worker & Idempotency (`workers/blastWorker.js`)
* **Idempotency Safeguard**: Checks message logs before sending to prevent duplicate dispatches during worker restarts or retries (`blastCampaignId + leadId`).
* **Campaign Lifecycle States**: `draft`, `scheduled`, `queued`, `running`, `processing`, `paused`, `completed`, `cancelled`, `failed`.
* **Instant Pause & Cancel**: Honors mid-run pause and cancellation commands server-side.

### 🏥 4. Production Monitoring (`/api/health`)
* Standalone health monitoring endpoint returning database status, uptime, and system operational metrics.

---

## 🛠️ Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables (`.env`):**
   ```env
   MONGODB_URI=mongodb://localhost:27017/outbound
   JWT_SECRET=your_super_secret_jwt_key
   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_API_KEY=your_twilio_api_key
   TWILIO_API_SECRET=your_twilio_api_secret
   TWILIO_TWIML_APP_SID=your_twiml_app_sid
   RESEND_API_KEY=your_resend_api_key
   OPENAI_API_KEY=your_openai_api_key
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Run the background blast campaign worker:**
   ```bash
   node workers/blastWorker.js
   ```

5. **Check system health:**
   Navigate to `http://localhost:3000/api/health`
