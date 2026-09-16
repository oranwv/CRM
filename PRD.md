# Sharabiya CRM — Product Requirements Document

> **Last updated:** 2026-09-08
> **Live at:** https://www.proevent.co.il
> **Hosting:** Railway (auto-deploy from GitHub `main` branch)
> **DB + Storage:** Supabase (PostgreSQL + Storage bucket `crm-files`)

---

## Product Overview

A custom CRM for Sharabiya, an event venue at פנחס בן יאיר 3, תל אביב. Manages the full lifecycle from first lead inquiry through signed contract and event production. Mobile-first, Hebrew RTL, multi-user, with automatic lead capture from all channels and AI assistance for messaging.

It has since grown well past a lead pipeline. The app is organized into eight **modes**
(see "App Modes"), each aimed at a different job: מכירות (leads, AI worklist, analytics),
הפקה (events, brief, seating), תפעול (maintenance, faults, checklists), ספקים (suppliers),
אישורי הגעה (guest RSVP), ניהול (employee activity), כספים (bank reconciliation + invoice
filing) and רווחים (profit per event). Along the way it also issues **price offers**,
**contracts** with a public signing page, and **financial documents** through GreenInvoice.

---

## Users & Roles

- Multiple staff members (sales + production + operations + finance)
- All leads visible to everyone
- Each lead has an assigned owner
- Every action attributed to the logged-in user (name shown on all entries)
- Admin can delete leads; all roles can create and interact

### Roles

`users.role` (single, legacy — `CHECK (role IN ('admin','manager','sales','production'))`) plus
`users.roles TEXT[]` (the current, multi-role field). Code reads
`user.roles?.length ? user.roles : [user.role]`, so a user with an empty array
still works off the legacy column. `users.blocked BOOLEAN` disables login without
deleting the account.

| Role | Grants |
|---|---|
| `admin` | Everything, including `/admin`, user management, lead deletion |
| `manager` | Everything except admin-only settings; approves financial documents |
| `sales_manager` | Sales manager (מנהל מכירות): Sales + profit modes, and sees **every rep's leads** in the AI worklist, the WhatsApp briefing and the AI chat — like a manager, but without ניהול/כספים/approvals. Lives only in `roles[]`, never in the legacy `role` column |
| `sales` | Sales mode: leads, AI worklist, calendar, analytics, tasks, profit |
| `production` | Production mode: events, tasks, calendar, event brief, seating |
| `operations` | Operations mode (תפעול): op tasks, maintenance, faults, checklists |
| `suppliers` | Suppliers mode |
| `rsvp` | RSVP mode (אישורי הגעה) |
| `finance` | Finance mode (כספים): reconciliation + invoice scan |

`admin` and `manager` implicitly get every mode.

### App Modes (`client/src/context/AppModeContext.jsx`)

The app is not a single flat navigation. The top bar switches a **mode**, and the
mode decides which bottom tabs exist. The chosen mode is stored in
`localStorage.crm_mode`; on load, a mode the user is not permitted is discarded and
the first permitted mode is used instead.

| Mode | Bottom tabs |
|---|---|
| מכירות | 👥 לידים `/` · 💡 AI מכירות `/sales-worklist` · 📅 לוח שנה · 📊 אנליטיקס · ✅ משימות |
| הפקה | 🎉 אירועים `/events` · ✅ משימות · 📅 לוח שנה |
| תפעול | 🔧 תפעול `/operations` · 📅 לוח שנה |
| ספקים | 🏢 ספקים `/suppliers` |
| אישורי הגעה | 📋 אישורי הגעה `/rsvps` |
| ניהול | 📈 ניהול `/management` · 💡 AI מכירות |
| כספים | 💰 כספים `/finance` |
| רווחים | 💰 רווחים `/sales-performance` |

