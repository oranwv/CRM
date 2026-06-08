require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// On Railway: reconstruct Google credential files from base64 env vars
if (process.env.GOOGLE_CREDENTIALS_B64) {
  fs.writeFileSync(
    path.join(__dirname, 'credentials.json'),
    Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf-8')
  );
}
if (process.env.GOOGLE_TOKEN_B64) {
  fs.writeFileSync(
    path.join(__dirname, 'google_token.json'),
    Buffer.from(process.env.GOOGLE_TOKEN_B64, 'base64').toString('utf-8')
  );
}
// Alternative: build token file from plain GOOGLE_REFRESH_TOKEN env var (simpler, no encoding)
if (process.env.GOOGLE_REFRESH_TOKEN && !process.env.GOOGLE_TOKEN_B64) {
  fs.writeFileSync(
    path.join(__dirname, 'google_token.json'),
    JSON.stringify({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN, token_type: 'Bearer' })
  );
}

const requireAuth           = require('./middleware/auth');
const authRoutes            = require('./routes/auth');
const leadsRoutes           = require('./routes/leads');
const usersRoutes           = require('./routes/users');
const whatsappRoutes        = require('./routes/whatsapp');
const filesRoutes           = require('./routes/files');
const fileDownloadRoutes    = require('./routes/fileDownload');
const analyticsRoutes       = require('./routes/analytics');
const calendarRoutes        = require('./routes/calendar');
const aiRoutes              = require('./routes/ai');
const adminRoutes           = require('./routes/admin');
const priceOfferRoutes      = require('./routes/priceOffer');
const { contractLeadRouter, contractPublicRouter } = require('./routes/contracts');
const driveRoutes               = require('./routes/drive');
const { debugHandler: driveDebugHandler } = require('./routes/drive');
const productionChecklistRoutes = require('./routes/productionChecklist');
const eventBriefRoutes          = require('./routes/eventBrief');
const rsvpRoutes                = require('./routes/rsvp');
const operationsRoutes          = require('./routes/operations');
const chatRoutes                = require('./routes/chat');

const pool = require('./db/pool');

