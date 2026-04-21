# Sharabiya CRM — Product Requirements Document

## Product Overview

A custom CRM for Sharabiya, an event venue in Jaffa. Manages the full lifecycle from first lead inquiry through signed contract and event production. Mobile-first, Hebrew RTL, multi-user, with automatic lead capture from all channels and an AI qualification bot.

---

## Users & Roles

- Multiple staff members (sales + production team)
- All leads visible to everyone
- Each lead has an assigned owner
- Every action attributed to the logged-in user (name shown on all entries)
- Roles: **admin** / **sales** / **production**
- Admin can create and manage users

---

## Lead Sources

| Source | Channel | Auto/Manual |
|---|---|---|
| Website popup form | Email from email@sharabiya.co.il — subject "הודעה חדשה פופאפ" | Auto |
| Website contact form | Email from email@sharabiya.co.il — subject "פנייה חדשה מאתר שרביה" | Auto |
| Call Event supplier | Email from info@hafakot.co.il | Auto |
| Telekol voicemail | Email from telekol@telekol.co.il | Auto |
| WhatsApp | Green API webhook | Auto |
| Facebook Messenger | Meta Graph API webhook | Auto |
| Instagram DM | Meta Graph API webhook | Auto |
| Manual entry | CRM form | Manual |

**Match rule:** If incoming phone or email matches an existing lead → attach as interaction. If unknown → create new lead at stage "חדש".

---

## Email Parsing Patterns

### Call Event (info@hafakot.co.il)
Subject contains "CALL EVENT"
- Name: text before `מתעניין/ת` on the line after `להלן פרטי הליד:`
- Phone: `טלפון: {value}`
- Email: `מייל: {value}`
- Guest count: `כמות מוזמנים: {value}`
- Event type: `סוג האירוע: {value}`
- Date: `מתי: {value}`
- Budget: `תקציב: {value}`
- Notes: `הערות: {value}`

### Website Popup (email@sharabiya.co.il — "הודעה חדשה פופאפ")
- Name: 2nd non-empty line after "אני"
- Phone: 3rd non-empty line after "אני"

### Website Contact Form (email@sharabiya.co.il — "פנייה חדשה מאתר שרביה")
- Name: `שם מלא: {value}`
- Phone: `טלפון: {value}`
- Notes: `פרטי הפנייה: {value}`

### Telekol (telekol@telekol.co.il — subject contains "טלקול")
- Phone: first number after `מספר טלפון לחזרה `
- Name: `שם הפונה : {value}`
- Event type: `סוג אירוע: {value}`
- Guest count: `כמות מוזמנים : {value}`
- Event date: `תאריך האירוע : {value}`
- Notes: `ההודעה: {value}`

---

## Pipeline Stages

| # | Key | Hebrew | Description |
|---|---|---|---|
| 1 | new | חדש | Auto-captured, no staff contact yet |
| 2 | contacted | יצירת קשר | First call/message made |
| 3 | meeting | פגישה נקבעה | Meeting scheduled or held |
| 4 | offer_sent | הצעת מחיר נשלחה | Price offer sent |
| 5 | negotiation | מו"מ | Follow-up on offer |
| 6 | contract_sent | חוזה נשלח | Contract sent via חתימה ירוקה |
| 7 | deposit | מקדמה התקבלה | Deposit paid — deal won |
| 8 | production | הפקה | Active event production |
| — | lost | לא סגרו | Lost — requires reason |

### Lost Reasons
מחיר/תקציב | תאריך תפוס | בחר מתחרה | נעלם | שינוי תוכניות | אחר + שדה חופשי חובה

---

## Event Types (presets)
חתונה | בר/בת מצווה | אירוע חברה | יום הולדת | אירוסין | אחר

---

## Data Model

### leads
```
id, name, phone, email, event_date, event_type, guest_count, budget,
source, stage, lost_reason, lost_reason_text,
priority (normal / hot / urgent),
assigned_to (user_id), notes, created_at, updated_at
```

### interactions
```
id, lead_id, type (call/meeting/note/email/whatsapp/facebook/instagram),
direction (inbound/outbound), body, created_by (user_id), created_at
```

### messages
```
id, lead_id, channel (whatsapp/facebook/instagram),
direction (inbound/outbound), body, external_id, timestamp
```

### tasks
```
id, lead_id, title, due_at, remind_via (app/whatsapp),
completed_at, created_by (user_id), assigned_to (user_id), created_at
```

### files
```
id, lead_id, filename, url, file_type, uploaded_by (user_id), created_at
```

### calendar_events
```
id, lead_id, google_event_id, type (option/confirmed), event_date, created_by
```

### users
```
id, username, display_name, password_hash, role, phone, created_at
```

---

## 4 Lead Views

| Tab | Hebrew | Shows |
|---|---|---|
| New | חדשים | stage = new |
| In Process | בתהליך | stages 2–6 |
| Closed | סגרו עסקה | stages 7–8 |
| Lost | לא סגרו | stage = lost |

**Table columns:** שם | טלפון | תאריך אירוע | סוג אירוע | מוזמנים | מקור | שלב | אחראי | עדיפות | משימות פתוחות

---

## Lead Card (slide-in panel)

### Info Section
Name, phone (tap-to-call), email, event date, event type, guest count, budget, source badge, priority flag (🔥 / ⚡), assigned owner, created date + who created

### Pipeline Bar
Visual bar showing all 8 stages. Current stage highlighted. Click any stage to advance. Each change logged: user + timestamp.