Row 2 of the nav (admin only) holds ⚙️ הגדרות `/admin`.

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
| `OPENAI_API_KEY` | OpenAI key — **every** AI feature runs on it (chat, reply/improve/translate, Whisper transcription, cost generation, invoice classification, deal advisor) |
| `SUPABASE_URL` | Supabase project URL (e.g. https://xxx.supabase.co) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key — used server-side only for storage operations |
| `GREENINVOICE_API_KEY` | GreenInvoice API key (financial documents) |
| `GREENINVOICE_SECRET` | GreenInvoice API secret |
| `META_RSVP_ACCESS_TOKEN` | Meta WhatsApp Cloud API token — RSVP campaigns |
| `META_RSVP_PHONE_NUMBER_ID` | Meta WhatsApp sender ID for RSVP |
| `META_RSVP_INVITATION_TEMPLATE` | Approved Meta template name for the invitation |
| `META_RSVP_REMINDER_TEMPLATE` | Approved Meta template name for the reminder |
| `META_RSVP_WEBHOOK_VERIFY_TOKEN` | Verify token for the Meta RSVP webhook |
| `PUPPETEER_EXECUTABLE_PATH` | Chromium path for contract/offer PDF rendering (`puppeteer-core`) |
| `GOOGLE_REFRESH_TOKEN` | Alternative to `GOOGLE_TOKEN_B64` — plain refresh token, token file built from it |
| `PORT` | HTTP port (Railway sets it) |
| `TWILIO_ACCOUNT_SID` | Twilio account — in-app calling (Phase 33). With the two below, enables calling |
| `TWILIO_AUTH_TOKEN` | Twilio auth token — REST + webhook signature validation |
| `TWILIO_PHONE_NUMBER` | The venue's Israeli number in E.164 (`+97233823777`). API key + TwiML app are self-created on boot and stored in `settings` |

> **`ANTHROPIC_API_KEY` is no longer used.** The AI layer moved to OpenAI
> (2026-06 onward). `@anthropic-ai/sdk` is still in `package.json` but nothing in
> `server/` references Anthropic. See "AI Features" below.

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
| ProEvent landing page demo form | `POST /api/public/demo-request` (no auth) | Auto — source `landing`, stage new, priority hot, event_type "דמו ProEvent"; existing phone → note on the existing lead; admins get a WhatsApp |

Allowed `leads.source` values: `website_popup`, `website_form`, `call_event`, `telekol`,
`vonage`, `whatsapp`, `facebook`, `instagram`, `manual`, `landing`.

**Instagram** is not a webhook. Click-to-WhatsApp leads coming from Instagram are
identified by the CTA text of the first inbound message (stored in `notes` as
"הודעה ראשונה: …", the template containing "אפשר לקבל מידע נוסף על זה") and reclassified
to `source = 'instagram'` — once historically by an idempotent boot backfill, and going
forward in `server/utils/leadSource.js`.

**Match rule:** Normalize phone to E.164 Israeli format (remove non-digits, replace leading 0 with 972). If phone matches existing lead → attach as interaction. If unknown → create new lead at stage `new`.

**Deduplication:** All incoming WhatsApp messages checked against `messages.external_id` before insert.

---

## Email Parsing (`server/services/gmailService.js`)

Gmail is polled every 10 minutes. Each email is parsed, a lead is created or matched, and an inbound `lead_interactions` row is inserted with the real Gmail `internalDate`.

### Poll query — three bugs fixed 2026-08-08 (`45bcb62`, `0d1ce93`)
Call Event leads were intermittently never entering the CRM. Three separate causes:

1. The query used `is:unread`, so any email a human opened before the 10-minute poll was
   never fetched. It now scans **all** mail in a rolling **7-day window**
   (`q: after:<ts>`) with pagination — `processed_emails` is what dedups, not the read flag.
2. The catch block marked an email as processed **even when processing threw**, which
   dropped it permanently and silently. It no longer marks on error, so the next poll retries.
3. A new inquiry from a lead already marked `lost` was invisible. Such a lead is now
   **reopened** `lost → new` with a note.

⚠ Two example emails (אלמוג 849, נורית 883) are still stuck in `processed_emails` from the
old error-marking bug; both leads already exist.

### Call Event (info@hafakot.co.il — subject contains "CALL EVENT")
- Name: line after `להלן פרטי הליד:` before `מתעניין`
- Phone: `טלפון: {value}`
- Email: `מייל: {value}`
- Guest count: `כמות מוזמנים: {value}`
- Event type: `סוג האירוע: {value}`

### New Sharviya website — FormSubmit (from `submissions@formsubmit.co`, added 2026-09-14)
The rebuilt site delivers both forms through FormSubmit. Checked **before** the old-site
rules (same subjects). Subject containing "פופאפ" → `website_popup`; "פנייה חדשה" →
`website_form`. `parseFormSubmit()` reads "label:" / value pairs (value on the same line or
the next one; a label has no digits and is followed by a space, so "6:00 am" and
"https://…" are values): שם / שם מלא → name, טלפון → phone, פרטי הפנייה → notes,
תאריך ("ספטמבר 14, 2026", Hebrew or English month names) → `event_date`, זמן → `event_time`
(also appended to notes as "שעה: …"). Unknown labels are ignored. Old-site rules below still
apply to non-FormSubmit senders.

### Website Popup — old site (subject contains "הודעה חדשה פופאפ")
- Uses line-position parsing: finds "אני" line, name = next line, phone = line after
- Fallback: first two valid lines before "---" separator

### Website Contact Form — old site (subject contains "פנייה חדשה מאתר שרביה")
- Name: `שם מלא: {value}`
- Phone: `טלפון: {value}`
- Notes: `פרטי הפנייה: {value}`

### Telekol (subject contains "טלקול")
- Phone: regex `/מספר טלפון לחזרה\s*(\d[\d\-]+)/`
- Name: `שם הפונה : {value}`
- Event type: `סוג אירוע: {value}`

---

## Pipeline Stages

| # | Key | Hebrew (UI label) | Auto-advance |
|---|---|---|---|
| 1 | new | חדש | Advance out of `new` is **manual** (see commit `f92f2fc`) |
| 2 | new_no_answer | חדש ולא עונה | Manual |
| 3 | contacted | בוצעה שיחה ראשונית | Manual |
| 4 | meeting_scheduled | נקבעה פגישה | Manual |
| 5 | meeting | בוצעה פגישה | Manual |
| 6 | offer_sent | נשלחה הצעת מחיר | Manual |
| 7 | negotiation | מו"מ | Manual |
| 8 | contract_sent | נשלח חוזה | Manual |
| 9 | process_no_answer | בתהליך ונעלם / לא עונה | Manual |
| 10 | deposit | התקבלה מקדמה | Manual |
| 11 | production | הפקה | Manual |
| 12 | completed | אירוע הסתיים והתקבל תשלום | Manual |
| — | lost | לא סגרו | Manual — requires reason |

**Tab grouping** (`LeadsPage.jsx`): active = `new … process_no_answer`;
closed = `deposit`, `production`, `completed`; lost = `lost`.

**"Closed" for reporting** = stage IN (`deposit`,`production`,`completed`).
There is no stage-history table — the analytics funnel derives dates from the
`price_offers` / `contracts` tables, and the close month from
`MIN(contracts.signed_at)` with a fallback to the `'… ← התקבלה מקדמה'` stage note.

**Priority** (`leads.priority`): `normal` | `hot` | `urgent` | `cold`.

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
event_date_text TEXT         -- free-text date when the customer has not fixed one ("סוף אוגוסט")
event_time TEXT
event_end_time TEXT
event_type VARCHAR(100)
event_name VARCHAR(255)      -- display name of the event; seeded from leads.name
guest_count VARCHAR(50)
budget VARCHAR(100)
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
remaining_balance_override NUMERIC        -- manual override of the computed balance
remaining_balance_override_by INT → users.id
remaining_balance_override_at TIMESTAMPTZ
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
source VARCHAR(20)
created_by INT → users.id    -- NULL for system/auto entries
created_at TIMESTAMPTZ
```
Allowed `type`: `call` | `call_attempt` | `meeting` | `note` | `email` | `whatsapp` | `facebook` | `instagram`

### messages
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
channel VARCHAR(20)          -- whatsapp
direction VARCHAR(10)        -- inbound | outbound
body TEXT                    -- plain text, or [[FILE:id|name]] for media
external_id TEXT             -- Green API message ID (dedup key)
contact_value TEXT           -- which phone/email this row was sent to (multi-recipient sends)
is_read BOOLEAN DEFAULT TRUE
timestamp TIMESTAMPTZ
sent_by INT → users.id       -- NULL for inbound / system; set for CRM-initiated outbound sends
```

### meetings
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
google_event_id TEXT
title TEXT
start_time TIMESTAMPTZ
end_time TIMESTAMPTZ
location TEXT DEFAULT 'שרביה, פנחס בן יאיר 3, תל אביב'
confirm_token TEXT           -- UUID for lead self-confirmation link
reminder_sent_at TIMESTAMPTZ
confirmed_at TIMESTAMPTZ
created_at TIMESTAMPTZ
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
role VARCHAR(20)             -- admin | manager | sales | production (legacy single role)
roles TEXT[] DEFAULT '{}'    -- current multi-role field: admin|manager|sales_manager|sales|production|operations|suppliers|rsvp|finance
blocked BOOLEAN DEFAULT FALSE
phone VARCHAR(50)
email VARCHAR(255)
created_at TIMESTAMPTZ
```

### processed_emails
```
gmail_id TEXT PRIMARY KEY
processed_at TIMESTAMPTZ
```

---

## Data Model — modules added after the first release

> The nine tables above are the original core. The live schema has **48 tables**.
> The rest are grouped by module below. All are created with
> `CREATE TABLE IF NOT EXISTS` at boot (see "Runtime DB Migrations").

### lead_contacts
Extra contact people on a lead (a couple booking a wedding, a client plus their producer).
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
type TEXT CHECK (type IN ('phone','email'))
value TEXT
label TEXT                   -- "החתן", "המפיקה" …
created_at TIMESTAMPTZ
```

### price_offers
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
fields JSONB                 -- customer + event fields
rows JSONB                   -- priced rows
includes JSONB DEFAULT '[]'  -- the "המחיר כולל" bullet list
offer_type TEXT DEFAULT 'regular'   -- regular | package
created_at TIMESTAMPTZ
```

### contracts
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
token TEXT UNIQUE            -- public signing link /sign/:token
contract_data JSONB          -- { fields, rows, includes, texts, calculated, language }
status TEXT DEFAULT 'pending'   -- pending | signed
sent_via TEXT                -- email | whatsapp
whatsapp_phone TEXT          -- comma-separated list of recipients
orderer_name TEXT
created_by INT → users.id
created_at TIMESTAMPTZ
signed_at TIMESTAMPTZ
signer_name TEXT
signer_id_number TEXT
signature_image TEXT         -- data URL of the drawn signature
signed_pdf_url TEXT
```

### pending_documents (`server/routes/greeninvoice.js`)
Financial documents submitted by a non-manager, waiting for approval.
```
id SERIAL PRIMARY KEY
lead_id INT → leads.id ON DELETE CASCADE
created_by INT → users.id
status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
rejection_comment TEXT
reviewed_by INT → users.id
reviewed_at TIMESTAMPTZ
creator_seen BOOLEAN DEFAULT FALSE   -- drives the "your document was approved" banner
payload JSONB                -- the whole GreenInvoice request as submitted
doc_id TEXT
doc_url TEXT
filename TEXT
created_at TIMESTAMPTZ
```

### event_briefs / production_checklist / seating_layouts
```
event_briefs:        id, lead_id UNIQUE → leads.id, data JSONB, updated_at, updated_by
production_checklist: id, lead_id → leads.id, item_key VARCHAR(100), checked_at,
                      checked_by, UNIQUE(lead_id, item_key)
seating_layouts:     id, lead_id → leads.id, section VARCHAR(20),
                      elements JSONB DEFAULT '[]', updated_at, UNIQUE(lead_id, section)
```

### suppliers / supplier_categories / lead_suppliers / supplier_files / supplier_interactions
```
supplier_categories:  id, name UNIQUE, sort_order
                      seeded: קייטרינג/שף, צלמים, מלצרים, ברמנים, שומרים, נקיון, כללי, מפיקים, מארחות
suppliers:            id, name, phone, email, description, category DEFAULT 'כללי',
                      sug VARCHAR(255), payment VARCHAR(255), created_by, created_at, updated_at
lead_suppliers:       id, lead_id, supplier_id, UNIQUE(lead_id, supplier_id)
supplier_files:       id, supplier_id, filename, stored_name, file_type, source, uploaded_by, created_at
supplier_interactions: id, supplier_id, type, direction, body, file_id → supplier_files.id,
                      created_by, created_at
```

### Operations module (תפעול)
```
op_tasks:             id, title, description, assigned_to, created_by, priority DEFAULT 'normal',
                      status DEFAULT 'open', due_date, notes, created_at, completed_at
op_checklists:        id, name, items JSONB, item_notes JSONB DEFAULT '{}', created_by, created_at
op_checklist_runs:    id, checklist_id, run_date, created_by, items_state JSONB, completed_at, created_at
op_maintenance:       id, name, interval_days, last_done, next_due, assignee_id,
                      status DEFAULT 'open', created_at
op_maintenance_history: history rows per completed maintenance cycle
op_faults:            id, title, description, notes, reported_by, assignee_id,
                      status DEFAULT 'open', created_at, resolved_at
op_activity_log:      id, entity_type, entity_id, type DEFAULT 'note', body, created_by, created_at
op_reminders:         id, entity_type, entity_id, title, due_date, due_time, assigned_to,
                      done, done_at, remind_sent_at, created_by, created_at
```
`op_activity_log` and `op_reminders` are polymorphic — `entity_type` is `task` | `maintenance` | `fault`.

### RSVP (אישורי הגעה)
```
rsvp_campaigns: id, event_id → leads.id, name, host_name, event_date, event_time,
                venue_address, template_name DEFAULT 'rsvp_invitation',
                reminder_template_name DEFAULT 'rsvp_reminder',
                status CHECK (status IN ('draft','active','closed')), created_by, created_at
rsvp_guests:    id, campaign_id, name, phone, guest_count,
                state CHECK (state IN ('not_sent','invited','awaiting_count','confirmed','declined')),
                invited_at, responded_at, created_at, UNIQUE(campaign_id, phone)
rsvp_messages:  id, campaign_id, guest_id, direction CHECK (direction IN ('inbound','outbound')),
                body, created_at
```

### AI knowledge base + sales AI
```
ai_knowledge_files: id, filename, stored_name, content_text, uploaded_by, created_at
ai_knowledge_media: id, title, description, url, media_type DEFAULT 'video',
                    source DEFAULT 'upload', stored_name, uploaded_by, created_at
lead_ai_advice:     lead_id PRIMARY KEY → leads.id, data JSONB, generated_at, updated_by
sales_briefing_log: id, kind, recipient → users.id, sent_on DATE,
                    UNIQUE (kind, recipient, sent_on)   -- one briefing per kind per rep per day
event_costs:        id, lead_id UNIQUE → leads.id, lines JSONB DEFAULT '[]',
                    ai_generated_at, updated_by, updated_at
```
`event_costs.lines` = `[{ id, label, basis, qty, unit_price, amount }]`. The **server**
multiplies `qty × unit_price` (`normalizeLine`) for both AI-generated and hand-edited
lines — the model is never trusted to do arithmetic.

### Deal-advisor signals + payment signals (2026-09-13)
```
contract_views:   id, contract_id → contracts.id, viewed_at, user_agent
                  -- one row per open of the public signing page (GET /api/contracts/:token)
payment_signals:  id, lead_id → leads.id, kind ('deposit'|'full_payment'), detected_at,
                  said_at (the payment date entered), amount NUMERIC, snippet, marked_by → users.id,
                  status ('open'|'done'|'dismissed'), resolved_at, resolved_by → users.id
                  -- message_id / interaction_id / method exist from the first version, unused
```
`settings` key added: `sales_loss_lessons` (latest loss-insight patterns/recommendations,
fed to the advisor).

### Finance module (כספים)
```
finance_periods:          id, name, created_at            -- one reconciliation round
finance_period_entries:   id, period_id, source, entry_date, name, description,
                          amount, fingerprint, created_at  -- snapshot of the uploaded expenses
finance_missing_expenses: id, period_id, fingerprint, entry_date, name, description, amount,
                          source VARCHAR(10), status, status_updated_at, resolved, resolved_at,
                          deferred_from_period_id, created_at
                          UNIQUE INDEX (period_id, fingerprint)
finance_expense_notes:    id, expense_id, body, created_by, created_at
finance_gmail_accounts:   id, email UNIQUE, token_json, active, last_scan_at, created_at
finance_scanned_emails:   gmail_id PRIMARY KEY, account_email, is_invoice, scanned_at
finance_invoice_files:    id, gmail_message_id, account_email, email_subject, email_from,
                          email_date, filename, source_kind, status, error,
                          drive_file_id, drive_link, drive_folder, created_at
                          UNIQUE (gmail_message_id, filename)
```
`source` is `בנק` / `כאל` / `מקס`. An item's **fingerprint can change between runs**
(a bank transfer gains a payee name from the transfers-list enrichment), so a new run
adopts the matching open item by source/date/amount instead of creating a duplicate —
this is what preserves the user's status and notes.

### Infrastructure tables
```
google_calendar_cache: google_event_id PRIMARY KEY, title, description, start_time, end_time,
                       all_day, color_id, html_link, source DEFAULT 'google', fetched_at
drive_cached_files:    id, folder_id, folder_name, drive_file_id UNIQUE, name, mime_type,
                       size, drive_modified_time, stored_name, public_url, synced_at
user_sessions:         id, user_id, started_at, last_ping_at  (presence / ניהול dashboard)
settings:              key TEXT PRIMARY KEY, value TEXT, updated_at
```

### `settings` keys in use
| Key | Used by |
|---|---|
| `ai_instructions` | tone/style rules injected into every AI reply/improve prompt |
| `ai_knowledge_text` | free-text knowledge appended to the AI chat system prompt |
| `staff_signature` | signature image printed on contracts |
| `contract_email_body` / `contract_email_bank` | default contract email text + bank payment details |
| `wa_chatbot_enabled` / `wa_chatbot_greeting` / `wa_chatbot_followup` | WhatsApp auto-reply bot |
| `sales_briefing_enabled` / `sales_briefing_morning_hour` / `sales_briefing_evening_hour` | AI sales briefings (default 8 / 18, Asia/Jerusalem) |
| `finance_exclusions` | rows never counted as missing expenses |
| `finance_drive_root_id` / `finance_drive_root_link` | Drive folder invoices are filed into |
| `finance_last_auto_scan` | timestamp of the last nightly invoice scan |
| `seating_custom_items` / `seating_element_overrides` / `seating_templates` | seating-chart editor |
| `drive_folders` | Drive folders synced into `drive_cached_files` |
| `google_token` | Google OAuth token stored in DB (survives redeploys) |

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
| POST | `/:id/email/send` | Send email via Gmail API + upload attachment to Supabase. `to` accepts an array or a comma-separated list → one RFC 5322 `To:` header |
| GET | `/:id/messages` | WhatsApp messages |
| PATCH | `/:id/remaining-balance` | Manual override of the computed balance (`remaining_balance_override*`) |
| PATCH | `/:id/interactions/:interactionId` | Edit a logged interaction |
| GET/POST | `/:id/contacts` | Extra contact people (`lead_contacts`) |
| DELETE | `/:id/contacts/:cid` | Remove a contact person |
| GET/PUT | `/:id/seating` | Seating layout per section (`seating_layouts`) |
| GET/POST | `/:id/suppliers` | Suppliers attached to the event (`lead_suppliers`) |
| DELETE | `/:id/suppliers/:supplierId` | Detach a supplier |
| POST | `/:id/send-review` | Send the customer a review request |

### WhatsApp (`/api/whatsapp`) — webhook is public, send requires auth
| Method | Path | Description |
|---|---|---|
| POST | `/webhook` | Receives Green API webhook. Handles text + media (imageMessage, documentMessage, audioMessage, videoMessage). Media downloaded and uploaded to Supabase. |
| POST | `/send` | Send text message (auto-advances new→contacted). `phone` accepts one number, a comma-separated list, or an array — one send + one `messages` row per recipient |
| POST | `/send-file` | Send file: upload to Green API → Supabase → insert into files table → embed [[FILE:id\|name]] in message. `phone` accepts several recipients (file uploaded once, sent to each) |

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

### Tasks — global list (require auth) — `server/routes/tasks.js`
| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks` | All tasks across all leads. Params: `?assigned_to`, `?status` (pending/overdue/completed), `?search`. Returns tasks with `sort_bucket` (1=overdue, 2=today, 3=upcoming, 4=no date, 5=completed), `lead_name`, `assigned_name`. |
| GET | `/api/tasks/overdue-count` | Returns `{ count }` of pending overdue tasks. Used for nav badge. |
| GET | `/api/tasks/users` | Returns all users for the filter dropdown. |

> **Route order in `index.js`:** `routes/tasks.js` is mounted before `routes/taskPostpone.js`. The global routes use exact paths (`/`, `/overdue-count`, `/users`) so they don't conflict with taskPostpone's `/:taskId/something` pattern.

### Tasks — public (token-validated JWT) — `server/routes/taskPostpone.js`
| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks/:taskId/postpone-info?token=` | Returns task title + lead name for action page |
| POST | `/api/tasks/:taskId/postpone` | Reschedule task: `{ token, minutes }` or `{ token, dueAt }`. Resets `remind_sent_at`. |
| POST | `/api/tasks/:taskId/complete` | Complete task: `{ token, result? }`. Logs result to timeline. |
| POST | `/api/tasks/:taskId/create-followup` | Create follow-up task: `{ token, title, dueAt? }`. Inherits lead_id, assigned_to, remind_via. |

### Production (`/api/production`) — auth required, production role or admin/manager
| Method | Path | Description |
|---|---|---|
| GET | `/unready-events?days=7` | `{ count, events[] }` — deposit/production leads with an event in the next N days and something open (`missing[]`: brief / checklist / deposit / production_manager) |
| GET | `/briefing-preview?kind=morning\|close` | The production WhatsApp text as it would be sent (nothing sent) |

### Calendar (`/api/calendar`) — auth required except ICS + confirm
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/leads` | ✅ | All leads with event dates + calendar status |
| POST | `/leads/:leadId/mark` | ✅ | Mark event as option or confirmed |
| POST | `/leads/:leadId/unmark` | ✅ | Take the lead off the calendar: deletes the Google event (stored id + any event of the lead found by `crmLeadId`/`ליד #` marker), deletes the `calendar_events` row, logs `🗓️ האירוע הוסר מיומן Google` |
| GET | `/leads/:leadId/status` | ✅ | Get calendar_events row. Also verifies the linked Google event still exists; if it was deleted on Google, re-syncs (relink or recreate) before answering |
| POST | `/leads/:leadId/meeting` | ✅ | Create Google Calendar meeting. Logs `meeting` interaction to timeline. Body: `{ title, start, end, guestEmail, guestName }` |
| GET | `/meetings/:eventId/details` | ✅ | Fetch meeting row (title, start_time, end_time) |
| DELETE | `/meetings/:eventId` | ✅ | Cancel meeting: delete GCal event, clear `leads.meeting_event_id`, log cancellation with reason to timeline. Body: `{ reason }` |
| PATCH | `/meetings/:eventId/reschedule` | ✅ | Postpone meeting: update GCal event, update DB, log to timeline. Body: `{ newStart, newEnd, reason }` — ISO strings built on frontend (Jerusalem TZ) |
| GET | `/meetings/:eventId/ics` | public | ICS download — lead clicks from phone |
| GET | `/meetings/:token/confirm` | public | Lead self-confirmation link → updates confirmed_at + patches GCal description |
| POST | `/meetings/:eventId/remind` | ✅ | Send WhatsApp reminder to lead |
| POST | `/meetings/:eventId/notify` | ✅ | Send Google Calendar email invite to attendees |
| GET | `/meetings/:eventId/status` | ✅ | Check attendee RSVP, update lead.meeting_rsvp_status |
| POST | `/sync-all` | ✅ | Bulk-sync all leads with event dates to Google Calendar |

### AI (`/api/ai`) — all require auth
| Method | Path | Description |
|---|---|---|
| POST | `/transcribe` | multipart audio (≤25MB) → `{ text }` — OpenAI Whisper (`whisper-1`, `language: 'he'`). Powers the voice-note button in the activity composer |
| POST | `/translate` | `{ text, to: 'he'\|'en' }` → `{ result }` |
| POST | `/reply` | `{ leadId }` → reads full conversation + `ai_instructions` from settings → `{ result }` |
| POST | `/improve` | `{ text }` → `{ result }` + `ai_instructions` from settings |

### Admin (`/api/admin`) — require auth + admin role
| Method | Path | Description |
|---|---|---|
| GET | `/settings` | Returns all settings as `{ key: value }` object |
| PUT | `/settings/:key` | Upserts a setting value |
| GET | `/whatsapp-status` | Green API instance health |
| GET/POST | `/users` | List / create users (roles array, phone, email) |
| PUT/DELETE | `/users/:id` | Update (incl. `blocked`) / delete a user |
| POST/DELETE | `/settings/staff-signature` | Upload / remove the signature image printed on contracts |
| POST | `/settings/floorplan/:section` | Upload a floor-plan background for a seating section |
| GET | `/settings/floorplan/:section/url` | Signed URL for that background |
| PUT | `/seating/custom-items` | Custom draggable items for the seating editor |
| PUT | `/seating/element-overrides` | Per-element visual overrides |
| GET/POST | `/seating/templates` | Seating templates gallery |
| DELETE | `/seating/templates/:id` | Delete a template |
| POST | `/google-token` | Store a fresh Google OAuth token in `settings` |
| GET/POST | `/knowledge-files` | AI knowledge base: list / upload (text extracted + original stored) |
| GET | `/knowledge-files/:id/url` | Signed URL for the stored original |
| DELETE | `/knowledge-files/:id` | Remove file + stored object |
| GET/POST | `/knowledge-media` | AI knowledge images/videos the assistant can show |
| DELETE | `/knowledge-media/:id` | Remove media + stored object |

### Users (`/api/users`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/` | List all users |
| POST | `/` | Create user (admin only) |
| PATCH | `/:id` | Update user |

### Analytics (`/api/analytics`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Period KPIs + sales-activity funnel + source breakdown + 6-month bars (see "Analytics") |
| GET | `/employee-activity` | Per-employee activity metrics for the ניהול dashboard |

### Calendar — additional endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| GET/POST | `/acl` | ✅ | Google Calendar sharing rules |
| DELETE | `/acl/:ruleId` | ✅ | Remove a sharing rule |
| GET | `/google-events` | ✅ | Events from `google_calendar_cache` (polled every 5 min) + Israeli holidays |
| POST | `/events` | ✅ | Create a manual Google Calendar event (`crmManual` extendedProperty, rendered brown) |
| DELETE | `/events/:eventId` | ✅ | Delete a manual event |

### Price Offers (`/api/leads/:id/price-offer`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/latest` | Most recent offer for the lead (used by "import from previous document") |
| POST | `/` | Create + render the offer, save to `price_offers`, optionally send by email/WhatsApp |

### Contracts
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/leads/:id/contracts/latest` | ✅ | Latest contract for the lead |
| POST | `/api/leads/:id/contracts` | ✅ | Create contract, render PDF, send by email or WhatsApp. `download: true` streams the PDF back inline instead of sending (and does not advance the stage) |
| GET | `/api/contracts/:token` | public | Contract payload for the customer signing page |
| POST | `/api/contracts/:token/sign` | public | Sign: stores signer name / ID / signature image, renders the signed PDF, files it to the lead and sends it back to every recipient the contract was sent to |

### GreenInvoice — financial documents (`/api/greeninvoice`) — require auth
| Method | Path | Description |
|---|---|---|
| POST | `/document` | Issue a financial document. **Manager/admin → issued immediately**; anyone else → saved to `pending_documents` and managers get a WhatsApp with a `/?pendingDocs=1` deep link |
| GET | `/pending` · `/pending/count` | Manager/admin: the approvals queue + nav badge |
| POST | `/pending/:id/approve` · `/pending/:id/reject` | Approve (issues the document) / reject with a comment |
| GET | `/reviewed-for-me` | Creator's banner: documents of mine that were approved/rejected |
| POST | `/reviewed-for-me/seen` | Dismiss that banner (`creator_seen`) |

**Gotcha:** `taxId` must be **digits only** — a formatted ח.פ/ת.ז makes GreenInvoice
return error `1111`. Stripped server-side (commit `77d184b`).
The issued PDF is downloaded from the pre-signed URL and saved to the lead's files.

### Sales / AI sales agent (`/api/sales`) — admin, manager, sales_manager or sales
| Method | Path | Description |
|---|---|---|
| GET | `/closed-events` | Closed events for a month — the רווחים page feed |
| PUT | `/costs/:leadId` | Save cost lines (server recomputes `qty × unit_price`) |
| POST | `/costs/:leadId/generate` | AI-generate cost lines from the cost-model KB doc + contract |
| POST | `/costs/generate-missing?year&month` | Backfill months closed before the auto-generation hook existed |
| GET | `/worklist` | Ranked call list. `sales` → own assigned leads; admin/manager/sales_manager → all, rep-tagged |
| GET | `/briefing-preview?kind=morning\|evening` | The WhatsApp briefing text exactly as the calling user would receive it (role scope). Preview only, nothing is sent — for checking the format against real data |
| GET/POST | `/leads/:leadId/advice` | Cached per-lead deal advice (`lead_ai_advice`) / regenerate |
| GET | `/loss-insights` | Aggregated reasons deals were lost |

### Finance (`/api/finance`) — admin, manager or finance
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/exclusions` | Rows never counted as a missing expense |
| POST | `/reconcile` | Upload karteset files + expense files (bank / CAL / MAX) → compare, upsert missing items, snapshot the entries |
| POST | `/rekarteset` | Upload **only** the accountant's updated karteset → re-compare against the stored entries; newly covered items auto-resolve with a timestamped status |
| GET | `/missing` | The open items of a period |
| PATCH | `/missing/:id` | Update status / resolve |
| POST | `/missing/:id/move` | Defer an item to another period (`deferred_from_period_id`) |
| GET/POST | `/missing/:id/notes` | Notes thread on an item |
| GET/POST | `/periods` · DELETE `/periods/:id` | Reconciliation rounds (the chips bar) |
| POST | `/scan` · GET `/scan/status` | Invoice email scan — runs in the background with live progress |
| GET | `/invoices` | Scanned invoice files and where they landed in Drive |
| GET | `/gmail/accounts` · `/gmail/connect-url` · DELETE `/gmail/accounts/:id` | Extra OAuth-connected mailboxes to scan |
| GET | `/api/finance/gmail/oauth/callback` | Public OAuth callback (mounted outside the auth guard) |

### Operations (`/api/operations`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/summary` · `/users` | Dashboard counters; assignable users |
| GET/POST | `/tasks` · PUT/DELETE `/tasks/:id` | Operations tasks |
| GET/POST | `/checklists` · GET/PUT/DELETE `/checklists/:id` | Inventory checklists (`items` JSONB) |
| POST | `/checklists/:id/item-notes/:itemIndex` | Permanent per-item note (author + timestamp) |
| DELETE | `/checklists/:id/item-notes/:itemIndex/:noteIndex` | Delete one note |
| POST/PUT | `/checklist-runs` · `/checklist-runs/:id` | A filled-in run of a checklist ("filled-by" stamp) |
| GET/POST | `/maintenance` · GET/PUT/DELETE `/maintenance/:id` | Recurring maintenance (`interval_days` → `next_due`) |
| PUT | `/maintenance/:id/complete` | Close a cycle, write `op_maintenance_history`, roll `next_due` |
| GET/POST | `/faults` · GET/PUT/DELETE `/faults/:id` | Fault reports |
| GET/POST | `/activity/:entityType/:entityId` | Activity thread on a task / maintenance / fault |
| POST | `/activity/:entityType/:entityId/file` | Attach a file to that thread |
| GET/POST | `/reminders/:entityType/:entityId` · PUT/DELETE `/reminders/:id` | Reminders, delivered by WhatsApp |

### Suppliers (`/api/suppliers`) — require auth
| Method | Path | Description |
|---|---|---|
| GET/POST | `/categories` · DELETE `/categories/:id` | Supplier categories |
| GET/POST | `/` · GET/PUT/DELETE `/:id` | Supplier CRUD |
| GET | `/:id/events` | Events this supplier worked (`lead_suppliers`) |
| GET/POST | `/:id/interactions` · DELETE `/:id/interactions/:intId` | Interaction log |
| GET/POST | `/:id/files` · GET `/:id/files/:fileId/url` · DELETE `/:id/files/:fileId` | Supplier files (signed URLs) |
| POST | `/:id/whatsapp-file` | Send a supplier file over WhatsApp |

### RSVP (`/api/rsvp`) — webhook public, rest require auth
| Method | Path | Description |
|---|---|---|
| GET/POST | `/webhook` | Meta WhatsApp Cloud API webhook — verification + guest replies |
| GET/POST | `/campaigns` · GET/PUT `/campaigns/:id` | Campaign CRUD |
| GET/POST | `/campaigns/:id/guests` · DELETE `/campaigns/:id/guests/:guestId` | Guest list |
| POST | `/campaigns/:id/guests/import` | Bulk import (xlsx/csv) |
| POST | `/campaigns/:id/send` · `/campaigns/:id/remind` | Send the approved template to guests / send reminders |
| GET | `/campaigns/:id/messages` · `/campaigns/:id/export` | Message log / export the results |

**Guest state machine:** `not_sent` → `invited` → `awaiting_count` (guest said yes,
bot asks how many) → `confirmed`, or → `declined`.

### Event brief & production checklist — require auth
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/api/leads/:id/event-brief` | The event brief (`event_briefs.data` JSONB). Auto-fills from the signed contract; supplier rows are stored as snapshots in `data.categorySuppliers` |
| GET | `/api/leads/:id/production-checklist` | Checklist state |
| POST | `/api/leads/:id/production-checklist/:item` | Toggle one item (who + when) |

### AI Chat (`/api/chat`) — auth inside the route
| Method | Path | Description |
|---|---|---|
| POST | `/` | The assistant. SSE streaming, OpenAI tool calling, tools filtered by the user's roles. SSE events: `text`, `tool_call`, `action` (a proposal card — see below), `done`, `error` |
| GET | `/media` | Signed URL for a knowledge-base image/video the assistant referenced (`[[media:ID]]`) |
| GET | `/files` | Knowledge files with a stored original (`ai_knowledge_files.stored_name`), signed 6h — rendered as `[[file:ID]]` chips |
| POST | `/send` | Send a knowledge file / media item over WhatsApp: `{ kind: 'file'|'media', id, leadId? \| phone? \| toSelf? }`. Downloads from the private bucket, uploads once to Green API, `sendFileByUrl`; an external media URL (YouTube/Drive) goes as text. Logged on the lead's timeline when a lead is the recipient (`services/waOutbound.js`) |
| POST | `/actions` | Execute a proposal the user confirmed: `{ kind: 'task'|'note'|'fault', …fields }` → `tasks` / `lead_interactions` (type note, `source='assistant'`) / `op_faults` (+ activity log "נפתח דרך העוזר"). Role-gated like the matching `propose_*` tool |

### Public (`/api/public`) — no auth
| Method | Path | Description |
|---|---|---|
| POST | `/demo-request` | Landing-page form `{ name, phone, business, website (honeypot), page, ref }`. Israeli phone required; 5 requests / IP / hour; creates or annotates a lead (`source='landing'`) and WhatsApps every admin a link to it |

### Payment signals (`/api/payment-signals`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/count` | Open "תשלום ללא מסמך" count — admin/manager/finance (others get 0) |
| GET | `/` | Open list with lead name/event — admin/manager/finance |
| GET | `/lead/:leadId` | Open signals of one lead (feeds the lead-card banner) |
| POST | `/:id/dismiss` · `/:id/done` | "לא רלוונטי" / closed by hand |

### Drive (`/api/drive`) + Presence (`/api/presence`) — require auth
| Method | Path | Description |
|---|---|---|
| GET | `/drive/folders` · `/drive/folders/:folderId/files` | Browse the configured Drive folders |
| GET | `/drive/files/:fileId/meta` · `/drive/files/:fileId/content` | File metadata / contents (attach to a lead) |
| POST | `/presence/ping` | Heartbeat → `user_sessions` (drives "who is online" in ניהול) |

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

**Tabs:** פרטים ופעילות | משימות | וואטסאפ ואימייל
(plus, once the lead reaches `deposit` / `production` / `completed`: **בריף אירוע**
and **סידור הושבה**, opened as overlays.)

#### Info Tab sections:

**סטטוס** — stage pills, "לא סגרו" button, "📅 קבע פגישה", "+ משימה", RSVP badge

**יומן Google**
- 🟡 אופציה / ✅ סגור toggle for event date calendar marking
- Clicking the already-active button (סגור when confirmed / אופציה when option) opens a confirm popup "להסיר את האירוע מהיומן?" → `POST /unmark` removes the event from Google and the CRM ("לא מסומן ביומן"). Moving a lead to לא סגרו does the same removal (robust to a stale stored id).
- The Google event carries `extendedProperties.private.crmLeadId`. If the stored `google_event_id` no longer exists on Google (404/410), the sync looks for another event of the same lead around the event date (by `crmLeadId`, then by the `ליד #<id>` text in the description), relinks to it and recolours it; otherwise it creates a new event. Same recovery runs when the lead card loads (see `/status`), so "פתח ביומן Google" never points at a deleted event.
- When `lead.meeting_event_id` is set: shows "נקבעה פגישה ל-[DD/MM/YYYY HH:MM]" block
- Button "בטל\דחה פגישה" opens `MeetingActionModal`:
  - **בטל פגישה**: enter reason → deletes GCal event, clears `meeting_event_id`, logs `❌ פגישה בוטלה` to activity
  - **דחה פגישה**: enter reason + new date (calendar picker) + start/end time (time picker) + delivery channel (WhatsApp/Email) → updates GCal event, sends updated invite, logs `🔄 פגישה נדחתה` to activity

**פרטי ליד** — all lead fields, inline notes editor

**תשלומים / הפקה** — אחראי הפקה dropdown, deposit amount + date + confirmed, full payment amount + date + confirmed (both amounts auto-filled from the signed contract incl. VAT when empty), יתרה לתשלום, production notes (stages deposit/production/completed)

**קבצים**
- Upload via button or drag-and-drop
- Each file shows 🗑️ delete button (with confirmation)
- Clicking a file calls `openFile(id)` → fetches signed URL → opens in new tab
- Files never accessed via direct Supabase URL (always through CRM auth)

**פעילות (Timeline)**
- Combined feed of `lead_interactions` + `messages`, newest-first
- Every entry shows: timestamp, author name (who performed the action), direction badge, type badge
- Quick-log: 📞 שיחה | 🤝 פגישה | 📝 הערה | 📱 שלח וואטסאפ | ✉️ שלח אימייל
- Sending WhatsApp: shows confirmation popup "האם אתה בטוח שאתה רוצה לשלוח את הודעת הוואטסאפ?" before sending
- Inbound items: 🌐 תרגם לעברית button
- Compose forms: AI buttons (🌐 תרגם לאנגלית / 🤖 הצע תשובה / ✨ שפר)
- `[[FILE:id|name]]` markers rendered as clickable file badges (open via signed URL)
- Stage change notes shown as `🔄 שינוי שלב: X ← Y`
- Auto-logged events (all include acting user name):
  - Meeting scheduled: `📅 פגישה נקבעה: [title] | [date] [start]–[end]`
  - Meeting cancelled: `❌ פגישה בוטלה | תאריך שהיה: [date time] | סיבה: [reason]`
  - Meeting postponed: `🔄 פגישה נדחתה | תאריך חדש: [date] [start]–[end] | סיבה: [reason]`
  - Stage change: `🔄 שינוי שלב: [from] ← [to]`

### `TasksPage.jsx` (`/tasks`) ✅ Built 2026-04-26

Global view of **all tasks across all leads** in one place.

**Ordering (top → bottom):**
1. 🔴 **באיחור** — overdue, oldest first
2. 🟡 **היום** — due today
3. 🟣 **קרוב** — upcoming, sorted by due_at ASC
4. ⚪ **ללא תאריך** — no due date, sorted by created_at ASC
5. ✅ **הושלמו** — hidden by default, "הצג הושלמות (N)" toggle reveals them

**Filters:**
- Search input (debounced 300ms) — by task title or lead name
- Assigned-to dropdown — all users
- Status select — ממתינות / באיחור / הכל
- "שלי" quick toggle — filters to current logged-in user's tasks only

**Task row shows:** ✓ complete button, task title, lead name link (click → opens LeadCard overlay), due date (color-coded by urgency), assigned user pill.

**Inline complete:** ✓ button → bottom sheet → optional result text → `PATCH /api/leads/:leadId/tasks/:taskId/complete`.

**Overdue badge:** Red bubble on the משימות tab icon in the bottom nav. Polled every 60s from `GET /api/tasks/overdue-count`.

### Bottom Navigation (2-row fixed bar)

The nav bar has two rows rendered in `AppShellNav` inside `App.jsx`.

**Row 1 is mode-dependent** — the tabs change with the mode selected in the top bar.
The original list (👥 לידים | 📅 לוח שנה | 📊 אנליטיקס | ✅ משימות) is what the מכירות
mode shows, now with 💡 AI מכירות added. See the full table under "App Modes".

**Row 2 (admin only, darker tint below row 1):** ⚙️ הגדרות

Active tab: white top-border indicator + full white text. Overdue count badge on the
משימות tab icon — the count is **scoped to the current mode**
(`GET /api/tasks/overdue-count?mode=…`).

### Lead deep links — `/?lead=ID` (fixed 2026-09-08)

Every link to a lead anywhere in the system is `{baseUrl}/?lead={leadId}`: Google
Calendar event descriptions (`calendarService.js`), WhatsApp/email notifications
(`whatsapp.js`, `gmailService.js`, `reminderService.js`, `salesBriefingService.js`),
the AI chat's markdown links (`chat.js`) and in-app navigation
(`SalesWorklistPage.jsx`). **Contract: that link always opens the lead's card.**

How it resolves: `/` renders `RootRedirect` → `LeadsPage`. `LeadsPage` reads the
`lead` param, opens `LeadCard` for it and strips the param from the URL.

**The bug that was fixed:** `RootRedirect` also bounces `/` to the last-used
mode's page (`crm_mode` in localStorage → `/sales-performance`, `/events`,
`/suppliers`, …) — and it did so without looking at the query string, so any
lead link opened while the last mode was not מכירות landed on that mode's page
instead of the lead. Now, when `?lead=` is present, `RootRedirect` does not
redirect at all and switches the mode to מכירות so the header and bottom nav
match the page being shown. Without `?lead=` the mode redirect is unchanged.

