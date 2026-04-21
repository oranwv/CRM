require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const requireAuth     = require('./middleware/auth');
const authRoutes      = require('./routes/auth');
const leadsRoutes     = require('./routes/leads');
const usersRoutes     = require('./routes/users');
const whatsappRoutes  = require('./routes/whatsapp');
const filesRoutes     = require('./routes/files');
const analyticsRoutes = require('./routes/analytics');
const calendarRoutes  = require('./routes/calendar');

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
`).catch(err => console.error('[DB] Table check error:', err.message));

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use('/api/auth',      authRoutes);
app.use('/api/whatsapp',  whatsappRoutes);

// Protected
app.use('/api/leads',               requireAuth, leadsRoutes);
app.use('/api/leads/:leadId/files', requireAuth, filesRoutes);
app.use('/api/users',               requireAuth, usersRoutes);
app.use('/api/analytics',           requireAuth, analyticsRoutes);
app.use('/api/calendar',            requireAuth, calendarRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

  // Long-poll WhatsApp inbound messages continuously
  const { pollWhatsApp } = require('./services/whatsappPoller');
  pollWhatsApp(); // runs forever in a loop
  console.log('[Cron] WhatsApp polling started');

  // Run reminders every 30 minutes
  const { runReminders } = require('./services/reminderService');
  runReminders();
  setInterval(runReminders, 30 * 60 * 1000);
  console.log('[Cron] Reminder service started');
}
