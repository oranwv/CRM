# Sharabiya CRM — Product Requirements Document

> **Last updated:** 2026-04-25
> **Live at:** https://www.proevent.co.il
> **Hosting:** Railway (auto-deploy from GitHub `main` branch)
> **DB + Storage:** Supabase (PostgreSQL + Storage bucket `crm-files`)

---

## Product Overview

A custom CRM for Sharabiya, an event venue at פנחס בן יאיר 3, תל אביב. Manages the full lifecycle from first lead inquiry through signed contract and event production. Mobile-first, Hebrew RTL, multi-user, with automatic lead capture from all channels and AI assistance for messaging.

---

## Users & Roles

- Multiple staff members (sales + production team)
- All leads visible to everyone
- Each lead has an assigned owner
- Every action attributed to the logged-in user (name shown on all entries)
- Roles: **admin** / **sales** / **production**
- Admin can delete leads; all roles can create and interact

---

## Infrastructure & Environment Variables

### Railway Environment Variables (required)
| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT auth tokens + task action tokens |
| `GREEN_API_URL` | Green API base URL (e.g. https://api.green-api.com) |
| `GREEN_API_INSTANCE` | Green API instance ID |
| `GREEN_API_TOKEN` | Green API token |
| `SERVER_URL` | Public URL of the server (e.g. https://www.proevent.co.il) — triggers webhook mode |
| `GOOGLE_CREDENTIALS_B64` | Base64-encoded `credentials.json` (Google OAuth app credentials) |
| `GOOGLE_TOKEN_B64` | Base64-encoded `google_token.json` (Google OAuth refresh token) |
| `ANTHROPIC_API_KEY` | Claude API key for AI features (translate / reply / improve) |
| `SUPABASE_URL` | Supabase project URL (e.g. https://xxx.supabase.co) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key — used server-side only for storage operations |

### Google Credential Reconstruction
On every server boot, `server/index.js` reconstructs `credentials.json` and `google_token.json` from the base64 env vars so the Google APIs (Gmail, Calendar) work on Railway's ephemeral filesystem.

---

## Lead Sources

| Source | Channel | Auto/Manual |
|---|---|---|
| Website popup form | Email — subject "הודעה חדשה פופאפ" | Auto |
| Website contact form | Email — subject "פנייה חדשה מאתר שרביה" | Auto |
| Call Event supplier | Email from info@hafakot.co.il | Auto |
| Telekol voicemail | Email from telekol@telekol.co.il | Auto |
| WhatsApp | Green API webhook (production) / long-poll (local dev) | Auto |
| Facebook Messenger | Meta Graph API webhook | Planned |
| Instagram DM | Meta Graph API webhook | Planned |
| Manual entry | CRM form | Manual |

**Match rule:** Normalize phone to E.164 Israeli format (remove non-digits, replace leading 0 with 972). If phone matches existing lead → attach as interaction. If unknown → create new lead at stage `new`.

**Deduplication:** All incoming WhatsApp messages checked against `messages.external_id` before insert.

---

## Email Parsing (`server/services/gmailService.js`)

Gmail is polled every 10 minutes. Each email is parsed, a lead is created or matched, and an inbound `lead_interactions` row is inserted with the real Gmail `internalDate`.

### Call Event (info@hafakot.co.il — subject contains "CALL EVENT")
- Name: line after `להלן פרטי הליד:` before `מתעניין`
- Phone: `טלפון: {value}`
- Email: `מייל: {value}`
- Guest count: `כמות מוזמנים: {value}`
- Event type: `סוג האירוע: {value}`

### Website Popup (subject contains "הודעה חדשה פופאפ")
- Uses line-position parsing: finds "אני" line, name = next line, phone = line after
- Fallback: first two valid lines before "---" separator

### Website Contact Form (subject contains "פנייה חדשה מאתר שרביה")
- Name: `שם מלא: {value}`
- Phone: `טלפון: {value}`
- Notes: `פרטי הפנייה: {value}`

### Telekol (subject contains "טלקול")
- Phone: regex `/מספר טלפון לחזרה\s*(\d[\d\-]+)/`
- Name: `שם הפונה : {value}`
- Event type: `סוג אירוע: {value}`

---

## Pipeline Stages

| # | Key | Hebrew | Auto-advance |
|---|---|---|---|
| 1 | new | חדש | → contacted automatically on first outbound WhatsApp, email, or logged interaction |
| 2 | contacted | יצירת קשר | Manual |
| 3 | meeting | פגישה | Manual |
| 4 | offer_sent | הצעת מחיר | Manual |
| 5 | negotiation | מו"מ | Manual |
| 6 | contract_sent | חוזה נשלח | Manual |
| 7 | deposit | מקדמה | Manual |
| 8 | production | הפקה | Manual |
| — | lost | לא סגרו | Manual — requires reason |

### Stage Change Audit Trail
Every manual stage change via `PATCH /api/leads/:id` is logged as a `note` interaction in the timeline:
`🔄 שינוי שלב: {from} ← {to}` with `created_by = req.user.id`

Auto-advances (new→contacted) are NOT logged — they are system-triggered, not user-initiated.

### Lost Reasons
`מחיר/תקציב` | `תאריך תפוס` | `בחר מתחרה` | `נעלם` | `שינוי תוכניות` | `אחר` + free-text field

---

## Data Model

### leads
```
id SERIAL PRIMARY KEY
name VARCHAR(255)
phone VARCHAR(50)
email VARCHAR(255)
event_date DATE
event_time VARCHAR(10)
event_type VARCHAR(100)
guest_count INT
budget NUMERIC
source VARCHAR(50)           -- website_popup | website_form | call_event | telekol | whatsapp | facebook | instagram | manual
stage VARCHAR(30)            -- see pipeline above
lost_reason VARCHAR(50)
lost_reason_text TEXT
priority VARCHAR(20)         -- normal | hot | urgent
assigned_to INT → users.id
notes TEXT
avatar_url VARCHAR(500)
deposit_amount NUMERIC
deposit_date DATE
deposit_confirmed BOOLEAN DEFAULT FALSE
production_notes TEXT
meeting_event_id TEXT        -- Google Calendar event ID for scheduled meeting
meeting_rsvp_status VARCHAR(20) -- needsAction | accepted | declined | tentative
created_by INT → users.id
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### lead_interactions
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
type VARCHAR(30)             -- call | meeting | note | email | whatsapp | facebook | instagram
direction VARCHAR(10)        -- inbound | outbound
body TEXT
is_read BOOLEAN DEFAULT TRUE
created_by INT → users.id    -- NULL for system/auto entries
created_at TIMESTAMPTZ
```

### messages
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
channel VARCHAR(20)          -- whatsapp
direction VARCHAR(10)        -- inbound | outbound
body TEXT                    -- plain text, or [[FILE:id|name]] for media
external_id TEXT             -- Green API message ID (dedup key)
is_read BOOLEAN DEFAULT TRUE
timestamp TIMESTAMPTZ
```

### tasks
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
title TEXT
due_at TIMESTAMPTZ
remind_via VARCHAR(20)       -- app | whatsapp
remind_sent_at TIMESTAMPTZ   -- set atomically when reminder fires; NULL = not yet sent
result TEXT
completed_at TIMESTAMPTZ
assigned_to INT → users.id
created_by INT → users.id
created_at TIMESTAMPTZ
```

### files
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
filename VARCHAR(500)
url VARCHAR(500)             -- empty string (legacy field; access via signed URL endpoint)
stored_name TEXT             -- Supabase Storage object key (e.g. "1745123456789-847291.pdf")
file_type VARCHAR(100)
uploaded_by INT → users.id   -- NULL for files auto-created from inbound WA media
created_at TIMESTAMPTZ
```

### calendar_events
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
google_event_id TEXT
type VARCHAR(20)             -- option | confirmed
event_date DATE
created_by INT → users.id
created_at TIMESTAMPTZ
```

### users
```
id SERIAL PRIMARY KEY
username VARCHAR(100) UNIQUE
display_name VARCHAR(200)
password_hash TEXT
role VARCHAR(20)             -- admin | sales | production
phone VARCHAR(50)
created_at TIMESTAMPTZ
```

### processed_emails
```
gmail_id TEXT PRIMARY KEY
processed_at TIMESTAMPTZ
```

---

## Data Persistence Requirements

All data is stored permanently. Railway's filesystem is ephemeral (lost on redeploy) — all persistent data goes to Supabase.

| Data type | Storage location | Notes |
|---|---|---|
| Lead info | `leads` table (Supabase PostgreSQL) | Never on filesystem |
| WhatsApp text messages | `messages` table | Inbound + outbound |
| WhatsApp media (images/docs/audio/video) | `messages` table + `files` table + Supabase Storage | Downloaded from Green API, uploaded to `crm-files` bucket |
| Email conversations | `lead_interactions` table | Inbound via Gmail poll, outbound via send route |
| Call/meeting/note logs | `lead_interactions` table | Created via interactions POST |
| Stage changes | `lead_interactions` table | Auto-logged on every manual stage change |
| Task completions + results | `tasks` table + `lead_interactions` (result note) | |
| Task reschedules | `tasks` table + `lead_interactions` (reschedule note) | |
| Deposit / מקדמה info | `leads` table (deposit_amount, deposit_date, deposit_confirmed) | |
| Production notes | `leads` table (production_notes) | |
| Uploaded files | `files` table + Supabase Storage (`crm-files` bucket) | Private bucket, served via signed URLs |
| Email attachments | `files` table + Supabase Storage | Uploaded when email is sent with attachment |

---

## File Storage (`server/services/storageService.js`)

All files stored in **Supabase Storage, private bucket `crm-files`**. Files are never stored on Railway's filesystem.

### Security model
- Bucket is **private** — no public access to any file URL
- `SUPABASE_SERVICE_KEY` (server-side only) used for all upload/delete/sign operations
- To open a file, the frontend calls an authenticated CRM endpoint which generates a **60-second signed URL**
- Without a valid CRM login, no signed URL can be obtained

### Functions (`storageService.js`)
- `uploadFile(filePath, originalName, mimetype)` → `{ url, storedName }` — uploads buffer to Supabase, returns `storedName` (storage object key)
- `deleteFile(url)` — removes object from bucket
- `getSignedUrl(storedName, expiresIn=60)` → signed URL string

### File access endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/files/:fileId/url` | Bearer token | Returns 60-second signed URL for any file by ID |
| GET | `/api/leads/:leadId/files/:fileId/url` | Bearer token | Same, scoped to lead |

### `[[FILE:id|name]]` marker syntax
Files embedded in interaction/message bodies use this format where `id` is the `files.id` integer. The frontend's `BodyWithFile` component parses this and calls `openFile(id)` which fetches the signed URL then opens it.

---

## API Routes

### Auth (`/api/auth`)
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Returns JWT token |

### Leads (`/api/leads`) — all require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List leads by tab (new/in_process/closed/lost) + search |
| GET | `/:id` | Single lead with assigned_name, created_by_name |
| POST | `/` | Create lead manually |
| PATCH | `/:id` | Update any allowed field. Logs stage change to timeline if stage changes |
| DELETE | `/:id` | Admin only |
| POST | `/:id/read` | Mark all inbound messages + interactions as read |
| GET | `/:id/interactions` | Interaction timeline |
| POST | `/:id/interactions` | Log interaction (auto-advances new→contacted if outbound) |
| GET | `/:id/tasks` | List tasks |
| POST | `/:id/tasks` | Create task |
| PATCH | `/:id/tasks/:taskId/complete` | Complete task + log result as note |
| PATCH | `/:id/tasks/:taskId/reschedule` | Reschedule task |
| POST | `/:id/email/send` | Send email via Gmail API + upload attachment to Supabase |
| GET | `/:id/messages` | WhatsApp messages |

### WhatsApp (`/api/whatsapp`) — webhook is public, send requires auth
| Method | Path | Description |
|---|---|---|
| POST | `/webhook` | Receives Green API webhook. Handles text + media (imageMessage, documentMessage, audioMessage, videoMessage). Media downloaded and uploaded to Supabase. |
| POST | `/send` | Send text message (auto-advances new→contacted) |
| POST | `/send-file` | Send file: upload to Green API → Supabase → insert into files table → embed [[FILE:id\|name]] in message |

### Files (`/api/leads/:leadId/files`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List files for lead |
| POST | `/` | Upload file to Supabase Storage, save stored_name to DB |
| DELETE | `/:fileId` | Delete file from DB + Supabase Storage |
| GET | `/:fileId/url` | Return 60-second signed URL |

### File Download (`/api/files`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/:fileId/url` | Return 60-second signed URL (general — used by timeline [[FILE:]] markers) |

### Tasks — public (token-validated JWT)
| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks/:taskId/postpone-info?token=` | Returns task title + lead name for action page |
| POST | `/api/tasks/:taskId/postpone` | Reschedule task: `{ token, minutes }` or `{ token, dueAt }`. Resets `remind_sent_at`. |
| POST | `/api/tasks/:taskId/complete` | Complete task: `{ token, result? }`. Logs result to timeline. |
| POST | `/api/tasks/:taskId/create-followup` | Create follow-up task: `{ token, title, dueAt? }`. Inherits lead_id, assigned_to, remind_via. |

### Calendar (`/api/calendar`) — all require auth
| Method | Path | Description |
|---|---|---|
| GET | `/leads` | All leads with event dates + calendar status |
| POST | `/leads/:leadId/mark` | Mark event as option or confirmed |
| GET | `/leads/:leadId/status` | Get calendar_events row |
| POST | `/leads/:leadId/meeting` | Create Google Calendar meeting. Body: `{ title, start, end, guestEmail, guestName }` |
| POST | `/meetings/:eventId/notify` | Send Google Calendar invite email |
| GET | `/meetings/:eventId/status` | Check attendee RSVP, update lead.meeting_rsvp_status |

### AI (`/api/ai`) — all require auth
| Method | Path | Description |
|---|---|---|
| POST | `/translate` | `{ text, to: 'he'\|'en' }` → `{ result }` — Haiku |
| POST | `/reply` | `{ leadId }` → reads full conversation + `ai_instructions` from settings → `{ result }` — Sonnet |
| POST | `/improve` | `{ text }` → `{ result }` + `ai_instructions` from settings — Haiku |

### Admin (`/api/admin`) — require auth + admin role
| Method | Path | Description |
|---|---|---|
| GET | `/settings` | Returns all settings as `{ key: value }` object |
| PUT | `/settings/:key` | Upserts a setting value |

### Users (`/api/users`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List all users |
| POST | `/` | Create user (admin only) |
| PATCH | `/:id` | Update user |

### Analytics (`/api/analytics`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | Stage counts, source breakdown, conversion rates |

---

## Frontend Pages & Components

### `LeadsPage.jsx`
- 4-tab view: חדשים / בתהליך / סגרו עסקה / לא סגרו
- Search by name, phone, email
- Mobile-responsive table with `min-w-[900px]` + `overflow-x-auto`
- Columns: # | שם | סטטוס | פעילות אחרונה | התקבל ב | טלפון | תאריך אירוע | סוג אירוע | מוזמנים | מקור | אחראי | משימות
- Unread indicator (green pulse dot)
- Priority icons: 🔥 hot / ⚡ urgent
- Auto-refresh every 30 seconds

### `LeadCard.jsx` (full-screen modal)

**Tabs:** פרטים ופעילות | משימות | וואטסאפ

#### Info Tab sections:

**סטטוס** — stage pills, "לא סגרו" button, "📅 קבע פגישה", "+ משימה", RSVP badge

**יומן Google** — 🟡 אופציה / ✅ סגור toggle

**פרטי ליד** — all lead fields, inline notes editor

**הפקה** — deposit amount + date + confirmed checkbox + production notes (stages deposit/production only)

**קבצים**
- Upload via button or drag-and-drop
- Each file shows 🗑️ delete button (with confirmation)
- Clicking a file calls `openFile(id)` → fetches signed URL → opens in new tab
- Files never accessed via direct Supabase URL (always through CRM auth)

**פעילות (Timeline)**
- Combined feed of `lead_interactions` + `messages`, newest-first
- Quick-log: 📞 שיחה | 🤝 פגישה | 📝 הערה | 📱 שלח וואטסאפ | ✉️ שלח אימייל
- Inbound items: 🌐 תרגם לעברית button
- Compose forms: AI buttons (🌐 תרגם לאנגלית / 🤖 הצע תשובה / ✨ שפר)
- `[[FILE:id|name]]` markers rendered as clickable file badges (open via signed URL)
- Stage change notes shown as `🔄 שינוי שלב: X ← Y`

### `AdminPage.jsx` (`/admin`) — admin only
- ⚙️ tab visible in bottom nav only for `role = 'admin'` users
- **AI Instructions** textarea: free-text rules for how the AI should write replies (tone, phrases to avoid, style). Saved to `settings` table, injected into every `/reply` and `/improve` system prompt.
- Built to grow — additional settings sections added below over time.

### `PostponePage.jsx` (`/postpone/:taskId?token=`)
Legacy standalone postpone page. Still accessible from old reminder links.

### `TaskActionPage.jsx` (`/task-action/:taskId?token=`)
Mobile-friendly action hub linked from WhatsApp task reminders. Three collapsible action cards:
1. **✅ סמן כהושלם** — optional result textarea → marks task done, logs result to timeline
2. **🔁 קבע מחדש (לא ענה)** — preset buttons (15min / 30min / שעה / יום) + custom datetime → resets remind_sent_at
3. **➕ צור משימת המשך** — title input + datetime-local → creates new task inheriting lead/assigned_to/remind_via

Token is validated server-side (JWT, 48h expiry). No CRM login required.

---

## Background Services (`server/index.js → startCronJobs()`)

| Service | Interval | Notes |
|---|---|---|
| Gmail poll | 10 minutes | `pollGmail()` runs immediately on start. Skipped if no `google_token.json` |
| WhatsApp webhook | On start | Registers `SERVER_URL/api/whatsapp/webhook` with Green API if `SERVER_URL` is set. Includes `incomingWebhook: 'yes'` + `outgoingMessageWebhook: 'yes'` to prevent settings reset on Railway restart. |
| WhatsApp long-poll | Continuous | Used locally when `SERVER_URL` is not set — does not affect webhook registration |
| Task reminders | Every 2 min | 30s delay on boot. Due-task look-ahead: `NOW() + INTERVAL '2 minutes'`. Postpone endpoint also schedules exact-time `setTimeout` so reminder fires at precisely the new due time. |

### Reminder Service (`server/services/reminderService.js`)

Runs every 30 minutes. Four reminder types:

1. **No contact in 24h** — lead at stage `new` with no interactions → WhatsApp to assigned user
2. **Offer stale 3 days** — lead at `offer_sent` with no activity in 3 days → WhatsApp to assigned user
3. **Contract stale 5 days** — lead at `contract_sent` with no activity in 5 days → WhatsApp to assigned user
4. **Due tasks** — tasks with `remind_via = 'whatsapp'` due within window, `remind_sent_at IS NULL`:
   - **Duplicate prevention:** atomic `UPDATE tasks SET remind_sent_at = NOW() WHERE id = $1 AND remind_sent_at IS NULL RETURNING id` — only one server instance wins
   - **Message format:**
     ```
     ⏰ תזכורת משימה: "{title}" עבור הליד "{lead}" - עכשיו!
     🔗 לפתיחת הליד: {baseUrl}/?lead={leadId}
     👇 פעולות (הושלם / דחייה / המשך): {baseUrl}/task-action/{taskId}?token={jwt}
     ```
   - Token: `jwt.sign({ taskId, type: 'postpone' }, JWT_SECRET, { expiresIn: '48h' })`
   - `baseUrl` = `process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app'`

---

## Google Calendar Integration

### Event Date Marking
- `syncLeadToCalendar(leadId, type)` — creates/patches Google Calendar event
- Type `option` → yellow (colorId: 5), `confirmed` → green (colorId: 2)
- Title: `{lead name} - {event type}`, time: `event_date T event_time` (2-hour block, Israel timezone)

### Meeting Scheduling
- `createMeeting({ leadId, title, start, end, guestEmail, guestName })` — creates event with guest attendee, `sendUpdates: 'none'`
- `sendMeetingInvite(eventId)` — patches with `sendUpdates: 'all'`
- `getMeetingRsvpStatus(eventId, guestEmail)` — returns attendee `responseStatus`
- Location: `שרביה, פנחס בן יאיר 3, תל אביב`
- No description (clean customer-facing event)

---

## WhatsApp Integration (Green API)

- **Webhook mode** (production): Green API POSTs to `/api/whatsapp/webhook`
- **Long-poll mode** (local): `whatsappPoller.js`
- Group messages filtered out by `@g.us` suffix

### Inbound message types handled
| typeMessage | Handling |
|---|---|
| textMessage | Text stored in `messages.body` |
| extendedTextMessage | Text stored in `messages.body` |
| imageMessage | Downloaded from `imageMessageData.downloadUrl`, uploaded to Supabase, stored in `files` table, `[[FILE:id\|name]]` in body |
| documentMessage | Same, uses `fileMessageData.downloadUrl` + `fileName` |
| audioMessage / extendedAudioMessage | Same |
| videoMessage | Same |
| All others | Ignored (group messages, stickers, location, etc.) |

Media download failures degrade gracefully: caption or `[typeMessage]` stored as text body.

### Outbound file send
Upload to Green API storage → get `urlFile` → upload to Supabase → insert into `files` table → send via `sendFileByUrl` → embed `[[FILE:id|name]]` in message body.

---

## AI Features (`server/routes/ai.js`)

Client created lazily per-request (avoids startup errors if `ANTHROPIC_API_KEY` not set).

| Feature | Model | Trigger |
|---|---|---|
| Translate to Hebrew | claude-haiku-4-5-20251001 | Per-message button on inbound timeline items |
| Translate to English | claude-haiku-4-5-20251001 | Button in WA/email compose form |
| Suggest reply | claude-sonnet-4-6 | Button in compose form — reads full conversation history |
| Improve draft | claude-haiku-4-5-20251001 | Button in compose form |

---

## Runtime DB Migrations (boot)

`server/index.js` runs these `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every boot (safe to re-run):

```sql
CREATE TABLE IF NOT EXISTS messages (...)
CREATE TABLE IF NOT EXISTS processed_emails (...)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE
ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result TEXT
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_sent_at TIMESTAMPTZ
ALTER TABLE leads ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_event_id TEXT
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_rsvp_status VARCHAR(20)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_date DATE
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_confirmed BOOLEAN DEFAULT FALSE
ALTER TABLE leads ADD COLUMN IF NOT EXISTS production_notes TEXT
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(50)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason_text TEXT
ALTER TABLE leads ADD COLUMN IF NOT EXISTS event_time VARCHAR(10)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id)
ALTER TABLE lead_interactions ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'outbound'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_via VARCHAR(20) DEFAULT 'app'
ALTER TABLE files ADD COLUMN IF NOT EXISTS stored_name TEXT
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())
INSERT INTO settings (key, value) VALUES ('ai_instructions', '') ON CONFLICT (key) DO NOTHING
```

---

## Deployment

- **Platform:** Railway (auto-deploy on push to `main`)
- **Domain:** www.proevent.co.il
- **Build:** `npm install --prefix client && npm run build --prefix client` (Vite)
- **Start:** `node server/index.js`
- **Static files:** React build from `client/dist`; `/uploads` path returns 404 (files now in Supabase)

---

## File Structure

```
/
├── client/src/
│   ├── pages/
│   │   ├── LeadsPage.jsx
│   │   ├── CalendarPage.jsx
│   │   ├── AnalyticsPage.jsx
│   │   ├── LoginPage.jsx
│   │   ├── AdminPage.jsx          # Admin settings (AI instructions, future settings)
│   │   ├── PostponePage.jsx       # Legacy standalone postpone page
│   │   └── TaskActionPage.jsx     # Task action hub (complete/postpone/follow-up)
│   ├── components/
│   │   ├── LeadCard.jsx
│   │   └── AddLeadModal.jsx
│   ├── api.js                     # Axios instance with auth interceptor
│   └── App.jsx                    # Routes: / /analytics /calendar /postpone/:id /task-action/:id /login
├── server/
│   ├── index.js                   # Express app, boot migrations, cron jobs
│   ├── db/pool.js
│   ├── middleware/auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── leads.js               # Lead CRUD + interactions + tasks + email send
│   │   ├── whatsapp.js            # Webhook (text+media) + send + send-file
│   │   ├── calendar.js
│   │   ├── ai.js                  # translate/reply/improve — injects ai_instructions from settings
│   │   ├── admin.js               # GET/PUT /api/admin/settings (admin only)
│   │   ├── files.js               # Upload/delete/signed-URL (scoped to lead)
│   │   ├── fileDownload.js        # GET /api/files/:fileId/url (general signed URL)
│   │   ├── taskPostpone.js        # Public task actions: postpone/complete/create-followup
│   │   ├── users.js
│   │   └── analytics.js
│   └── services/
│       ├── gmailService.js
│       ├── calendarService.js
│       ├── storageService.js      # Supabase Storage: uploadFile, deleteFile, getSignedUrl
│       ├── whatsappPoller.js      # Long-poll + media handling
│       └── reminderService.js     # Task reminders with action hub link
```

---

## Known Limitations & Future Work

| Item | Status |
|---|---|
| Facebook / Instagram webhooks | Not started |
| AI bot (auto-reply to new leads) | Not started |
| Analytics dashboard | Basic (stage counts + sources) |
| WhatsApp RSVP tracking | Only via Google Calendar email invite; no direct WA confirmation |
| Inbound WhatsApp media > 30s download | Times out gracefully, stores caption or type label as fallback |

---

## Build Phases — Status

### Phase 1 — Core CRM ✅
Project scaffold, DB schema, multi-user auth, lead table, lead card, manual creation, WhatsApp capture, Gmail capture, Railway deploy.

### Phase 2 — Messaging & Calendar ✅
Reply via WhatsApp + Email, auto-advance stage, Google Calendar event marking, meeting scheduling + RSVP.

### Phase 3 — AI Messaging ✅
Translate inbound (Hebrew), translate outgoing (English), AI suggest reply (Sonnet), AI improve draft (Haiku).

### Phase 4 — Secure File Storage ✅
- Files stored in **Supabase Storage private bucket** (`crm-files`) — permanent, survives redeploys
- Upload: Files tab (drag-and-drop), email attachments, WhatsApp outbound files
- All files inserted into `files` table with `stored_name`
- Access via **signed URLs** (60-second expiry) — requires CRM login to generate
- 🗑️ Delete button on each file (confirmation dialog)
- Inbound WhatsApp media (images, documents, audio, video) downloaded from Green API and stored in Supabase

### Phase 5 — Tasks & Reminders ✅
- Full task system with completion, result logging, reschedule
- Reminder service (every 30 min): WhatsApp to staff
- **Duplicate prevention:** atomic DB claim prevents multiple Railway instances firing same reminder
- **Task action hub** (`/task-action/:taskId?token=`): mobile page with complete / reschedule / follow-up
  - Token-signed links (48h expiry, no login required)
  - Reschedule: 15min / 30min / 1hr / 1day / custom datetime
  - Complete: optional result text, logged to timeline
  - Follow-up: new task inheriting lead + assigned user

### Phase 6 — Production Module ✅
Deposit amount + date + confirmed checkbox + production notes. Data persists via DB columns added in boot migration.

### Phase 7 — Data Integrity ✅
- All data stored in Supabase PostgreSQL (permanent)
- Stage changes logged to timeline with user attribution
- WhatsApp media messages captured (not silently dropped)
- Boot-time `ALTER TABLE IF NOT EXISTS` ensures all columns exist after any redeploy

### Phase 8 — Admin Section ✅
- `settings` table for key/value config
- Admin page (`/admin`) — ⚙️ nav tab visible to admin role only
- AI instructions: free-text rules injected into all AI reply/improve calls
- LeadCard auto-refreshes data on browser tab focus (`visibilitychange`)

### Phase 9 — Facebook/Instagram 🔲 Not started
### Phase 10 — AI Bot (auto-qualify new leads) 🔲 Not started
### Phase 11 — Full Analytics Dashboard 🔲 Partial