**Rule for any new page-level redirect:** check `location.search` first — a deep
link must survive it.

### Phone-width layout rules (learned 2026-09-07/08)

The app is used mostly from phones, but most screens were laid out for desktop
width. Four bugs in two days had the same shape; the rules that fix them:

1. **Every `text-*` is 12.5% bigger than its name** — `index.css` sets `html {
   font-size: 18px }`, so `text-2xl` is 27px, not 24px. Size KPI text with
   `clamp()` or give it fewer columns on a phone (`SalesPerformancePage`).
2. **A non-wrapping flex row must not hold more than fits at 360px.** Use
   `flex-wrap sm:flex-nowrap` and let secondary items (badges, role pills) drop to
   their own line; give the primary text `flex-1 min-w-0` (LeadCard header,
   AdminPage user rows).
3. **Unbroken strings need a break rule.** Emails, ICS/JWT URLs and camera file
   names have no spaces; without `wrap-anywhere` / `wrap-break-word` (+ `min-w-0`
   on the flex child) they widen their container and the whole scroll body
   scrolls sideways. Put `overflow-x-hidden` on every `overflow-y-auto` body as a
   backstop (LeadCard body, WhatsApp tab).
4. **`<input>` and `<button>` do not behave like `<div>` in flex.** An input keeps
   its intrinsic width unless it has `min-w-0`; a button does not stretch to its
   parent even as `display:block`, so `truncate` on a button needs `w-full`
   (AdminPage inputs, LeadCard `FilesSection`).

