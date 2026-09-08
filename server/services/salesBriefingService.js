const pool = require('../db/pool');
const { sendWhatsApp } = require('./reminderService');
const { getWorklist } = require('./salesAdvisor');

const TIER_TITLES = {
  1: 'חוזים שנשלחו וטרם נחתמו',
  2: 'הצעות מחיר שנשלחו',
  3: 'דחופים / חמים',
};

function israelHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find(p => p.type === 'hour').value, 10);
}

function israelDateStr() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
}

async function setting(key, def) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value != null && rows[0].value !== '' ? rows[0].value : def;
}

const IL = 'Asia/Jerusalem';
const MAX_PER_TIER = 10;
const STALE_DAYS = 2; // days without a customer reply before we flag a follow-up

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('he-IL', { timeZone: IL }) : '';
}
// Short day.month (no year) for "when" lines
function fmtShort(d) {
  return d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: IL }) : '';
}
function israelDayName() {
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: IL }).format(new Date());
}
function daysAgo(d) {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}
function agoText(n) {
  if (n == null) return '';
  if (n === 0) return 'היום';
  if (n === 1) return 'אתמול';
  return `לפני ${n} ימים`;
}

// "who did what" for the last real contact: whatsapp/email/call/meeting/note
function lastContactLine(lc) {
  if (!lc) return 'אין תיעוד קשר עם הלקוח';
  const when = `${fmtShort(lc.ts)} (${agoText(daysAgo(lc.ts))})`;
  const snippet = String(lc.body || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const q = snippet ? ` "${snippet}${snippet.length === 70 ? '…' : ''}"` : '';
  const inbound = lc.direction === 'inbound';
  let who;
  switch (lc.kind) {
    case 'call':         who = inbound ? 'הלקוח התקשר' : 'התקשרנו ללקוח'; break;
    case 'call_attempt': who = inbound ? 'הלקוח ניסה להתקשר' : 'ניסינו להתקשר, אין מענה'; break;
    case 'meeting':      who = 'פגישה'; break;
    case 'note':         who = 'הערה'; break;
    case 'email':        who = inbound ? 'הלקוח שלח מייל' : 'שלחנו מייל'; break;
    default:             who = inbound ? 'הלקוח כתב' : 'שלחנו ללקוח'; // whatsapp/facebook/instagram
  }
  return `קשר אחרון ${when} · ${who}${q ? ':' + q : ''}`;
}

// One-line "what to do" flag based on who has the ball
function ballLine(it) {
  const lc = it.last_contact;
  if (!lc) return '👉 אין קשר מתועד — ליצור קשר';
  const n = daysAgo(lc.ts);
  if (lc.kind === 'note' || lc.kind === 'meeting') return n >= STALE_DAYS ? `👉 ${n} ימים בלי פעולה — לעשות פולואפ` : '';
  if (lc.direction === 'inbound') return '❗ הלקוח פנה אחרון — ממתין לתשובה שלנו';
  if (n >= STALE_DAYS) return `⏳ הלקוח לא ענה ${agoText(n).replace('לפני ', 'כבר ')} — לעשות פולואפ`;
  return '';
}
function itemBlock(idx, it, baseUrl) {
  const head = `${idx}. *${it.name || 'ללא שם'}*${it.rep ? ` · ${it.rep}` : ''}`;
  const evParts = [];
  if (it.event_type) evParts.push(it.event_type);
  if (it.event_date) evParts.push(`אירוע ${fmtDate(it.event_date)}${it.near_event ? ' 🔴 קרוב' : ''}`);
  const sent = it.tier === 1
    ? (it.contract_sent_at ? `חוזה נשלח ${fmtShort(it.contract_sent_at)} (${agoText(daysAgo(it.contract_sent_at))})` : 'חוזה נשלח')
    : it.tier === 2
      ? (it.offer_sent_at ? `הצעת מחיר נשלחה ${fmtShort(it.offer_sent_at)} (${agoText(daysAgo(it.offer_sent_at))})` : 'הצעת מחיר נשלחה')
      : (it.priority === 'דחוף' || it.priority === 'גבוה') ? `עדיפות ${it.priority}` : '';
  const line2 = [...evParts, sent].filter(Boolean).join(' · ');
  const lines = [head];
  if (line2) lines.push(`   ${line2}`);
  lines.push(`   ${lastContactLine(it.last_contact)}`);
  const ball = ballLine(it);
  if (ball) lines.push(`   ${ball}`);
  lines.push(`   ${baseUrl}/?lead=${it.lead_id}`);
  return lines.join('\n');
}

const TIER_ICONS = { 1: '📝', 2: '💰', 3: '🔥' };

// Plaintext digest of a worklist for WhatsApp: numbered items per tier, sent date,
// last contact (who/when/what) and a "who has the ball" flag.
function worklistDigest(items, baseUrl, limitPerTier = MAX_PER_TIER) {
  const byTier = { 1: [], 2: [], 3: [] };
  for (const it of items) byTier[it.tier]?.push(it);
  const sections = [];
  for (const tier of [1, 2, 3]) {
    const all = byTier[tier];
    if (!all.length) continue;
    const list = all.slice(0, limitPerTier);
    const blocks = [`${TIER_ICONS[tier]} *${TIER_TITLES[tier]}* (${all.length})`];
    list.forEach((it, i) => blocks.push(itemBlock(i + 1, it, baseUrl)));
    if (all.length > list.length) blocks.push(`… ועוד ${all.length - list.length} במסך "עבודה להיום": ${baseUrl}/sales-worklist`);
    sections.push(blocks.join('\n\n'));
  }
  return sections.join('\n\n');
}

function counts(items) {
  return {
    tier1: items.filter(i => i.tier === 1).length,
    tier2: items.filter(i => i.tier === 2).length,
    tier3: items.filter(i => i.tier === 3).length,
  };
}

// Factual header: what/when/for whom + the three counts. No AI-generated text.
function briefingHeader(kind, scopeLabel, c) {
  const title = kind === 'morning' ? '☀️ פתיחת יום — שרביה' : '🌙 סיכום יום — שרביה';
  const parts = [];
  if (c.tier1) parts.push(c.tier1 === 1 ? '📝 חוזה אחד ממתין לחתימה' : `📝 ${c.tier1} חוזים ממתינים לחתימה`);
  if (c.tier2) parts.push(c.tier2 === 1 ? '💰 הצעת מחיר אחת פתוחה' : `💰 ${c.tier2} הצעות מחיר פתוחות`);
  if (c.tier3) parts.push(c.tier3 === 1 ? '🔥 ליד אחד דחוף / ללא קשר' : `🔥 ${c.tier3} דחופים / ללא קשר`);
  return [
    `${title} · ${israelDayName()} ${fmtShort(new Date())}`,
    scopeLabel,
    parts.join('\n'),
  ].filter(Boolean).join('\n');
}

function buildBriefingText(kind, items, baseUrl, scopeLabel = '') {
  return `${briefingHeader(kind, scopeLabel, counts(items))}\n\n${worklistDigest(items, baseUrl)}`;
}

async function buildAndSend(kind, recipient, scopeUser, baseUrl, scopeLabel = '') {
  const items = await getWorklist(scopeUser);
  if (!items.length) return false;
  await sendWhatsApp(recipient.phone, buildBriefingText(kind, items, baseUrl, scopeLabel));
  return true;
}

async function alreadySent(kind, recipientId, day) {
  const { rows } = await pool.query(
    'SELECT 1 FROM sales_briefing_log WHERE kind = $1 AND recipient = $2 AND sent_on = $3',
    [kind, recipientId, day]
  );
  return rows.length > 0;
}

async function markSent(kind, recipientId, day) {
  await pool.query(
    'INSERT INTO sales_briefing_log (kind, recipient, sent_on) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [kind, recipientId, day]
  );
}

// Runs on an interval; fires each briefing once/day at its configured Israel hour.
async function runSalesBriefings() {
  try {
    if ((await setting('sales_briefing_enabled', 'true')) !== 'true') return;
    const hour = israelHour();
    const morningHour = parseInt(await setting('sales_briefing_morning_hour', '8'), 10);
    const eveningHour = parseInt(await setting('sales_briefing_evening_hour', '18'), 10);

    let kind = null;
    if (hour === morningHour) kind = 'morning';
    else if (hour === eveningHour) kind = 'evening';
    if (!kind) return;

    const day = israelDateStr();
    const baseUrl = process.env.SERVER_URL || 'https://www.proevent.co.il';

    // Users who see everyone's leads (admin / manager / sales manager) get ONE aggregate
    // briefing — even if they also hold the sales role. They are excluded from the rep loop
    // below; otherwise the rep loop sent them their own leads only and marked them as sent.
    const ALL_SCOPE = ['admin', 'manager', 'sales_manager'];
    const { rows: mgrs } = await pool.query(
      `SELECT id, display_name, phone FROM users
       WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
         AND (roles && $1::text[] OR role = ANY($1::text[]))`, [ALL_SCOPE]
    );
    for (const mgr of mgrs) {
      if (await alreadySent(kind, mgr.id, day)) continue;
      await buildAndSend(kind, mgr, { id: mgr.id, roles: ['manager'] }, baseUrl, 'כל הנציגים');
      await markSent(kind, mgr.id, day);
    }

    // Sales reps → their own worklist
    const { rows: reps } = await pool.query(
      `SELECT id, display_name, phone FROM users
       WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
         AND ('sales' = ANY(roles) OR role = 'sales')
         AND NOT (roles && $1::text[] OR role = ANY($1::text[]))`, [ALL_SCOPE]
    );
    for (const rep of reps) {
      if (await alreadySent(kind, rep.id, day)) continue;
      await buildAndSend(kind, rep, { id: rep.id, roles: ['sales'] }, baseUrl, rep.display_name ? `הלידים של ${rep.display_name}` : '');
      await markSent(kind, rep.id, day); // also when nothing to send — avoid re-checking this hour
    }
    console.log(`[SalesBriefing] ${kind} sent to ${reps.length} reps + ${mgrs.length} managers`);
  } catch (err) {
    console.error('[SalesBriefing] error:', err.message);
  }
}

module.exports = { runSalesBriefings, buildBriefingText };
