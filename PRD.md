# Sharabiya CRM — Product Requirements Document

> **Last updated:** 2026-04-24
> **Live at:** https://www.proevent.co.il
> **Hosting:** Railway (auto-deploy from GitHub `main` branch)
> **DB:** Supabase (PostgreSQL)

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
| `JWT_SECRET` | Secret for JWT auth tokens |
| `GREEN_API_URL` | Green API base URL (e.g. https://api.green-api.com) |
| `GREEN_API_INSTANCE` | Green API instance ID |
| `GREEN_API_TOKEN` | Green API token |
| `SERVER_URL` | Public URL of the server (e.g. https://www.proevent.co.il) — triggers webhook mode |
| `GOOGLE_CREDENTIALS_B64` | Base64-encoded `credentials.json` (Google OAuth app credentials) |
| `GOOGLE_TOKEN_B64` | Base64-encoded `google_token.json` (Google OAuth refresh token) |
| `ANTHROPIC_API_KEY` | Claude API key for AI features (translate / reply / improve) |

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

## Email Parsing (`server/services/gmailService.js` + `server/scripts/bulkImport.js`)

Gmail is polled every 10 minutes. Each email is parsed, a lead is created or matched, and an inbound `lead_interactions` row is inserted with the real Gmail `internalDate` (so "התקבל ב" shows when the email actually arrived, not when it was imported).

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
- Phone: regex `/מספר טלפון לחזרה\s*(\d[\d\-]+)/` (note: `\s*` not `\s+` — HTML table cells concatenate without whitespace)
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

### Auto-advance Logic
Any of the following advances `new → contacted` automatically:
- `POST /api/whatsapp/send` succeeds
- `POST /api/whatsapp/send-file` succeeds
- `POST /api/leads/:id/email/send` succeeds
- `POST /api/leads/:id/interactions` with `direction = 'outbound'`

SQL: `UPDATE leads SET stage = 'contacted' WHERE id = $1 AND stage = 'new'`

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
deposit_confirmed BOOLEAN
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
created_by INT → users.id
created_at TIMESTAMPTZ
```

### messages
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
channel VARCHAR(20)          -- whatsapp
direction VARCHAR(10)        -- inbound | outbound
body TEXT
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
remind_sent_at TIMESTAMPTZ
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
url VARCHAR(500)
file_type VARCHAR(100)
uploaded_by INT → users.id
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

## API Routes

### Auth (`/api/auth`)
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Returns JWT token |

### Leads (`/api/leads`) — all require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List leads by tab (new/in_process/closed/lost) + search. Returns open_tasks, overdue_tasks, unread_count, last_interaction_at, received_at |
| GET | `/:id` | Single lead with assigned_name |
| POST | `/` | Create lead manually |
| PATCH | `/:id` | Update any allowed field |
| DELETE | `/:id` | Admin only |
| POST | `/:id/read` | Mark all inbound messages + interactions as read |
| GET | `/:id/interactions` | Interaction timeline |
| POST | `/:id/interactions` | Log interaction (auto-advances new→contacted if outbound) |
| GET | `/:id/tasks` | List tasks |
| POST | `/:id/tasks` | Create task |
| PATCH | `/:id/tasks/:taskId/complete` | Complete task + log result as note |
| PATCH | `/:id/tasks/:taskId/reschedule` | Reschedule task |
| POST | `/:id/email/send` | Send email via Gmail API (auto-advances new→contacted) |
| GET | `/:id/messages` | WhatsApp messages |

### WhatsApp (`/api/whatsapp`) — webhook is public, send requires auth
| Method | Path | Description |
|---|---|---|
| POST | `/webhook` | Receives Green API webhook, creates/matches lead, stores message |
| POST | `/send` | Send text message via Green API (auto-advances new→contacted) |
| POST | `/send-file` | Upload file to Green API then send (auto-advances new→contacted) |

### Calendar (`/api/calendar`) — all require auth
| Method | Path | Description |
|---|---|---|
| GET | `/leads` | All leads with event dates + calendar status |
| POST | `/leads/:leadId/mark` | Mark event date as option or confirmed in Google Calendar |
| GET | `/leads/:leadId/status` | Get calendar_events row for this lead |
| POST | `/leads/:leadId/meeting` | Create a Google Calendar meeting for this lead. Body: `{ title, start, end, guestEmail, guestName }`. Saves `meeting_event_id` to lead. Returns `{ eventId, eventLink }` |
| POST | `/meetings/:eventId/notify` | Send Google Calendar invite email to attendees (`sendUpdates:'all'`) |
| GET | `/meetings/:eventId/status` | Check attendee RSVP status, update `meeting_rsvp_status` on lead |

### AI (`/api/ai`) — all require auth
| Method | Path | Description |
|---|---|---|
| POST | `/translate` | Body: `{ text, to: 'he'|'en' }`. Model: Haiku. Returns `{ result }` |
| POST | `/reply` | Body: `{ leadId }`. Reads full conversation history, generates Hebrew sales reply. Model: Sonnet. Returns `{ result }` |
| POST | `/improve` | Body: `{ text }`. Improves draft while keeping intent. Model: Haiku. Returns `{ result }` |

### Files (`/api/leads/:leadId/files`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List files for lead |
| POST | `/` | Upload file (multipart) |
| DELETE | `/:fileId` | Delete file |

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
- Mobile-responsive table with `min-w-[900px]` + `overflow-x-auto` on card container
- Columns: # | שם | סטטוס | פעילות אחרונה | התקבל ב | טלפון | תאריך אירוע | סוג אירוע | מוזמנים | מקור | אחראי | משימות
- Unread indicator (green pulse dot) next to last activity date
- Priority icons: 🔥 hot / ⚡ urgent
- Auto-refresh every 30 seconds (silent, no loading state)
- "התקבל ב" = earliest inbound message or interaction timestamp (not lead created_at)

### `LeadCard.jsx` (full-screen modal)

**Header:** Lead name (click to inline-edit) | source badge | received + last activity dates | avatar

**Tabs:** פרטים ופעילות | משימות | וואטסאפ

#### Info Tab sections:

**סטטוס**
- Stage pills — click to advance, completed stages shown with ✓
- "לא סגרו" button → LostModal (reason picker + free text)
- "📅 קבע פגישה" button → ScheduleMeetingModal
- "+ משימה" button → AddTaskModal
- RSVP badge shown if `meeting_rsvp_status` is accepted/declined/tentative

**יומן Google** (shown only if lead has event_date)
- 🟡 אופציה / ✅ סגור toggle buttons → creates/updates Google Calendar event

**פרטי ליד**
- Grid: phone (tap-to-call), email, event date, event type, guests, budget, assigned, priority, received, last activity
- Inline notes editor (click to edit)

**הפקה** (shown only at stages deposit/production)
- Deposit amount + date + confirmed checkbox
- Production notes

**קבצים** — upload via button or drag-and-drop, click to open

**משימות** — quick view of up to 3 open tasks + quick-add

**פעילות (Timeline)**
- Combined feed of `lead_interactions` + `messages`, sorted newest-first
- Quick-log buttons: 📞 שיחה | 🤝 פגישה | 📝 הערה | 📱 שלח וואטסאפ | ✉️ שלח אימייל
- Inbound items: 🌐 תרגם לעברית button → calls `/api/ai/translate` → shows Hebrew below
- Outgoing compose forms (WA + Email): AI buttons row:
  - 🌐 תרגם לאנגלית — translates draft to English (in-place)
  - 🤖 הצע תשובה — AI writes full sales reply from conversation history (in-place)
  - ✨ שפר — AI improves draft, keeps intent (in-place)
- File attachments rendered as clickable badges using `[[FILE:url|name]]` marker syntax

#### Tasks Tab
- Full task list with overdue highlighting
- Click task → TaskActionModal: complete (with outcome logging) / reschedule / create follow-up

#### WhatsApp Tab
- Full message thread (inbound right / outbound left, green bubbles)
- Send box with Enter-to-send

### `ScheduleMeetingModal`
2-step flow:
1. **Form:** Title (pre-filled "פגישה עם {name}"), date (default tomorrow), start/end time (default 10:00–11:00), delivery toggle (WhatsApp 📱 or Email ✉️)
2. **Confirmation:** ✅ success message, Google Calendar link, "בדוק תשובה" button (polls attendee RSVP)

Meeting event includes:
- Location: `שרביה, פנחס בן יאיר 3, תל אביב` (appears as Google Maps link)
- No description (clean customer-facing event)
- Guest added as attendee if email provided → Accept/Decline buttons appear in Google invite email

---

## Background Services (`server/index.js → startCronJobs()`)

| Service | Interval | Notes |
|---|---|---|
| Gmail poll | 10 minutes | `pollGmail()` runs immediately on start. Skipped if no `google_token.json` |
| WhatsApp webhook | On start | Registers `SERVER_URL/api/whatsapp/webhook` with Green API if `SERVER_URL` is set |
| WhatsApp long-poll | Continuous | Used locally when `SERVER_URL` is not set |
| Task reminders | Every 30 min | 2-min delay on boot to avoid re-firing on restart |

---

## Google Calendar Integration

### Event Date Marking (existing leads with event_date)
- `calendarService.syncLeadToCalendar(leadId, type)` — creates or patches a Google Calendar event
- Type `option` → yellow (colorId: 5), type `confirmed` → green (colorId: 2)
- Event title: `{lead name} - {event type}`
- Event time: `event_date T event_time` (2-hour block, Israel timezone)
- Description: link back to CRM lead card

### Meeting Scheduling (new feature)
- `calendarService.createMeeting({ leadId, title, start, end, guestEmail, guestName })`
- Creates event with guest as attendee, `sendUpdates: 'none'`
- `calendarService.sendMeetingInvite(eventId)` — patches event with `sendUpdates: 'all'` → Google sends official invite email
- `calendarService.getMeetingRsvpStatus(eventId, guestEmail)` — returns attendee `responseStatus`

---

## WhatsApp Integration (Green API)

- **Webhook mode** (production): Green API POSTs to `/api/whatsapp/webhook`
- **Long-poll mode** (local): `server/services/whatsappPoller.js` polls Green API for new messages
- Incoming text messages only (group messages filtered out by `@g.us` suffix)
- File send: uploads to Green API storage first → gets public URL → sends via `sendFileByUrl`
- Files saved to `/uploads/` directory (CRM copies) with format `[[FILE:url|name]]` embedded in message body

---

## AI Features (`server/routes/ai.js`)

All endpoints use `ANTHROPIC_API_KEY`. Client created lazily per-request.

| Feature | Model | Prompt |
|---|---|---|
| Translate to Hebrew | claude-haiku-4-5-20251001 | Simple translation instruction |
| Translate to English | claude-haiku-4-5-20251001 | Simple translation instruction |
| Suggest reply | claude-sonnet-4-6 | Sales rep persona for שרביה, reads full conversation history + lead details |
| Improve draft | claude-haiku-4-5-20251001 | Keep intent, improve professionalism and persuasiveness |

---

## Deployment

- **Platform:** Railway (auto-deploy on push to `main`)
- **Domain:** www.proevent.co.il (CNAME → Railway, DNS at box.co.il)
- **Root redirect:** proevent.co.il → www.proevent.co.il (HTTPRED at box.co.il)
- **Build:** `npm install --prefix client && npm run build --prefix client` (Vite)
- **Start:** `node server/index.js`
- **Port:** Railway injects `PORT` env var; server uses `process.env.PORT || 3001`
- **Static files:** React build served from `client/dist`; uploads served from `/uploads`

---

## File Structure

```
/
├── client/                    # React + Vite + Tailwind frontend
│   └── src/
│       ├── pages/
│       │   ├── LeadsPage.jsx  # Main lead table (4 tabs)
│       │   ├── CalendarPage.jsx
│       │   ├── AnalyticsPage.jsx
│       │   └── LoginPage.jsx
│       └── components/
│           ├── LeadCard.jsx   # Full lead card modal (all interactions)
│           └── AddLeadModal.jsx
├── server/
│   ├── index.js               # Express app, DB migrations, cron jobs
│   ├── db/pool.js             # PostgreSQL pool
│   ├── middleware/auth.js     # JWT middleware
│   ├── routes/
│   │   ├── auth.js
│   │   ├── leads.js           # Lead CRUD + interactions + tasks + email send
│   │   ├── whatsapp.js        # Webhook + send + send-file
│   │   ├── calendar.js        # Event marking + meeting scheduling + RSVP
│   │   ├── ai.js              # Translate + reply + improve
│   │   ├── files.js           # File upload/delete
│   │   ├── users.js
│   │   └── analytics.js
│   ├── services/
│   │   ├── gmailService.js    # Gmail poll + lead parsing + upsert
│   │   ├── calendarService.js # syncLeadToCalendar + createMeeting + RSVP
│   │   ├── whatsappPoller.js  # Long-poll for local dev
│   │   └── reminderService.js # Task + follow-up reminders
│   └── scripts/
│       ├── bulkImport.js      # One-time Gmail import (from April 1 2026)
│       ├── fixGmailDates.js   # Backfill internalDate for existing leads
│       └── fixTelekol.js      # Backfill phone for Telekol leads
├── uploads/                   # Uploaded/received files (local; ephemeral on Railway)
├── package.json               # Root: server deps + build scripts
└── PRD.md                     # This file
```

---

## Known Limitations & Future Work

| Item | Status |
|---|---|
| Facebook / Instagram webhooks | Not started |
| AI bot (auto-reply to new leads) | Not started |
| Analytics dashboard | Basic (stage counts + sources) |
| Uploads on Railway | Ephemeral filesystem — files lost on redeploy. Need S3/Cloudinary for persistence |
| WhatsApp RSVP | WhatsApp delivery sends calendar link; RSVP only trackable if lead uses Google Calendar and email invite was also sent |
| `ANTHROPIC_API_KEY` not picked up | Confirmed: create client lazily per-request. If still failing, verify Railway var name has no spaces |

---

## Build Phases — Status

### Phase 1 — Core CRM ✅ Done
- Project scaffold (React + Vite + Tailwind + Node.js + Supabase)
- DB schema + runtime migrations
- Multi-user login (JWT)
- 4-view lead table (mobile-responsive, horizontal scroll)
- Lead card: info + pipeline bar + interactions timeline
- Manual lead creation
- WhatsApp auto-capture (Green API webhook + long-poll fallback)
- Email auto-capture (Gmail API — all 4 parsers, real received dates)
- Deploy to Railway at www.proevent.co.il

### Phase 2 — Messaging & Calendar ✅ Done
- Reply via WhatsApp (text + file) from CRM
- Reply via Email (Gmail API + file attachment)
- Auto-advance stage new→contacted on first outbound
- Google Calendar event date marking (option/confirmed) from lead card
- Schedule meeting from lead card: title + date + time + WhatsApp/email delivery
- Google Calendar RSVP tracking (accept/decline/tentative)
- Meeting location: שרביה, פנחס בן יאיר 3, תל אביב

### Phase 3 — AI Messaging ✅ Done
- Translate inbound messages to Hebrew (per-message button)
- Translate outgoing draft to English
- AI suggest full reply (reads full conversation, sales persona)
- AI improve draft
- Powered by Anthropic Claude API (Haiku for translate/improve, Sonnet for reply)

### Phase 4 — Documents & Files ✅ Done
- File upload to lead card (button + drag-and-drop)
- Files sent via WhatsApp or Email appear as clickable attachments in timeline
- File storage: local `/uploads/` directory

### Phase 5 — Tasks & Reminders ✅ Done
- Full task system: title + due date + assigned user + remind via
- Task completion with outcome logging
- Task reschedule with note
- Follow-up task creation from completed task
- Reminder service (every 30 min): sends WhatsApp to staff for overdue tasks

### Phase 6 — Production Module ✅ Done
- Production section visible at deposit/production stages
- Deposit amount + date + confirmed checkbox
- Production notes

### Phase 7 — Facebook/Instagram 🔲 Not started
### Phase 8 — AI Bot (auto-qualify new leads) 🔲 Not started
### Phase 9 — Full Analytics Dashboard 🔲 Partial