Every fix is a bare phone rule overridden at `sm:` so desktop stays byte-identical;
verify by rendering the built bundle headless at 360/390/430 and asserting no
element's box leaves the viewport and no scroll container has `scrollWidth >
clientWidth` (the harness lives in bedrock notes for 2026-09-08).

### `AdminPage.jsx` (`/admin`) — admin only
- ⚙️ tab visible in row 2 of bottom nav, admin only
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

### `SalesPerformancePage.jsx` (`/sales-performance`) — "רווחים" mode
Per-month profit view: a month navigator, three summary cards (events closed /
revenue before VAT / total profit), the amber backfill banner for months closed
before costs were computed automatically, and one expandable card per closed
event (amount, costs, profit → `CostEditor`).

**Summary-card layout (fixed 2026-09-07).** Three cards to a row leaves each one
about 100px wide on a 360px phone, and a six-figure sum at `text-2xl` (27px —
`html` is 18px, so `text-2xl` is 27px, not 24px) spilled outside its card. Now:
`grid-cols-2 sm:grid-cols-3`, with the count card `col-span-2 sm:col-span-1`, so
a phone gets the count on its own row and the two money cards sharing the next
(~160px each) while `sm:` and up keep the original 3-across row untouched. The
amounts use `text-[clamp(1rem,5.7vw,1.5rem)]` + `whitespace-nowrap`, and each
card is `overflow-hidden` as a last resort. Verified by rendering at 360/390/430
with seven-figure sums — nothing clips, and from ~470px up the size is exactly
`text-2xl` as before. **Keep this in mind for any new KPI-card row:** a Hebrew
RTL card that is one third of a phone screen fits roughly 5-6 digits at most.


### `SalesWorklistPage.jsx` (`/sales-worklist`) — "AI מכירות" ✅ Built 2026-08-27

The prioritized call list. Ranking is **rule-based, not per-lead AI**:

- tier 1 — contract sent, not signed
- tier 2 — offer sent
- tier 3 — urgent / hot
- inside a tier (since 2026-09-13): a near event (next 45 days) first, then the advisor's
  temperature (hot > warm > unknown > cold), then the deal value (latest contract total, else
  latest offer total — `offerTotal` / `contractTotal` in `salesAdvisor.js`), then freshness

Each row shows the temperature pill and the deal value. `sales` sees their own assigned
leads; admin/manager/sales_manager see everything, tagged by rep. A second tab shows
**loss insights** — aggregated reasons deals were lost; the latest patterns +
recommendations are also saved to `settings.sales_loss_lessons` so the per-lead advisor
can apply them.

**DealAdvisor** (in the lead's info tab, "יועץ עסקה") is the per-lead AI part
(`gpt-4o-mini`, JSON, cached in `lead_ai_advice`). Since 2026-09-13 the model sees the
**whole deal**: offer amount + lines, contract status / age / how many times the signing
page was opened (`contract_views`), meetings, open tasks, who spoke last and the customer's
average reply time, the sales playbook (`ai_instructions` + `ai_knowledge_text`) and the
loss lessons. Response: `{ temperature, headline, summary, evidence[], next_action,
suggested_task { title, due_in_days }, suggest_meeting, draft_message, deal_value }`.
The card renders evidence bullets and turns the recommendation into buttons: **"צור
משימה: …"** opens `AddTaskModal` prefilled (title + date, 10:00, `initial` prop),
**"קבע פגישה"** opens `ScheduleMeetingModal`, "השתמש בטיוטה" pushes `draft_message` into
the WhatsApp composer via the `draftSeed` prop. **Draft-only — nothing is ever auto-sent
to a customer.**

### `FinancePage.jsx` (`/finance`) — "כספים" mode

Two independent tools:

**1. Reconciliation.** Each round is a **period** (`finance_periods`) shown as a chips
bar; items are scoped per `(period_id, fingerprint)`. Separate upload slots for the
accountant's karteset (multi-month, merged) and for the expense exports, with per-source
tabs בנק / כאל / מקס. Bank PDF parsers handle both the transfers list ("רשימת ההעברות")
and the checking-account statement ("יתרה ותנועות בעו״ש", signed amounts, expenses =
negatives only). When both bank reports are uploaded, checking rows are **enriched** with
the payee name from the transfers list (amount + ±4 days match, deduped). Re-uploading the
accountant's updated karteset auto-resolves everything it now covers.

- Some bank exports are **image-based** (≈32KB, no text layer) → explicit warning; the
  user must download the full report. Debug: `node server/scripts/debugBankPdf.js <pdf>`.
- CAL/MAX summary rows are skipped; card-charge rows are in `DEFAULT_EXCLUSIONS`;
  `dd-mm-yyyy` dates supported.

**2. Invoice email scan** (`financeInvoiceScanner.js`). Scans the business Gmail plus any
extra OAuth-connected mailboxes: keyword prefilter → `gpt-4o-mini` JSON mode confirms it is
a supplier invoice → downloads attachments and follows body links (including invoice landing
pages) to the real PDF → files into Drive by **email date**, under the folder configured in
AdminPage ("תיקיית חשבוניות בדרייב") with `MM-YYYY` subfolders. Runs nightly at 20:00 server
time, or manually with presets. Runs in the background with a live progress indicator.
Extra mailboxes: "+ חבר תיבת מייל" on the Finance page opens Google OAuth (gmail.readonly);
the token is stored in `finance_gmail_accounts` and every scan covers all active mailboxes
(files always land in the business account's Drive). The OAuth window is opened
synchronously in the click handler (browsers block `window.open` after an `await`); if it
is still blocked the flow runs in the same tab and the callback page returns to `/finance`.
`credentials.json` is a *Desktop* OAuth client (localhost redirects only), so this flow uses
a separate *Web application* client via env `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET`
whose authorized redirect URI is `${SERVER_URL}/api/finance/gmail/oauth/callback`; the token
refresh for extra mailboxes goes through the same web client. Without these env vars the
button returns a clear error. The Google account must be a test user while the OAuth app is
in Testing mode.

### `OperationsPage.jsx` (`/operations`) — "תפעול" mode
Tasks / maintenance / faults, each with a status lifecycle and a dedicated detail view
(`components/ops/TaskDetail`-style: `ChecklistDetail.jsx`, `FaultDetail.jsx`,
`MaintenanceDetail.jsx`). Inventory checklists support add/edit of items, a "filled-by"
stamp per run, and permanent per-item notes with author and timestamp. Reminders on any
entity go out over WhatsApp. In ops mode the calendar shows an event info card plus the
seating chart.

### `SuppliersPage.jsx` (`/suppliers`) + `SupplierCard.jsx`
Supplier directory by category, with an interaction log, files (signed URLs, sendable
over WhatsApp) and the list of events each supplier worked. The supplier **chip** in a
lead card or an event brief opens the full `SupplierCard` as an overlay (X returns to
where you were); the phone is a `tel:` link.

### `RSVPsPage.jsx` / `RSVPDetailPage.jsx` (`/rsvps`) — "אישורי הגעה" mode
Campaign list and detail: guest import, sending the approved Meta template, reminders,
live counts by state, and export. Replies arrive on the Meta webhook and move the guest
through the state machine.

### `EventsPage.jsx` (`/events`) — "הפקה" mode
Two tabs: **בהפקה** (stages `deposit` / `production`) and **אירועים שהסתיימו**
(`completed`), each row opening the lead card.

### `ManagementPage.jsx` (`/management`) — "ניהול" mode
Employee-activity dashboard for admin/manager. Columns: calls made / calls documented,
meetings done / meetings documented, notes, WhatsApp sent, tasks created / completed,
leads created, files uploaded — over a chosen date range, plus first and last activity
per employee. Fed by `GET /api/analytics/employee-activity` and `user_sessions`.

### `AnalyticsPage.jsx` (`/analytics`) — reworked 2026-08-13
- **KPI cards:** total received / closed / not-closed / still-active (= total − closed −
  lost) / close % / drop %.
- **פעילות card** — a distinct-lead sales funnel: offers sent (`price_offers.created_at`)
  → contracts sent (`contracts.created_at`) → contracts signed (`status='signed'` +
  `signed_at`), each range-filtered on its own table's date, with conversion %.
- **byMonth** — fixed 6 months, purple bars = closings **by close date** (a
  `generate_series` spine), with a hover tooltip.
- **bySource** — kept as a *cohort* view on purpose (it measures source quality, not
  monthly output) and returns closed / offers / contracts per source. Instagram is split
  out of WhatsApp by CTA detection.
- ⚠ Since 2026-08-13 Analytics "closed" is **event-based** — it equals the רווחים page
  count for the same window, instead of the old cohort count.

### `AIChat.jsx` — the assistant
Floating button, SSE streaming, OpenAI tool calling. Tools are filtered by the user's
roles:

| Tool | Roles | What |
|---|---|---|
| `get_my_tasks` | all | open tasks / overdue |
| `get_today_schedule`, `get_schedule`, `get_leads`, `get_lead_details` | admin/manager/sales_manager/sales/production | schedule + leads (own vs all by role) |
| `get_lead_documents` | same | offers (date, total), contracts (status, total, signing-page opens), financial docs (pending + issued), files |
| `get_urgent_leads`, `get_sales_worklist`, `get_analytics_kpis` | admin/manager/sales_manager/sales | leads without contact, the ranked AI worklist, period KPIs + sources |
| `get_op_tasks`, `get_maintenance`, `get_event_brief` | admin/manager/operations/production | ops + the event brief (contract chef/bar/guests, brief data, suppliers, checklist, seating) |
| `get_suppliers` / `get_rsvp_summary` | suppliers / rsvp roles | |
| `get_finance_summary` | admin/manager/finance | pending approvals, open reconciliation items, invoices scanned (30d), payments without a document |
| `get_employee_activity` | admin/manager | per-employee counts (calls, meetings, notes, WA, tasks, leads, contracts sent/signed) + tracked hours |
| `propose_task` (all), `propose_note` (lead roles), `propose_fault` (ops roles) | | **proposals only** |

**Actions with confirmation (2026-09-13).** The assistant never writes by itself: a
`propose_*` tool returns a proposal, the route emits an SSE `action` event, and the chat
renders an `ActionCard` (editable title / date / text, "אשר" / "בטל"). Only "אשר" calls
`POST /api/chat/actions`, attributed to the confirming user. The tool result tells the
model to describe the proposal and not to claim it was done.

**Knowledge base.** The admin-managed knowledge base (`ai_knowledge_files` +
`ai_knowledge_text`) is injected into the system prompt; the assistant can show
knowledge media with a `[[media:ID]]` tag and — since 2026-09-13 — hand over a knowledge
file with a `[[file:ID]]` tag, rendered as a chip (name, open via signed URL). Both media
and file chips carry **"שלח בוואטסאפ"** (`SendSheet`): to the lead the user is looking at,
to the user's own phone, or to any number (`POST /api/chat/send`). The system prompt
lists the sendable files (only rows with `stored_name`; older uploads must be re-uploaded).

> **KB media and the private bucket:** `crm-files` is private, so `getPublicUrl` output
> 404s ("Bucket not found"). Every read — `GET /api/chat/media` and the admin
> knowledge-media routes — signs the URL at read time (`storageService.getSignedUrl`,
> 6h). Never store or serve a public URL from this bucket.

### `SignaturePage.jsx` (`/sign/:token`) — customer contract signing
Public page: reads the contract by token, renders it, takes the signer's name, ID number
and drawn signature, then produces the signed PDF. Fully **bilingual** — every scaffolding
and form string branches on `contract_data.language === 'en'`, mirroring `buildContractHtml`.

### Contracts & price offers — the shared rules
- **Deposit** is calculated from the **pre-VAT subtotal**. `depositAmt` / `depositPct` /
  `depositAmtVat` label overrides are honored in the preview, the signing page and the PDF.
- Hierarchical clause numbering 1–6 with 3.x / 5.x / 6.x, in Hebrew and English.
- Per-price VAT incl/excl entry (rows and extra-guest), free-text lines in the event and
  costs sections, and a גמר חשבון payment-terms block (security + reserve cheques, all editable).
- "Import from a previous document" is the **first** step of both flows. Importing from an
  English document keeps the Hebrew default texts and reverts row labels via the
  `DEFAULT_ROWS` map — only the data is imported; English is applied at preview as designed.
- **Chef/bar menu popup texts** (`fields.chefMenu` / `barMenu`) are anchored to their
  "המחיר כולל" bullet by **content match** (`/תפריט שף|chef menu/i`) — never by array
  index, because the includes list is editable and is imported from offers with a different
  layout. The same logic lives in **5 render sites**: `contracts.js`, `priceOffer.js`,
  LeadCard's contract preview, LeadCard's offer preview, `SignaturePage.jsx`. Keep them in sync.
- The postponement date in the cancellation section is computed (event + 6 months) but
  overridable via `texts.cancellationDateLabel` (the same `*Label` pattern as `remainderAmtLabel`).
- PDFs are rendered with `puppeteer-core` (`PUPPETEER_EXECUTABLE_PATH`).

### Seating charts — `SeatingChart.jsx`, `SeatingTemplateGallery.jsx`
Drag-and-drop canvas per section, saved to `seating_layouts`, with AI assist, per-element
guests and image, a floor-plan background per section and an admin-managed template gallery.

### Pending financial documents — `PendingDocsModal.jsx` / `PendingDocDetail.jsx`
Managers open the approvals queue from the nav badge or from the WhatsApp deep link
`/?pendingDocs=1`, which auto-opens the modal. The document's creator sees a banner with
the approve/reject result until they dismiss it (`creator_seen`).

---

## Background Services (`server/index.js → startCronJobs()`)

| Service | Interval | Notes |
|---|---|---|
| Gmail poll | 10 minutes | `pollGmail()` runs immediately on start. Skipped if no `google_token.json` |
| WhatsApp webhook | On start | Registers `SERVER_URL/api/whatsapp/webhook` with Green API if `SERVER_URL` is set. Includes `incomingWebhook: 'yes'` + `outgoingMessageWebhook: 'yes'` to prevent settings reset on Railway restart. |
| WhatsApp long-poll | Continuous | Used locally when `SERVER_URL` is not set — does not affect webhook registration |
| Task reminders | Every 2 min | 30s delay on boot. Due-task look-ahead: `NOW() + INTERVAL '2 minutes'`. Postpone endpoint also schedules exact-time `setTimeout` so reminder fires at precisely the new due time. |
| Google Calendar poll | Every 5 min | `calendarPollService.pollGoogleCalendar()` → `google_calendar_cache` |
| Israeli holidays import | On start | `importHolidays()` reads `server/data/holidays.json` (2025–2031, Jewish/Israeli only, Hebrew names, built from the user's ICS export). Fetching Google's public holiday calendar did **not** work in production — do not go back to it |
| Drive folder sync | Every 5 min | `driveService.syncDriveFolders()` → `drive_cached_files` |
| Sales briefings | Every 15 min | `salesBriefingService.runSalesBriefings()` — fires the morning/evening WhatsApp briefing when the configured hour arrives |
| Production briefings | Every 15 min | `productionBriefingService.runProductionBriefings()` — production morning briefing at the sales morning hour; "event ended, close it" reminders at `event_close_reminder_hour` (default 10) |
| WhatsApp history sync | Every 30 min | `waSyncService.syncWhatsAppMessages()` — backfills messages Green API delivered while the server was down |
| Meeting reminders | Every 60 min | `meetingReminderService.sendMeetingReminders()` |
| Invoice scan | Daily 20:00 | `financeInvoiceScanner.startDailyInvoiceScan()` |
| Payment-signal close scan | Every 15 min | `paymentSignals.closeDocumentedPaymentSignals()` — closes "תשלום ללא מסמך" signals once their receipt exists (signals are opened synchronously in `PATCH /api/leads/:id`, see below) |

### Payment signals — "תשלום ללא מסמך" (`server/services/paymentSignals.js`) ✅ Built 2026-09-13, reworked 2026-09-14
An employee marks in the lead card that money was received, and no receipt follows.
**Trigger = the employee's marking, not customer messages** (Oran, 2026-09-14):
- `PATCH /api/leads/:id` compares the row before/after: `deposit_confirmed` false→true
  **or** stage → `deposit` ("התקבלה מקדמה") opens a `deposit` signal (amount =
  `deposit_amount`, date = `deposit_date`); `full_payment_confirmed` false→true opens a
  `full_payment` signal. One open signal per (lead, kind).
- Not opened / auto-closed when the lead already has enough **receipt-type documents**:
  files named `קבלה-*` / `חשבונית-מס-קבלה-*` or `pending_documents` of type 400/320 (not
  rejected). A deposit needs 1, a full payment needs 2 when a deposit was marked (else 1).
  The 15-min cron `closeDocumentedPaymentSignals()` closes signals whose receipt appeared;
  the receipt made from the banner calls `/done` explicitly.
- Rows in `payment_signals` (`kind`, `amount`, `said_at` = the payment date entered,
  `snippet` = "מקדמה סומנה כהתקבלה על ידי <עובד>", `marked_by`, `status` open | done |
  dismissed). The `message_id` / `interaction_id` columns are unused since the rework.
- UI: amber **banner at the top of the lead card** ("מקדמה של ₪8,000 סומנה כהתקבלה (10.9)
  — ועדיין לא הופקה קבלה") with **"הפק קבלה ←"** — opens `InvoiceModal` prefilled
  (`initial` prop: type 400 קבלה, amount, item "מקדמה על חשבון האירוע" / "תשלום מלא עבור
  האירוע", payment date = the entered date) — and **"לא רלוונטי"**. Header badge
  **"🧾 N תשלומים בלי קבלה"** for admin/manager/finance → `PaymentSignalsModal` (kind pill,
  row opens the lead; dismiss inline). Also surfaced by the assistant's `get_finance_summary`.

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
- `createMeeting({ leadId, title, start, end, guestEmail, guestName })` — creates GCal event with guest attendee, `sendUpdates: 'none'`; stores row in `meetings` table; logs `meeting` interaction to timeline
- `sendMeetingInvite(eventId)` — patches with `sendUpdates: 'all'` (sends email invite)
- `getMeetingRsvpStatus(eventId, guestEmail)` — returns attendee `responseStatus`
- `deleteMeeting(googleEventId)` — deletes GCal event
- `updateMeetingTime(googleEventId, start, end)` — patches GCal event start/end times
- `patchEventDescription(eventId, prependText)` — prepends text to event description (used by lead self-confirmation)
- Location: `שרביה, פנחס בן יאיר 3, תל אביב`
- **ISO string timezone rule:** start/end ISO strings are always built on the **frontend** (browser in Jerusalem TZ via `new Date(...).toISOString()`) — never on the server — to avoid UTC offset errors

### WhatsApp Meeting Messages
- New meeting: `שלום! קישור לפגישה שנקבעה לך ל-[DD/MM/YYYY] בשעה [HH:MM] בשרביה:\n[ICS URL]`
- Rescheduled: `שלום! הפגישה שלך נדחתה לתאריך [DD/MM/YYYY] בשעה [HH:MM]–[HH:MM].\nהנה הקישור המעודכן:\n[ICS URL]`

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

### Multiple recipients (contact people) ✅ Built 2026-09-05
A lead can have several contact people — `leads.phone`/`leads.email` plus the
extra `lead_contacts` rows (a couple booking a wedding, a client plus their
event producer). Every send flow can now target more than one of them.

- **Client** — `ContactCheckList` in `LeadCard.jsx` replaced the radio buttons
  and `<select>`s in all six send flows (ContractModal, PriceOfferModal,
  WhatsAppTab, TaskActionModal, MeetingActionModal, ScheduleMeetingModal), for
  phones **and** emails. It keeps the existing state shape: the value stays a
  **comma-separated string** (`waPhone`, `emailTo`), so no send code changed.
  It only renders when the lead has more than one contact of that type, and
  shows "יישלח ל-N נמענים" once two or more are ticked.
- **Server (WhatsApp)** — `parsePhoneList()` in `routes/whatsapp.js` splits on
  commas **before** `normalizePhone()` (which strips non-digits, so a raw comma
  list would collapse into one bogus number), then de-duplicates. `/send` and
  `/send-file` loop over the list. A file is uploaded to Green API **once** and
  `sendFileByUrl` is called per recipient. Each recipient gets its own
  `messages` row (`contact_value` = that number), so the timeline shows who
  received what. One recipient failing (e.g. a number not on WhatsApp) is
  logged and skipped — the others still go out; only an all-fail returns 500.
- **Server (email)** — `POST /api/leads/:id/email/send` accepts an array or a
  comma-separated `to` and joins it into one RFC 5322 `To:` header.
- **Contracts** — `contracts.whatsapp_phone` now stores a comma-separated list,
  and the extra email recipients are kept in
  `contract_data.fields.clientEmailExtra` (the first address stays
  `fields.clientEmail`, which is what gets printed on the contract itself).
  On signing, the signed PDF goes back to **every** recipient the contract was
  sent to, on the channel it was sent through.

### WhatsApp auto-reply chatbot

Driven by three `settings` keys: `wa_chatbot_enabled` (`'true'` to arm it),
`wa_chatbot_greeting`, `wa_chatbot_followup`.

- On the lead's **1st** inbound message → send the greeting.
- On the **2nd** → send the follow-up, then run `extractLeadDetails(text)`
  (`gpt-4o-mini`) and fill in `name`, `event_type`, `event_date_text`, `guest_count`
  — **only fields that are still empty** are written.
- **Stage guard** (`e53c089`): the bot replies only while the lead's stage is
  `new` or `new_no_answer` — i.e. while it is still in the "new leads" tab.

### Meta WhatsApp (`server/services/metaWhatsapp.js`)
The Graph API channel, used for RSVP campaign templates and by the AI chat's
`sendText`. Separate credentials from Green API (`META_RSVP_*`).

### Green API outage playbook
`waSyncService.syncWhatsAppMessages()` (every 30 min) backfills messages that arrived
while the server was down. For gaps longer than 24h use
`server/scripts/bulkImport.js` — verified during a real Green API outage.

---

## AI Features

**All AI runs on OpenAI.** The client is created lazily per request, so a missing
`OPENAI_API_KEY` degrades the feature instead of breaking boot.

| Feature | Where | Model |
|---|---|---|
| Voice note → text | `routes/ai.js` `/transcribe` — mic button in the activity composer | `whisper-1` (Hebrew) |
| Translate (he ⇄ en) | `routes/ai.js` `/translate` — per-message button + compose form | `gpt-4o-mini` |
| Suggest reply | `routes/ai.js` `/reply` — reads the full conversation + `ai_instructions` | `gpt-4o` |
| Improve draft | `routes/ai.js` `/improve` + `ai_instructions` | `gpt-4o-mini` |
| Chat assistant | `routes/chat.js` — SSE streaming, role-scoped tool calling | `gpt-4o-mini` |
| Lead extraction from WhatsApp | `routes/whatsapp.js` chatbot | `gpt-4o-mini` |
| Event cost lines | `services/eventCostService.js` — JSON mode over the cost-model KB doc | `gpt-4o-mini` |
| Invoice classification | `services/financeInvoiceScanner.js` — JSON mode | `gpt-4o-mini` |
| Deal advisor + loss insights | `services/salesAdvisor.js` — JSON mode, cached | `gpt-4o-mini` |
| Reminder text | `services/reminderService.js` | `gpt-4o-mini` |

`ai_instructions` (admin-editable free text) is injected into every reply/improve
system prompt. The AI chat additionally gets `ai_knowledge_text` and the extracted
text of every `ai_knowledge_files` row.

> **When touching anything model-related, check the current model names — do not
> answer model questions from memory.**

### AI sales briefings (WhatsApp) ✅ Built 2026-08-27, reworked 2026-09-08
A morning day-opener and an evening summary, sent over WhatsApp: reps get their own
leads, users who see everyone's leads (admin / manager / sales_manager) get **one
aggregate** briefing — even when they also hold the `sales` role (before 2026-09-08 the
rep loop ran first and such users, e.g. Gili, got only their own leads). Fired at most
once per kind per person per day (`sales_briefing_log` UNIQUE `(kind, recipient,
sent_on)`); hours come from `sales_briefing_morning_hour` /
`sales_briefing_evening_hour` (default 8 / 18, Asia/Jerusalem) and the whole thing is
gated on `sales_briefing_enabled`. The cron runs every 15 minutes and checks whether
the hour has arrived.

**Format (2026-09-08) — no AI text at all.** The gpt-4o-mini "motivating opener" was
removed; the message is fully deterministic (`buildBriefingText`):

```
☀️ פתיחת יום — שרביה · יום שלישי 8.9
כל הנציגים                      ← or "הלידים של <rep>"
📝 14 חוזים ממתינים לחתימה
💰 17 הצעות מחיר פתוחות
🔥 86 דחופים / ללא קשר

