// Production WhatsApp messages:
//  - 'production_morning'  — daily "פתיחת יום הפקה" at the sales morning hour (default 8:00)
//    to every user with the production role + admins/managers (everyone's events)
//  - 'event_close_reminder' — daily at 10:00 to the אחראי הפקה of each event whose date passed
//    but is still not in "אירוע הסתיים והתקבל תשלום"; managers get one aggregate copy
// Dedupe: sales_briefing_log (kind, recipient, sent_on) — one per kind per person per day.
const pool = require('../db/pool');
const { sendWhatsApp } = require('./reminderService');
const {
  getUnreadyEvents, getPastUnclosedEvents, getUnconfirmedPayments, getOpenProductionTasks, israelToday,
} = require('./eventReadiness');

const IL = 'Asia/Jerusalem';

function israelHour() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: IL, hour: '2-digit', hour12: false }).formatToParts(new Date());
  return parseInt(parts.find(p => p.type === 'hour').value, 10);
}

async function setting(key, def) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value != null && rows[0].value !== '' ? rows[0].value : def;
}

function fmtShort(ds) { // 'YYYY-MM-DD' → 'D.M'
  if (!ds) return '';
  const [, m, d] = ds.split('-');
  return `${Number(d)}.${Number(m)}`;
}
function fmtDayName(ds) {
  return ds ? new Date(`${ds}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long' }) : '';
}
function dueText(iso) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: IL, hour12: false });
}
function inDays(n) {
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  return `בעוד ${n} ימים`;
}
function sinceDays(n) {
  if (n === 1) return 'אתמול';
  return `לפני ${n} ימים`;
}
function leadLink(baseUrl, id) { return `${baseUrl}/?lead=${id}`; }
function eventTitle(ev) { return ev.event_type ? `${ev.name} – ${ev.event_type}` : ev.name; }

// The full morning briefing. userId is the recipient — used only to scope "my tasks";
// events are everyone's (production sees the whole board).
async function buildProductionBriefing({ userId, baseUrl }) {
  const today = israelToday();
  const [unready, past, payments, tasks] = await Promise.all([
    getUnreadyEvents({ withinDays: 7 }),
    getPastUnclosedEvents(),
    getUnconfirmedPayments(),
    getOpenProductionTasks({ assignedTo: userId }),
  ]);
  if (!unready.length && !past.length && !payments.length && !tasks.length) return null;

  const lines = [];
  lines.push(`🎪 פתיחת יום הפקה – ${fmtDayName(today)} ${fmtShort(today)}`);
  lines.push('');

  lines.push(`📅 אירועים השבוע שעוד לא מוכנים (${unready.length})`);
  if (!unready.length) lines.push('הכל מוכן ✅');
  for (const ev of unready) {
    lines.push(`• ${eventTitle(ev)} – ${fmtDayName(ev.event_date_str)} ${fmtShort(ev.event_date_str)} (${inDays(ev.days_until)})`);
    lines.push(`  אחראי: ${ev.production_manager_name || 'לא נבחר'}`);
    lines.push(`  חסר: ${ev.missing_labels.join(' · ')}`);
    lines.push(`  ${leadLink(baseUrl, ev.id)}`);
  }
  lines.push('');

  lines.push(`⏳ אירועים שעברו ולא נסגרו (${past.length})`);
  if (!past.length) lines.push('אין ✅');
  for (const ev of past) {
    lines.push(`• ${eventTitle(ev)} – היה ${fmtShort(ev.event_date_str)} (${sinceDays(ev.days_since)}) · אחראי: ${ev.production_manager_name || 'לא נבחר'}`);
    lines.push(`  להעביר ל"אירוע הסתיים והתקבל תשלום"${ev.full_payment_confirmed ? '' : ' · תשלום מלא טרם אושר'}`);
    lines.push(`  ${leadLink(baseUrl, ev.id)}`);
  }
  lines.push('');

  lines.push(`💳 מקדמות / תשלומים שלא אושרו (${payments.length})`);
  if (!payments.length) lines.push('אין ✅');
  for (const p of payments) {
    const parts = [];
    if (p.items.includes('deposit'))      parts.push(`מקדמה${p.deposit_amount ? ` ₪${Number(p.deposit_amount).toLocaleString('he-IL')}` : ''} לא אושרה`);
    if (p.items.includes('full_payment')) parts.push(`תשלום מלא${p.full_payment_amount ? ` ₪${Number(p.full_payment_amount).toLocaleString('he-IL')}` : ''} לא אושר`);
    lines.push(`• ${eventTitle(p)} (${fmtShort(p.event_date_str)}) – ${parts.join(' · ')}`);
    lines.push(`  ${leadLink(baseUrl, p.id)}`);
  }
  lines.push('');

  lines.push(`✅ משימות הפקה פתוחות להיום (${tasks.length})`);
  if (!tasks.length) lines.push('אין ✅');
  for (const t of tasks) {
    const due = new Date(t.due_at);
    const dueDay = due.toLocaleDateString('sv', { timeZone: IL });
    const when = dueDay < today ? `באיחור (${fmtShort(dueDay)})` : `היום ${dueText(t.due_at)}`;
    lines.push(`• ${t.title} – ${t.lead_name} · ${when}`);
    lines.push(`  ${leadLink(baseUrl, t.lead_id)}`);
  }

  return lines.join('\n');
}

// Reminder text for one אחראי הפקה (their events), or for a manager (all events) when managerCopy.
async function buildCloseReminderText({ baseUrl, productionManagerId = null, managerCopy = false }) {
  const past = await getPastUnclosedEvents({ productionManagerId });
  if (!past.length) return null;
  const lines = [];
  lines.push(managerCopy
    ? `📋 אירועים שהסתיימו ועדיין לא נסגרו במערכת (${past.length})`
    : `📋 תזכורת: אירוע שהסתיים צריך להיסגר במערכת`);
  lines.push('');
  for (const ev of past) {
    lines.push(`• ${eventTitle(ev)} – היה ${fmtShort(ev.event_date_str)} (${sinceDays(ev.days_since)})${managerCopy ? ` · אחראי: ${ev.production_manager_name || 'לא נבחר'}` : ''}`);
    lines.push(`  ${leadLink(baseUrl, ev.id)}`);
  }
  lines.push('');
  lines.push('מה לעשות: לוודא שהתשלום המלא התקבל ולסמן "אושר" בכרטיס, ואז ללחוץ על "אירוע הסתיים והתקבל תשלום".');
  lines.push('התזכורת תישלח כל יום עד שהאירוע ייסגר.');
  return lines.join('\n');
}

async function alreadySent(kind, recipientId, day) {
  const { rows } = await pool.query('SELECT 1 FROM sales_briefing_log WHERE kind = $1 AND recipient = $2 AND sent_on = $3', [kind, recipientId, day]);
  return rows.length > 0;
}
async function markSent(kind, recipientId, day) {
  await pool.query('INSERT INTO sales_briefing_log (kind, recipient, sent_on) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [kind, recipientId, day]);
}

const MANAGER_ROLES = ['admin', 'manager'];

async function runProductionBriefings() {
  try {
    if ((await setting('sales_briefing_enabled', 'true')) !== 'true') return;
    const hour = israelHour();
    const morningHour  = parseInt(await setting('sales_briefing_morning_hour', '8'), 10);
    const reminderHour = parseInt(await setting('event_close_reminder_hour', '10'), 10);
    const day = israelToday();
    const baseUrl = process.env.SERVER_URL || 'https://www.proevent.co.il';

    if (hour === morningHour) {
      const { rows: recipients } = await pool.query(
        `SELECT id, display_name, phone FROM users
         WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
           AND (roles && $1::text[] OR role = ANY($1::text[]))`,
        [[...MANAGER_ROLES, 'production']]
      );
      let sent = 0;
      for (const u of recipients) {
        if (await alreadySent('production_morning', u.id, day)) continue;
        const text = await buildProductionBriefing({ userId: u.id, baseUrl });
        if (text) { await sendWhatsApp(u.phone, text); sent++; }
        await markSent('production_morning', u.id, day);
      }
      if (recipients.length) console.log(`[ProductionBriefing] morning sent to ${sent}/${recipients.length}`);
    }

    if (hour === reminderHour) {
      // Each אחראי הפקה → their own past-unclosed events
      const { rows: owners } = await pool.query(
        `SELECT DISTINCT u.id, u.display_name, u.phone
         FROM leads l JOIN users u ON u.id = l.production_manager_id
         WHERE l.stage IN ('deposit','production') AND l.event_date < $1::date
           AND u.phone IS NOT NULL AND NOT COALESCE(u.blocked, false)`,
        [day]
      );
      for (const u of owners) {
        if (await alreadySent('event_close_reminder', u.id, day)) continue;
        const text = await buildCloseReminderText({ baseUrl, productionManagerId: u.id });
        if (text) await sendWhatsApp(u.phone, text);
        await markSent('event_close_reminder', u.id, day);
      }
      // Managers → one aggregate copy (all past-unclosed events, incl. ones with no owner)
      const { rows: mgrs } = await pool.query(
        `SELECT id, display_name, phone FROM users
         WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
           AND (roles && $1::text[] OR role = ANY($1::text[]))`,
        [MANAGER_ROLES]
      );
      for (const m of mgrs) {
        if (await alreadySent('event_close_reminder_mgr', m.id, day)) continue;
        const text = await buildCloseReminderText({ baseUrl, managerCopy: true });
        if (text) await sendWhatsApp(m.phone, text);
        await markSent('event_close_reminder_mgr', m.id, day);
      }
      if (owners.length || mgrs.length) console.log(`[ProductionBriefing] close reminders: ${owners.length} owners, ${mgrs.length} managers`);
    }
  } catch (err) {
    console.error('[ProductionBriefing] error:', err.message);
  }
}

module.exports = { runProductionBriefings, buildProductionBriefing, buildCloseReminderText };