### Google Calendar Block
Shows status for this lead's event date: **אופציה** (yellow) / **סגור** (green) / not marked
Buttons: "סמן כאופציה" / "סמן כסגור"

### Interactions Timeline
All calls, meetings, notes, emails, messages — chronological order.
Each entry: type icon + direction (inbound/outbound) + content + staff name + timestamp.
Quick-add: 📞 שיחה | 🤝 פגישה | 📝 הערה

### Messaging Tabs
- **WhatsApp** — full thread + reply box → sends via Green API
- **Facebook** — Messenger thread + reply → Meta API
- **Instagram** — DM thread + reply → Meta API
- **Email** — full thread + compose → Gmail API

### Tasks & Reminders
List of open tasks. Add task: title + due date + assigned to + remind via (app / WhatsApp to staff phone). Mark complete.

### Documents & Files
All files sent/received. Upload button. Send price offer (Google Drive template). Send food/bar menu. Contract link to חתימה ירוקה (log sent + signed dates).

### Production Section (visible at stages 7–8 only)
Deposit: amount + date + received checkbox
Production meeting: date + notes
Event timeline (text)
Team assignments
Supplier list
Venue sketch (file upload)
Guest invitations: external app link + status note

---

## AI Bot (Phases 1–3 of conversation)

**Channels:** WhatsApp, Facebook Messenger, Instagram DM
**Trigger:** Inbound message from unknown number/account

**Step 1 — Immediate acknowledgment:**
> "שלום! תודה שפנית לשרביה יפו 🎉 קיבלנו את הפנייה שלך ונחזור אליך בהקדם. בינתיים, אשמח לענות על שאלות!"

**Step 2 — Answer FAQs:**
Claude API answers questions about the venue (capacity, event types, parking, accessibility, etc.) using a venue FAQ document.

**Step 3 — Qualify the lead:**
Bot collects: event type → event date → guest count → budget range → best time to call.
On completion → updates lead card + sends WhatsApp notification to assigned staff:
> "ליד חדש מוכן לשיחה: [שם], [סוג אירוע], [תאריך], [מוזמנים]"

**Handoff to human:** When staff marks lead as "contacted", or lead asks for human, or bot can't answer.

---

## Reminders & Automations

| Trigger | Action |
|---|---|
| New lead with no contact after 24h | WhatsApp reminder to assigned staff |
| Inbound message unanswered after 3h | WhatsApp reminder to assigned staff |
| Price offer sent, no response after 3 days | Follow-up reminder |
| Contract sent, not signed after 5 days | Follow-up reminder |
| Task due date reached | In-app badge + optional WhatsApp |
| **Throttle:** max 3 WhatsApp reminders/day/user | Prevents notification junk |

---

## Google Calendar View (in-app)

Full calendar page. Yellow dots = אופציה, Green dots = סגור.
Click any event → opens that lead's card.
Month and week views. Clearly shows available dates.

---

## Analytics Dashboard

- Lead source breakdown (which channels bring most leads)
- Conversion rate per pipeline stage (where leads drop off)
- Average time spent in each stage
- Staff performance (leads per person, response time)
- Won/lost ratio by month
- Lost reasons breakdown
- Revenue pipeline estimate

---

## KPIs

| KPI | Target |
|---|---|
| First response time | < 1 hour |
| Lead → Meeting rate | Track monthly |
| Meeting → Offer rate | Track monthly |
| Offer → Close rate | Track monthly |
| Average deal cycle | Track monthly |

---

## Integrations

| Tool | Provider | Cost |
|---|---|---|
| WhatsApp | Green API | $12/mo (upgrade from free developer plan when live) |
| Facebook Messenger | Meta Graph API | Free |
| Instagram DM | Meta Graph API | Free |
| Gmail | Gmail API | Free |
| Google Calendar | Google Calendar API | Free |
| Google Drive | Google Drive API | Free |
| AI Bot | Claude API (Anthropic) | ~$0.01 per conversation |
| Contract signing | חתימה ירוקה | External |

---

## Mobile UI Requirements

- Fully responsive — works on phone browser
- Lead table: horizontal scroll on mobile
- Lead card: full-screen panel on mobile
- Bottom navigation bar on mobile (4 tabs)
- Large tap targets for call/WhatsApp buttons
- Quick-log interaction from lead card in 2 taps

---

## Build Phases

### Phase 1 — Core CRM ← START HERE
- Project scaffold (React + Vite + Tailwind + Node.js + Supabase)
- DB schema + all migrations
- Multi-user login (JWT)
- 4-view lead table
- Lead card: info + pipeline bar + interactions
- Manual lead creation
- WhatsApp auto-capture (Green API webhook → create/match lead)
- Email auto-capture (Gmail API — all 4 parsers)
- Deploy to Railway

### Phase 2 — Messaging & Calendar
- Reply via WhatsApp and email from CRM
- Facebook Messenger + Instagram webhooks
- Google Calendar in-app view
- Mark dates as option/confirmed from lead card

### Phase 3 — Documents & Files
- File upload to lead card
- Price offer from Google Drive template
- Food/bar menu sending
- חתימה ירוקה contract integration

### Phase 4 — Bot & Reminders
- Claude API bot (stages 1–3)
- Task system with due dates
- WhatsApp reminders to staff
- Auto-reminders for new leads and unanswered messages

### Phase 5 — Analytics & Production Module
- Dashboard with all KPIs and source analytics
- Full production phase features
- Deposit tracking, timeline, team, suppliers