📝 *חוזים שנשלחו וטרם נחתמו* (14)

1. *שם הלקוח* · <rep>
   חתונה · אירוע 13.11.2026 [🔴 קרוב] · חוזה נשלח 3.9 (לפני 5 ימים)
   קשר אחרון 5.9 (לפני 3 ימים) · שלחנו ללקוח: "…70 chars…"
   ⏳ הלקוח לא ענה כבר 3 ימים — לעשות פולואפ
   https://www.proevent.co.il/?lead=653
```

Per lead: who the rep is, event type/date, **when the contract / price offer was sent**
(`contracts.created_at` / `price_offers.created_at`, tier 1 / tier 2), **the last real
contact** — date, who did it and what it was (`הלקוח כתב` / `שלחנו ללקוח` /
`התקשרנו` / `ניסינו להתקשר, אין מענה` / `הערה` / `פגישה`, plus a 70-char snippet;
stage-change 🔄 and auto-reminder markers are excluded by `getWorklist`) — and a
**"who has the ball" flag**: `❗ הלקוח פנה אחרון` when the last contact was inbound,
`⏳ הלקוח לא ענה כבר N ימים` when we wrote last and ≥2 days passed, `👉 אין קשר מתועד`
when there is nothing. Max 10 leads per tier, then `… ועוד N` with a link to
`/sales-worklist`. Tier 3 items show `עדיפות דחוף/גבוה` instead of a sent date.

---

## Public landing page (`server/landing/`) ✅ Built 2026-09-14

The marketing site for ProEvent lives in the same Express app. Files: `index.html`
(static render of Oran's Claude-Design package `design_handoff_proevent_landing` — the
`sc-for`/`sc-if` loops expanded, texts verbatim, competitor names shown as designed),
`nocturne.css` (the design tokens), `og.png`, `robots.txt`, `sitemap.xml`.

**Routing rule (`server/index.js`):** `GET /` serves the landing page **unless** the
request carries the `crm_app=1` cookie or any query string. `LoginPage` sets the cookie
on login (1 year, `SameSite=Lax`); logout and the 401 interceptor clear it. So a logged-in
browser keeps landing in the app at `/`, WhatsApp deep links (`/?lead=ID`, `/?pendingDocs=1`)
always reach the app, and visitors / Googlebot get the marketing page. "כניסה למערכת" in the
nav → `/login`. Assets under `/site/*` (1-day cache); `/robots.txt` disallows every app
path and points to `/sitemap.xml`.

SEO baked in: title/description, canonical `https://www.proevent.co.il/`, Open Graph +
Twitter card (`/site/og.png`), JSON-LD `SoftwareApplication` + `FAQPage` (from the FAQ
texts), Inter/Heebo via Google Fonts, Phosphor icons via unpkg. Set env
`GA_MEASUREMENT_ID` (G-…) and the gtag snippet is injected at boot; the demo form fires
`generate_lead` on success. Mobile: the README's "under 900px" rules (one column, static
invoice card, burger nav, 36px h1) live in the page's own `<style>`.

Form → `POST /api/public/demo-request` (see API). Thank-you state swaps in place.

**Brand / logo (2026-09-14).** Oran's logo package lives in `client/public/logo/` (served at
`/logo/*` for both the app and the landing page): `mark-gradient.svg` (bolt, gradient
`#7c5cff → #d946ef`), mono marks (accent / white / black), horizontal logos, `favicon.svg`,
`app-icon.svg` / `app-icon-512.png`, plus its README (wordmark = "proevent" in Manrope 700,
"event" in `#d2cefd`). Used: landing nav (mark + wordmark, per the README snippet) and
footer; `client/public/favicon.svg` replaced; app `index.html` → `<title>ProEvent CRM</title>`,
`lang="he"`, apple-touch-icon, `manifest.webmanifest` (name ProEvent CRM, standalone, the
512 icon) so "add to home screen" shows the icon; `LoginPage` shows the app icon above
"שרביה CRM" with a small "proevent" wordmark; the app top bar shows the white mono mark next
to "שרביה CRM". Contract / offer PDFs keep `client/public/logo.jpg` — that is Sharviya's
logo on customer documents, not the product's.

## Runtime DB Migrations (boot)

`server/index.js` runs a long series of `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ...
ADD COLUMN IF NOT EXISTS` statements on every boot (safe to re-run). There is **no
separate migration pipeline** — a new column must be added defensively here, or old
rows and restarts break.

Beyond the original core list below, boot also creates every module table listed in
"Data Model — modules added after the first release", re-applies the `leads` stage /
priority / source CHECK constraints (drop + add, so the allowed values can grow), and
runs a few one-time idempotent data fixes (the Instagram source backfill; the
2026-08-06 finance scanned-email reset).

Original core statements:

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
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_by INT REFERENCES users(id) ON DELETE SET NULL
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
├── PRD.md                          # this document
├── AGENTS.md                       # agent contract for this repo
├── bedrock/                        # project cockpit: Memory / Work / Views
├── client/src/
│   ├── pages/
│   │   ├── LeadsPage.jsx           # sales mode — 4 tabs, search, board
│   │   ├── LeadDetailPage.jsx      # /leads/:id
│   │   ├── EventsPage.jsx          # production mode — בהפקה / הסתיימו
│   │   ├── CalendarPage.jsx
│   │   ├── AnalyticsPage.jsx
│   │   ├── SalesPerformancePage.jsx  # רווחים — profit per closed event
│   │   ├── SalesWorklistPage.jsx     # AI מכירות — worklist + loss insights
│   │   ├── FinancePage.jsx           # כספים — reconciliation + invoice scan
│   │   ├── OperationsPage.jsx        # תפעול — tasks / maintenance / faults
│   │   ├── SuppliersPage.jsx
│   │   ├── ManagementPage.jsx        # ניהול — employee activity
│   │   ├── RSVPs/{RSVPsPage,RSVPDetailPage}.jsx
│   │   ├── SignaturePage.jsx         # public /sign/:token — bilingual
│   │   ├── AdminPage.jsx             # settings, users, KB, seating templates
│   │   ├── TasksPage.jsx
│   │   ├── LoginPage.jsx
│   │   ├── PostponePage.jsx          # legacy standalone postpone page
│   │   └── TaskActionPage.jsx        # complete / postpone / follow-up
│   ├── components/
│   │   ├── LeadCard.jsx              # the big one: info + tasks + WA/email tabs
│   │   ├── AddLeadModal.jsx  AddSupplierModal.jsx  SupplierCard.jsx
│   │   ├── EventBriefModal.jsx  ProductionChecklist.jsx
│   │   ├── SeatingChart.jsx  SeatingTemplateGallery.jsx
│   │   ├── InvoiceModal.jsx  PendingDocsModal.jsx  PendingDocDetail.jsx
│   │   ├── AIChat.jsx  DriveFilePicker.jsx  AppCalendar.jsx  FilterPanel.jsx
│   │   └── ops/{ChecklistDetail,FaultDetail,MaintenanceDetail}.jsx
│   ├── context/AppModeContext.jsx    # the 8 modes + openLeadId
│   ├── utils/{device.js, docTypes.js}
│   ├── api.js                        # axios instance with auth interceptor
│   └── App.jsx                       # routes, RootRedirect, mode-aware bottom nav
├── server/
│   ├── index.js                      # Express app, boot migrations, cron jobs
│   ├── db/{pool.js, migrate.js}
│   ├── middleware/auth.js
│   ├── utils/{phoneUtils.js, leadSource.js}
│   ├── data/holidays.json            # Israeli holidays 2025-2031 (from an ICS export)
│   ├── fonts/                        # Hebrew fonts for PDF rendering
│   ├── scripts/
│   │   ├── googleAuth.js             # re-authorize the Google token (drive.file scope)
│   │   ├── debugBankPdf.js           # inspect a bank PDF the parser choked on
│   │   ├── testReconcile.js          # reconciliation engine vs prototype output
│   │   ├── bulkImport.js             # Green API outage backfill (>24h gaps)
│   │   ├── seedUsers.js  fixGmailDates.js  fixTelekol.js
│   ├── routes/
│   │   ├── auth.js  users.js  leads.js  files.js  fileDownload.js
│   │   ├── whatsapp.js  calendar.js  tasks.js  taskPostpone.js
│   │   ├── contracts.js              # contractLeadRouter + contractPublicRouter
│   │   ├── priceOffer.js  greeninvoice.js
│   │   ├── operations.js  productionChecklist.js  eventBrief.js
│   │   ├── suppliers.js  rsvp.js  drive.js  presence.js
│   │   ├── sales.js  finance.js  analytics.js
│   │   ├── ai.js                     # transcribe / translate / reply / improve
│   │   ├── chat.js                   # AI assistant, SSE + role-scoped tools
│   │   └── admin.js                  # settings, users, KB, seating, floorplans
│   └── services/
│       ├── gmailService.js           # 10-min poll, lead parsing
│       ├── calendarService.js  calendarPollService.js
│       ├── whatsappPoller.js  waSyncService.js  metaWhatsapp.js
│       ├── storageService.js         # Supabase: uploadFile / deleteFile / getSignedUrl
│       ├── reminderService.js  meetingReminderService.js
│       ├── driveService.js
│       ├── eventCostService.js       # AI cost lines, runs on contract signing
│       ├── salesAdvisor.js           # worklist ranking, analyzeLead, lossInsights
│       ├── salesBriefingService.js   # morning / evening WhatsApp briefings
│       ├── financeReconcile.js       # bank/CAL/MAX + karteset parsing and matching
│       └── financeInvoiceScanner.js  # Gmail → AI classify → Drive filing
```

## Known Limitations & Future Work

| Item | Status |
|---|---|
| Facebook Messenger / Instagram DM webhooks | Not started. Instagram leads are currently identified by CTA text on WhatsApp messages, not by the Graph API |
| AI bot (auto-reply to new leads) | ✅ Built — greeting + follow-up + AI field extraction, stage-guarded (see "WhatsApp auto-reply chatbot") |
| Auto-drafted cold follow-ups | Not built (deliberately deferred) |
| AdminPage UI for the briefing hours | Not built — the settings keys exist, but they must be edited directly |
| Analytics dashboard | ✅ Reworked 2026-08-13 — period KPIs, activity funnel, closings by close-date |
| Stage-history table | Does not exist. Close month falls back to parsing the `'… ← התקבלה מקדמה'` stage note — a known fragility |
| Chef/bar menu anchoring | Duplicated across 5 render sites; editing one and not the others reintroduces the wrong-bullet bug. Grep for `chefIdx` |
| Commission automation | Not built — commissions are computed by hand from the רווחים page |
| Meeting RSVP tracking | Only via the Google Calendar email invite; there is no direct WhatsApp confirmation of a meeting (guest **event** RSVP is a separate module — see Phase 19) |
| VAT option for package fields | Deferred by choice |
| Inbound WhatsApp media > 30s download | Times out gracefully, stores caption or type label as fallback |
| Bank exports without a text layer | Image-based PDFs cannot be parsed; the user is warned and must re-download the full report |
| Invoice scan — one-time setup | Google token must be re-authorized with the `drive.file` scope (`node server/scripts/googleAuth.js` → update `GOOGLE_TOKEN_B64`), and the redirect URI `https://www.proevent.co.il/api/finance/gmail/oauth/callback` must be registered in Google Cloud Console |

---

## Build Phases — Status

### Phase 1 — Core CRM ✅
Project scaffold, DB schema, multi-user auth, lead table, lead card, manual creation, WhatsApp capture, Gmail capture, Railway deploy.

### Phase 2 — Messaging & Calendar ✅
Reply via WhatsApp + Email, auto-advance stage, Google Calendar event marking, meeting scheduling + RSVP.

### Phase 3 — AI Messaging ✅
Translate inbound (Hebrew), translate outgoing (English), AI suggest reply, AI improve draft.
(Originally built on Claude; the whole AI layer moved to OpenAI in mid-2026 — see "AI Features".)

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
Since grown into the הפקה mode (`EventsPage`), the event brief, the production checklist,
seating charts and the separate תפעול module — see phases 17 and 18.

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

### Phase 9 — Global Tasks Screen ✅ Built 2026-04-26
- Global `/tasks` page showing all tasks across all leads
- Ordered by: overdue → today → upcoming → no date → completed (hidden behind toggle)
- Filters: search (debounced), assigned user, status (ממתינות / באיחור / הכל), "שלי" toggle
- Inline complete: bottom sheet with optional result text
- Lead name link → opens LeadCard overlay without leaving the page
- Red overdue badge on משימות nav tab, polled every 60s
- Bottom nav restructured to 2 rows: tasks added to row 1, הגדרות moves to admin-only row 2
- New backend routes: `GET /api/tasks`, `/api/tasks/overdue-count`, `/api/tasks/users`

### Phase 10 — Meeting Management ✅ Built 2026-05-02

**יומן Google section — meeting status & controls:**
- When a meeting is scheduled (`lead.meeting_event_id` set), shows "נקבעה פגישה ל-[DD/MM/YYYY HH:MM]"
- Button "בטל\דחה פגישה" opens action modal with two flows:
  - **Cancel:** textarea for reason → deletes GCal event, clears `lead.meeting_event_id`, logs cancellation to activity
  - **Postpone:** textarea for reason + date picker (DD/MM/YYYY) + time pickers (start/end) + WhatsApp/Email delivery toggle → updates GCal event, sends updated invite, logs postponement to activity

**Activity log — author attribution:**
- Every log entry shows the name of the user who performed the action
- Fixed root cause: calendar routes were double-mounted (once without auth, once with) — removed the unprotected mount; ICS download and confirm link remain public via path-based exception
- `messages` table now has `sent_by INT → users.id`; set on every CRM-initiated outbound WhatsApp send
- `GET /api/leads/:id/messages` now joins `users` and returns `sent_by_name`

**UI — date/time inputs:**
- All date fields use `react-datepicker` (DD/MM/YYYY, calendar popup, locale-independent)
- All time fields use `<input type="time">` (native time picker, no manual text entry)
- **Rule:** DD/MM/YYYY for all dates, HH:MM for all times, always pickers — never free-text

**WhatsApp improvements:**
- New meeting message includes date and time: `שלום! קישור לפגישה שנקבעה לך ל-[date] בשעה [time] בשרביה`
- Reschedule message includes new date and time range
- Sending WhatsApp from the פעילות compose area now shows a confirmation popup before sending

**New calendarService functions:** `deleteMeeting(googleEventId)`, `updateMeetingTime(googleEventId, start, end)`

**New calendar endpoints:** `GET /meetings/:eventId/details`, `DELETE /meetings/:eventId`, `PATCH /meetings/:eventId/reschedule`

### Phase 11 — Facebook/Instagram 🔲 Not started
Graph API webhooks were never built. Instagram leads are identified after the fact from
the Click-to-WhatsApp CTA text and backfilled into `source = 'instagram'`.

### Phase 12 — AI Bot (auto-qualify new leads) ✅ Built
WhatsApp greeting + follow-up + `gpt-4o-mini` extraction of name / event type / date text /
guest count, writing only empty fields. Guarded to stages `new` and `new_no_answer`
(`e53c089`). Admin-controlled through the `wa_chatbot_*` settings.

### Phase 13 — Full Analytics Dashboard ✅ Reworked 2026-08-13
Period KPIs, distinct-lead sales-activity funnel, source funnel, 6-month bars with
closings counted by close date (`71b8675`, `9c0db2f`, `8434623`).

### Phase 14 — Contracts & price offers ✅
Price offers (packages, extra-guest pricing, VAT toggle, editable preview rows) and
contracts (editable deposit %, VAT, balance; `puppeteer-core` PDF; public
`/sign/:token` signing page with a drawn signature; signed PDF filed to the lead and
sent back on the channel the contract was sent through). Hierarchical clause numbering,
bilingual he/en, import-from-previous-document as the first step, and a
download-without-sending button.

### Phase 15 — Financial documents (GreenInvoice) ✅
Issue documents from the lead card. Non-managers submit to `pending_documents`; managers
get a WhatsApp with a `/?pendingDocs=1` deep link that opens the approvals modal, and the
creator gets a result banner. Issued PDFs are downloaded and saved to the lead's files.
`taxId` is stripped to digits only.

### Phase 16 — Suppliers ✅
Category-based supplier directory with interactions, files (signed URLs, sendable over
WhatsApp) and the events each supplier worked. Supplier chips in the lead card and the
event brief open the full supplier card as an overlay.

### Phase 17 — Event brief, production checklist & seating ✅
`event_briefs` auto-filled from the signed contract, per-category supplier rows picked
from the suppliers DB and stored as snapshots, a production checklist with who/when
stamps, and drag-and-drop seating layouts per section with a template gallery and
floor-plan backgrounds.

### Phase 18 — Operations module (תפעול) ✅
Op tasks, recurring maintenance with history, fault reports, inventory checklists with
per-item permanent notes and run stamps, a polymorphic activity log and WhatsApp
reminders on any entity.

### Phase 19 — RSVP (אישורי הגעה) ✅
Campaigns over the Meta WhatsApp Cloud API with approved templates, guest import,
reminders, a `not_sent → invited → awaiting_count → confirmed / declined` state machine
driven by the inbound webhook, and export.

### Phase 20 — AI chat assistant + knowledge base ✅
Floating assistant with SSE streaming and role-scoped tool calling over leads, schedule,
tasks, operations, suppliers and RSVP. Admin-managed knowledge files and media; media is
served through signed URLs from the private bucket and referenced with `[[media:ID]]`.

### Phase 21 — Management dashboard (ניהול) ✅
Employee activity over a date range — calls and meetings split into done vs documented,
notes, WhatsApp, tasks, leads, files, plus first/last activity per employee and presence
from `user_sessions`.

### Phase 22 — Profit page (רווחים) ✅ Built 2026-08-01
Per-month profit per closed event. Close month = `MIN(contracts.signed_at)`, falling back
to the deposit stage note anchored to the note's **end** (`'%← התקבלה מקדמה'` — an
unanchored LIKE also matched deposit→production moves and misattributed the month).
Amount = the latest signed contract's pre-VAT subtotal; profit = subtotal − Σ cost lines.
Cost lines are AI-generated from the cost-model KB document on contract signing
(`onlyIfEmpty` — hand edits are never overwritten), carry `qty` + `unit_price` with the
**server** doing the multiplication, and have a backfill endpoint plus an amber banner for
months closed before the hook existed. Commissions are computed by hand from this page.

### Phase 23 — Finance module (כספים) ✅ Built July–August 2026
Reconciliation with saved periods, bank/CAL/MAX parsing, payee enrichment and
karteset-driven auto-resolve; plus the invoice email scan that classifies supplier
invoices with AI and files them into Drive by email date. New assignable `finance` role.

### Phase 24 — AI sales agent ✅ Built 2026-08-27 (`729870d`)
Rule-based worklist ranking, per-lead deal advice cached in `lead_ai_advice`, loss
insights, and morning/evening WhatsApp briefings. **Draft-only — never auto-sends to a
customer.**

### Phase 34 — Costs panel + AI usage metering ✅ Built 2026-09-16
Oran asked to see what every paid service costs per month, calls included. New tab **עלויות**
in the ניהול mode (`/costs`, `client/src/pages/CostsPage.jsx`; API `routes/costs.js`, admins +
managers). Three sources: **Twilio** — real monthly billed amounts from Twilio Usage Records
(`usage.records.monthly`, cached 1h, category breakdown) with a per-call estimate from the
`calls` table as fallback for the current month (list prices: inbound $0.0107, outbound mobile
$0.0646 / landline $0.0294, browser leg $0.004, recording $0.0025 per minute, number $5.50);
**OpenAI** — every call now goes through `services/openaiClient.js` (`openai(feature)`), a
metered wrapper around the SDK that writes tokens / audio seconds / estimated USD to the new
`ai_usage` table (feature tags: assistant-chat, deal-advisor, call-analysis, voice-note,
whatsapp-bot, lead-summary, event-cost, invoice-classifier, ai-tools; streaming calls get
`stream_options.include_usage`); **fixed subscriptions** — `cost_subscriptions` rows entered by
hand (Railway, Supabase, Green API, GreenInvoice, domain…). USD is the source; ₪ via
`settings.usd_ils_rate` (editable on the page, default 3.70). Usage before 2026-09-16 is not
metered. Also: Twilio's own copy of each recording is deleted once ours is in Supabase.

**Call transcript now kept** (`calls.transcript`) and appended to the call interaction body after
a `[[TRANSCRIPT]]` marker; `BodyWithFile` renders it as a collapsed "תמלול מלא". Whisper gets a
Hebrew domain prompt; the summary prompt is told not to invent content and to score test/unclear
calls 0. Reason: the first real test produced a poor summary and Oran wants to see the raw text.

### Phase 33 — In-app calling (Twilio Voice) ✅ Built 2026-09-16
Oran's ask: call a lead from inside the CRM over the internet showing an Israeli number,
have calls to that number ring the lead's owner (also when the team is abroad), record every
call, and get an AI summary + insights to analyze and improve. Decisions: Twilio; number
**03-382-3777** (`+97233823777`, Local Tel Aviv, no regulatory bundle needed); inbound rings the
owner's mobile first, then the owner's browser, then the rest of the sales team in queue order,
then voicemail; summary + insights only (full transcript not stored).

**Setup is self-service:** `twilioService.ensureSetup()` runs on boot when the three env vars
are set — creates the API key and the TwiML App (SIDs/secret kept in `settings`:
`twilio_api_key_sid/secret`, `twilio_twiml_app_sid`) and points the number's `voiceUrl` /
`statusCallback` at `SERVER_URL`. Nothing to click in the Twilio console after buying the number.

**Outbound.** `CallButtons` next to the phone on the lead card (only when `/calls/config` says
enabled): "📞 התקשר" connects from the browser via `@twilio/voice-sdk` (`CallContext`), Twilio
hits `POST /api/calls/twiml/outbound` (params `To`, `LeadId`, `From=client:user_<id>`) →
`<Dial callerId=venue number record=record-from-answer-dual>`. "📲 דרך הנייד שלי" (`POST
/api/calls/bridge`) makes Twilio ring the rep's own mobile and, when answered, dials the lead
(`/twiml/bridge`). No-answer/busy → a `call_attempt` interaction (source `twilio`).

**Inbound.** `POST /api/calls/twiml/inbound`: caller matched by phone (leads + lead_contacts);
unknown numbers create a lead with source `phone_call` ("שיחה נכנסת <number>"). A ring plan is
built once and stored on `calls.ring_plan`: owner mobile (20s, skipped when the owner has
`abroad_mode`) → owner browser `<Client>user_<id>` (20s) → every other sales/manager/admin user
in `users.call_queue_order` (NULLS LAST, then id), mobile + browser together (18s each) →
Hebrew voicemail (`<Say Google.he-IL-Wavenet-A>` + `<Record maxLength=120>`). Each `<Dial>`
returns to `/twiml/inbound/step?callId&i`; `DialCallStatus=completed` = answered → `answered_by`
set. Reps see the customer's real number as caller ID. Missed/voicemail → `call_attempt`
interaction (inbound, unread) + WhatsApp to the owner (or the admins) with a `/?lead=` link.

**Recording → summary.** `POST /api/calls/recording` → `callAnalysis.processRecording`: mp3
downloaded from Twilio (basic auth) → Supabase `crm-files` + `files` row → Whisper (he) →
`gpt-4o` JSON (summary, customer_needs, objections, agreements, next_steps, sentiment,
sales_score 1-10, coaching_tips, event_details) → one `call` interaction on the lead with the
readable summary and the `[[FILE:id|…mp3]]` player link. Calls under 15s: recording only.
Voicemails: transcribed verbatim onto the missed-call interaction. `calls.analysis` keeps the JSON
for later per-rep analytics.

**Client.** `CallProvider` (App root) registers one Twilio `Device` per logged-in tab and
refreshes its token; `CallBar` shows the incoming prompt (ענה/דחה), the active-call bar (timer,
mute, hang up, lead link) and errors. Header gets an ✈️ toggle (`PATCH /api/calls/me
{abroad_mode}`) with a green/red dot for "softphone registered". Browser ringing works while a
CRM tab is open (desktop, or mobile browser in the foreground) — a native app with push is the
known gap for locked phones.

**Data.** New table `calls` (call_sid, direction, mode browser|bridge|inbound, lead_id, user_id,
answered_by, from/to, status, ring_plan/ring_step, notified, started/ended, duration_sec,
recording_sid, recording_file_id, summary, analysis JSONB, interaction_id); `users.abroad_mode`,
`users.call_queue_order`; `leads.source` gains `phone_call`. Webhooks are validated with
`twilio.validateRequest` against `SERVER_URL + originalUrl` (`TWILIO_SKIP_VALIDATION=1` for local tests).

**Legal note (not legal advice):** recording a call you are party to is lawful in Israel; the
voicemail prompt does not announce recording — add a short "השיחה מוקלטת" `<Say>` if wanted.

### Phase 32 — Public landing page + demo-request leads ✅ Built 2026-09-14
Oran: put the Claude-Design landing page live on the main domain, with a login entry, and
route demo requests into the CRM + WhatsApp to him. See "Public landing page" above.
New: `server/landing/*`, `routes/public.js`, source `landing` (constraint + client labels
in LeadsPage / LeadCard / AnalyticsPage / AddLeadModal), `crm_app` cookie in LoginPage /
LeadsPage logout / api.js 401. Verified locally: `/` anonymous → landing (GA injected when
the env var is set), `/` with cookie → app, `/?lead=5` → app, robots/sitemap/css/og 200,
form → lead + note + admin WhatsApp attempt, honeypot swallowed, bad phone 400, repeat phone
→ note on the existing lead; desktop + 390px screenshots checked, no horizontal scroll.
Later the same day: logo added everywhere (see the Brand paragraph), app title fixed.
Not done: GA/Search Console verification (needs Oran's accounts).

### Phase 31 — Assistant actions + documents, smarter deal advisor, payments without a document ✅ Built 2026-09-13
Source: Oran's Claude-Design landing page for ProEvent (the `design_handoff_proevent_landing`
package). The page described several features as better than they were; he picked what to
build (briefing, staff attendance and the WhatsApp bot were explicitly left untouched):
- **Assistant** (`routes/chat.js`, `AIChat.jsx`): 6 new read tools (lead documents, sales
  worklist, analytics KPIs, finance summary, event brief, employee activity); **proposal
  tools** `propose_task` / `propose_note` / `propose_fault` rendered as confirm cards, executed
  only on "אשר" via `POST /api/chat/actions`; knowledge files handed over as `[[file:ID]]`
  chips; **"שלח בוואטסאפ"** on media and file chips (`POST /api/chat/send`,
  `services/waOutbound.js`). System prompt no longer says "read only"; it says actions are
  proposals. `LEAD_SET` now includes `sales_manager`. `module.exports._executeTool` is
  exposed for scripted tests.
- **Deal advisor** (`services/salesAdvisor.js`): `buildLeadContext` returns offer/contract
  totals, meetings, open tasks, contract opens and reply-speed signals; `analyzeLead` prompt
  carries all of it + playbook + loss lessons; response adds `evidence`, `suggested_task`,
  `suggest_meeting`, `deal_value`. `contract_views` written by the public signing GET.
  Worklist ranking: near event → temperature → deal value → freshness; the page shows both.
  `lossInsights` persists `settings.sales_loss_lessons`. Card buttons: create task
  (prefilled `AddTaskModal`), schedule meeting.
- **Payments without a document** — see "Payment signals" under Background Services.
  First version (13.9) scanned customer WhatsApp messages with an AI classifier; Oran
  corrected the trigger on 14.9: it must be the employee marking "מקדמה התקבלה" /
  "תשלום מלא התקבל" (with the amount) or moving the stage to התקבלה מקדמה. Rebuilt that way.
- Verified in a throwaway Postgres in the Claude cloud container: boot migrations, every new
  tool, `/api/chat/actions` (task/note/fault), payment-signal scan with a mocked classifier
  (mark deposit → signal → no duplicate → receipt file → closed; full payment needs a second receipt), `/api/payment-signals/*`, contract-view
  logging, `vite build`. Not verified: real Green API sends from `/api/chat/send` and the
  live OpenAI prompts — check after deploy.

### Phase 30 — Production: full payment, אחראי הפקה, production briefing, close reminders, "not ready" badge ✅ Built 2026-09-12
Requested by Oran (2026-09-12):
- **Full payment** next to the deposit in the card's תשלומים section: `full_payment_amount`,
  `full_payment_date`, `full_payment_confirmed` (same shape as the deposit). On customer
  signature (`POST /api/contracts/:token/sign`) the deposit amount and the full-payment
  amount are auto-filled from the contract's calculated values **incl. VAT**
  (`depositAmountVat`, `remainingBalance`) — only where still empty; both stay editable.
  Recording the full payment does NOT move the stage; the אחראי הפקה moves the lead to
  "אירוע הסתיים והתקבל תשלום" by hand.
- **אחראי הפקה** (`leads.production_manager_id`) — dropdown of production/admin/manager users
  at the top of the תשלומים section. `/api/users` now also returns `roles`.
- **Production morning briefing** (`services/productionBriefingService.js`, kind
  `production_morning`, same hour as the sales morning briefing, default 8:00) to every user
  with the production role + admins/managers, everyone's events. Sections: events in the next
  7 days with what's missing; past events not closed; deposits/full payments not confirmed;
  the recipient's open production tasks due today/overdue. Preview:
  `GET /api/production/briefing-preview?kind=morning|close`.
- **Close reminder** (kind `event_close_reminder`, `event_close_reminder_hour` setting,
  default 10:00): each אחראי הפקה gets their events whose date passed but are still in
  deposit/production, every day until closed; managers get one aggregate copy
  (`event_close_reminder_mgr`).
- **Red header badge "N אירועים לא מוכנים"** (production users + managers) next to
  "ממתינים": events in the next 7 days with something open — brief not filled, production
  checklist not complete, deposit not confirmed, no אחראי הפקה. Click → `UnreadyEventsModal`
  (name, in how many days, owner, tags of what's missing); row → opens the lead.
  Data: `GET /api/production/unready-events` via `services/eventReadiness.js`.

### Phase 29 — Remove event from calendar (unmark) ✅ Built 2026-09-12
Lead "איימי ורן חתונה" was cancelled (moved to לא סגרו) but its red event stayed on Google:
the lost-transition delete used a stale `google_event_id` and failed silently. Also, clicking
"סגור" again did nothing visible — Oran expected it to cancel. Now: clicking the active
button again shows a confirmation popup and calls `POST /calendar/leads/:id/unmark`, which
deletes the Google event(s) of the lead (stored id + lookup by `crmLeadId` / `ליד #` marker)
and the `calendar_events` row. The לא סגרו transition uses the same robust removal.
Events created before 2026-09-12 by hand in Google (no CRM marker) cannot be found and must
be deleted in Google manually.

### Phase 28 — Calendar link self-heal ✅ Built 2026-09-12
Bug: lead "אורי בלוך שבת חתן" was marked סגור in the CRM but stayed yellow in Google
Calendar, and "פתח ביומן Google" opened "Could not find the requested event". Cause: the
`calendar_events` row pointed at a Google event that had been deleted; the patch on
"סגור" failed silently (404) after the DB was already updated. Fix in
`calendarService.js`: on 404/410 the sync relinks to a surviving event of that lead
(found by `crmLeadId` private property or the `ליד #<id>` description marker, ±1 day
around the event date) or creates a new one, and updates `google_event_id`/`html_link`.
`GET /calendar/leads/:id/status` now verifies the event on Google and triggers the same
recovery, so opening the lead card fixes stale links by itself.

### Phase 27 — Briefing rework + sales_manager role ✅ Built 2026-09-08
Reported from Oran's phone: the briefing's AI opener read oddly, and from the list it
was impossible to tell what to do. Rewritten as a deterministic message (see "AI sales
briefings") showing per lead when the contract/offer went out, the last contact (when,
who, what) and who has the ball. Fixed managers who also hold `sales` getting a
rep-scoped briefing. New `sales_manager` role (מנהל מכירות) — sees every rep's leads in
the worklist/briefing/AI chat without manager privileges; selectable in the admin users
screen.

### Phase 25 — Multi-contact sends ✅ Built 2026-09-05 (`49b771e`)
See "Multiple recipients (contact people)".

### Phase 26 — Voice notes ✅ Built (`38860a7`)
Record a voice note in the activity composer; transcribed to Hebrew text with Whisper.
