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

const requireAuth         = require('./middleware/auth');
const authRoutes          = require('./routes/auth');
const leadsRoutes         = require('./routes/leads');
const usersRoutes         = require('./routes/users');
const whatsappRoutes      = require('./routes/whatsapp');
const filesRoutes         = require('./routes/files');
const fileDownloadRoutes  = require('./routes/fileDownload');
const analyticsRoutes     = require('./routes/analytics');
const calendarRoutes      = require('./routes/calendar');
const aiRoutes            = require('./routes/ai');

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
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_time VARCHAR(10);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
  ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'outbound';
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_via VARCHAR(20) DEFAULT 'app';
  ALTER TABLE files ADD COLUMN IF NOT EXISTS stored_name TEXT;
`).catch(err => console.error('[DB] Table check error:', err.message));

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use('/api/auth',      authRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/api/tasks',     require('./routes/taskPostpone'));

// Protected
app.use('/api/files',               requireAuth, fileDownloadRoutes);
app.use('/api/leads',               requireAuth, leadsRoutes);
app.use('/api/leads/:leadId/files', requireAuth, filesRoutes);
app.use('/api/users',               requireAuth, usersRoutes);
app.use('/api/analytics',           requireAuth, analyticsRoutes);
app.use('/api/ai',                  requireAuth, aiRoutes);
app.use('/api/calendar',            requireAuth, calendarRoutes);

// Serve uploaded files — 404 handler prevents missing files falling through to React SPA
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', (req, res) => res.status(404).send('File not found'));

// Serve React build
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CRM server running on port ${PORT}`);
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
}