// Ensure runtime tables exist (safe to run every boot)
pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    body TEXT,
    external_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS processed_emails (
    gmail_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE;
  ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_sent_at TIMESTAMPTZ;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_event_id TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_rsvp_status VARCHAR(20);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_date DATE;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_confirmed BOOLEAN DEFAULT FALSE;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS production_notes TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(50);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason_text TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_time TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_end_time TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_date_text TEXT;
  ALTER TABLE leads ALTER COLUMN event_time TYPE TEXT;
  ALTER TABLE leads ALTER COLUMN event_end_time TYPE TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
  ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'outbound';
  ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS source VARCHAR(20);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE;
  UPDATE users SET roles = ARRAY[role]::TEXT[] WHERE array_length(roles, 1) IS NULL;
  ALTER TABLE op_tasks ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE op_faults ADD COLUMN IF NOT EXISTS notes TEXT;
  CREATE TABLE IF NOT EXISTS op_maintenance_history (
    id SERIAL PRIMARY KEY,
    maintenance_id INT REFERENCES op_maintenance(id) ON DELETE CASCADE,
    done_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    done_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_via VARCHAR(20) DEFAULT 'app';
  ALTER TABLE files ADD COLUMN IF NOT EXISTS stored_name TEXT;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  INSERT INTO settings (key, value) VALUES ('ai_instructions', '')
    ON CONFLICT (key) DO NOTHING;
  CREATE TABLE IF NOT EXISTS lead_contacts (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('phone', 'email')),
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_value TEXT;
  ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS html_link TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
  CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    google_event_id TEXT,
    title TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    location TEXT DEFAULT 'שרביה, פנחס בן יאיר 3, תל אביב',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS confirm_token TEXT;
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_by INT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_name VARCHAR(255);
  UPDATE leads SET event_name = name WHERE event_name IS NULL;
  CREATE TABLE IF NOT EXISTS price_offers (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    fields JSONB NOT NULL,
    rows JSONB NOT NULL,
    offer_type TEXT NOT NULL DEFAULT 'regular',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    contract_data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    signed_at TIMESTAMPTZ,
    signer_name TEXT,
    signer_id_number TEXT,
    signature_image TEXT,
    signed_pdf_url TEXT
  );
  ALTER TABLE price_offers ADD COLUMN IF NOT EXISTS includes JSONB DEFAULT '[]'::jsonb;
  INSERT INTO settings (key, value) VALUES ('staff_signature', '')
    ON CONFLICT (key) DO NOTHING;
`).catch(err => console.error('[DB] Table check error:', err.message));

pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS orderer_name TEXT`)
  .catch(err => console.error('[DB] orderer_name migration error:', err.message));

pool.query(`ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS label TEXT`)
  .catch(err => console.error('[DB] lead_contacts label migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS production_checklist (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    item_key VARCHAR(100) NOT NULL,
    checked_at TIMESTAMPTZ,
    checked_by INT REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(lead_id, item_key)
  );
  CREATE TABLE IF NOT EXISTS event_briefs (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by INT REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(lead_id)
  );
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS remaining_balance_override NUMERIC;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS remaining_balance_override_by INT REFERENCES users(id);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS remaining_balance_override_at TIMESTAMPTZ;
`).catch(err => console.error('[DB] production tables migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS seating_layouts (
    id         SERIAL PRIMARY KEY,
    lead_id    INT REFERENCES leads(id) ON DELETE CASCADE,
    section    VARCHAR(20) NOT NULL,
    elements   JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lead_id, section)
  );
`).catch(err => console.error('[DB] seating_layouts migration error:', err.message));

pool.query(`
  ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
  ALTER TABLE leads ADD CONSTRAINT leads_stage_check
    CHECK (stage IN ('new','contacted','meeting_scheduled','meeting',
                     'offer_sent','negotiation','contract_sent',
                     'deposit','production','completed','lost'));
`).catch(err => console.error('[DB] stage constraint migration error:', err.message));

pool.query(`
  ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
  ALTER TABLE leads ADD CONSTRAINT leads_source_check
    CHECK (source IN ('website_popup','website_form','call_event','telekol','vonage','whatsapp','facebook','instagram','manual'));
`).catch(err => console.error('[DB] source constraint migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS google_calendar_cache (
    google_event_id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    all_day BOOLEAN DEFAULT FALSE,
    color_id TEXT,
    html_link TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error('[DB] google_calendar_cache migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS supplier_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0
  );
  INSERT INTO supplier_categories (name, sort_order) VALUES
    ('קייטרינג/שף', 0), ('צלמים', 1), ('מלצרים', 2), ('ברמנים', 3),
    ('שומרים', 4), ('נקיון', 5), ('כללי', 6), ('מפיקים', 7)
  ON CONFLICT (name) DO NOTHING;
  CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT 'כללי',
    created_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS lead_suppliers (
    id SERIAL PRIMARY KEY,
    lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
    supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
    UNIQUE(lead_id, supplier_id)
  );
  CREATE TABLE IF NOT EXISTS supplier_files (
    id SERIAL PRIMARY KEY,
    supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100),
    uploaded_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS supplier_interactions (
    id SERIAL PRIMARY KEY,
    supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    direction VARCHAR(10) DEFAULT 'outbound',
    body TEXT,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error('[DB] suppliers migration error:', err.message));

pool.query(`
  ALTER TABLE supplier_interactions ADD COLUMN IF NOT EXISTS file_id INT REFERENCES supplier_files(id) ON DELETE SET NULL;
  ALTER TABLE supplier_files ADD COLUMN IF NOT EXISTS source VARCHAR(50)
`).catch(err => console.error('[DB] supplier interactions/files column migration error:', err.message));

pool.query(`
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sug VARCHAR(255);
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment VARCHAR(255)
`).catch(err => console.error('[DB] suppliers sug/payment column migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS op_tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS op_checklists (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE op_checklists ADD COLUMN IF NOT EXISTS item_notes JSONB DEFAULT '{}';
  CREATE TABLE IF NOT EXISTS op_checklist_runs (
    id SERIAL PRIMARY KEY,
    checklist_id INT REFERENCES op_checklists(id) ON DELETE CASCADE,
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    items_state JSONB NOT NULL DEFAULT '[]',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS op_maintenance (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    interval_days INT NOT NULL,
    last_done DATE,
    next_due DATE,
    assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS op_faults (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    reported_by INT REFERENCES users(id) ON DELETE SET NULL,
    assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  );
`).catch(err => console.error('[DB] operations tables migration error:', err.message));

pool.query(`ALTER TABLE op_maintenance ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'`)
  .catch(err => console.error('[DB] op_maintenance status migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS op_activity_log (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INT NOT NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'note',
    body TEXT,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS op_reminders (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INT NOT NULL,
    title TEXT NOT NULL,
    due_date DATE,
    assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
    done BOOLEAN DEFAULT FALSE,
    done_at TIMESTAMPTZ,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(err => console.error('[DB] op_activity_log/reminders migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS rsvp_campaigns (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES leads(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    host_name TEXT,
    event_date DATE,
    event_time TEXT,
    venue_address TEXT,
    template_name TEXT DEFAULT 'rsvp_invitation',
    reminder_template_name TEXT DEFAULT 'rsvp_reminder',
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS rsvp_guests (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES rsvp_campaigns(id) ON DELETE CASCADE,
    name TEXT,
    phone TEXT NOT NULL,
    state TEXT DEFAULT 'not_sent' CHECK (state IN ('not_sent','invited','awaiting_count','confirmed','declined')),
    guest_count INT,
    invited_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(campaign_id, phone)
  );
  CREATE TABLE IF NOT EXISTS rsvp_messages (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES rsvp_campaigns(id) ON DELETE CASCADE,
    guest_id INT REFERENCES rsvp_guests(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    body TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(err => console.error('[DB] RSVP tables migration error:', err.message));

pool.query(`
  ALTER TABLE op_reminders ADD COLUMN IF NOT EXISTS due_time TEXT;
  ALTER TABLE op_reminders ADD COLUMN IF NOT EXISTS remind_sent_at TIMESTAMPTZ;
`).catch(err => console.error('[DB] op_reminders migration error:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS ai_knowledge_files (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    content_text TEXT NOT NULL,
    uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(err => console.error('[DB] ai_knowledge_files migration error:', err.message));

const { pollGoogleCalendar } = require('./services/calendarPollService');
pollGoogleCalendar();
setInterval(pollGoogleCalendar, 5 * 60 * 1000);

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use('/api/auth',      authRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/api/rsvp',      rsvpRoutes);  // webhook endpoints inside are public; auth applied per-route
app.use('/api/tasks',     require('./routes/tasks'));       // global task list (auth per-route)
app.use('/api/tasks',     require('./routes/taskPostpone')); // public postpone links (WhatsApp)

// Protected
app.use('/api/files',               requireAuth, fileDownloadRoutes);
app.use('/api/leads/:id/price-offer', requireAuth, priceOfferRoutes);
app.use('/api/leads/:id/contracts',   requireAuth, contractLeadRouter);
app.use('/api/contracts',             contractPublicRouter);
app.use('/api/leads/:id/production-checklist', requireAuth, productionChecklistRoutes);
app.use('/api/leads/:id/event-brief',          requireAuth, eventBriefRoutes);
app.use('/api/leads',               requireAuth, leadsRoutes);
app.use('/api/leads/:leadId/files', requireAuth, filesRoutes);
app.use('/api/admin',               requireAuth, adminRoutes);
app.get('/api/drive/debug',         driveDebugHandler);
app.use('/api/drive',               requireAuth, driveRoutes);
app.use('/api/users',               requireAuth, usersRoutes);
app.use('/api/analytics',           requireAuth, analyticsRoutes);
app.use('/api/suppliers',           requireAuth, require('./routes/suppliers'));
app.use('/api/operations',          requireAuth, operationsRoutes);
app.use('/api/greeninvoice',        requireAuth, require('./routes/greeninvoice'));
app.use('/api/ai',                  requireAuth, aiRoutes);
app.use('/api/chat',               chatRoutes);  // auth applied inside route
app.use('/api/calendar', (req, res, next) => {
  // ICS download and lead confirmation are public — no auth required
  if (/^\/meetings\/[^/]+\/(ics|confirm)$/.test(req.path)) return next();
  requireAuth(req, res, next);
}, calendarRoutes);

// Serve uploaded files — 404 handler prevents missing files falling through to React SPA
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', (req, res) => res.status(404).send('File not found'));

// Serve React build
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`CRM server running on port ${PORT}`);
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='google_token'");
    if (rows[0]?.value) fs.writeFileSync(path.join(__dirname, 'google_token.json'), rows[0].value);
  } catch {}
  startCronJobs();
});

function startCronJobs() {
  const tokenPath = path.join(__dirname, 'google_token.json');
  const hasGoogle = fs.existsSync(tokenPath);

  // Poll Gmail every 10 minutes
  if (hasGoogle) {
    const { pollGmail } = require('./services/gmailService');
    pollGmail(); // run immediately on start
    setInterval(pollGmail, 10 * 60 * 1000);
    console.log('[Cron] Gmail polling started');

    // Sync Drive folders every 5 minutes
    const { syncDriveFolders } = require('./services/driveService');
    syncDriveFolders().catch(err => console.error('[Drive sync] initial run error:', err.message));
    setInterval(() => syncDriveFolders().catch(e => console.error('[Drive sync]', e.message)), 5 * 60 * 1000);
    console.log('[Cron] Drive folder sync started');
  } else {
    console.log('[Cron] Gmail skipped — no google_token.json');
  }

  // WhatsApp: use webhook when SERVER_URL is set (production), otherwise long-poll (local dev)
  if (process.env.SERVER_URL) {
    const axios = require('axios');
    const base  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}`;
    const token = process.env.GREEN_API_TOKEN;
    axios.post(`${base}/setSettings/${token}`, {
      webhookUrl: `${process.env.SERVER_URL}/api/whatsapp/webhook`,
      incomingWebhook: 'yes',
      outgoingWebhook: 'no',
      outgoingMessageWebhook: 'yes',
      stateWebhook: 'no',
      sendFromUTC: 'yes',
    }).then(() => console.log('[WhatsApp] Webhook registered:', process.env.SERVER_URL))
      .catch(err => console.error('[WhatsApp] Webhook registration failed:', err.message));
  } else {
    const { pollWhatsApp } = require('./services/whatsappPoller');
    pollWhatsApp();
    console.log('[Cron] WhatsApp polling started (local)');
  }

  // Run reminders every 30 minutes (2min delay on start to avoid re-firing on server restart)
  const { runReminders } = require('./services/reminderService');
  setTimeout(() => {
    runReminders();
    setInterval(runReminders, 2 * 60 * 1000);
  }, 30 * 1000);
  console.log('[Cron] Reminder service started');

  // WhatsApp message recovery — scan last 24h every 30 minutes, import anything the webhook missed
  const { syncWhatsAppMessages } = require('./services/waSyncService');
  setTimeout(() => {
    syncWhatsAppMessages();
    setInterval(syncWhatsAppMessages, 30 * 60 * 1000);
  }, 2 * 60 * 1000); // 2-minute startup delay
  console.log('[Cron] WhatsApp sync service started');

  // Meeting reminders — send WhatsApp 2 days before scheduled meeting, hourly check
  const { sendMeetingReminders } = require('./services/meetingReminderService');
  setTimeout(() => {
    sendMeetingReminders();
    setInterval(sendMeetingReminders, 60 * 60 * 1000);
  }, 2 * 60 * 1000);
  console.log('[Cron] Meeting reminder service started');
}
