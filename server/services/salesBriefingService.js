const pool = require('../db/pool');
const { OpenAI } = require('openai');
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

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('he-IL') : '';
}

// A compact plaintext digest of a worklist (top items per tier) for the AI prompt / fallback
function worklistDigest(items, baseUrl, limitPerTier = 6) {
  const byTier = { 1: [], 2: [], 3: [] };
  for (const it of items) byTier[it.tier]?.push(it);
  const lines = [];
  for (const tier of [1, 2, 3]) {
    const list = byTier[tier].slice(0, limitPerTier);
    if (!list.length) continue;
    lines.push(`*${TIER_TITLES[tier]}:*`);
    for (const it of list) {
      const near = it.near_event ? ' 🔴 אירוע קרוב' : '';
      const ev = it.event_date ? ` · אירוע ${fmtDate(it.event_date)}` : '';
      const rep = it.rep ? ` · ${it.rep}` : '';
      lines.push(`• ${it.name}${ev}${near}${rep} — ${it.reason}\n  ${baseUrl}/?lead=${it.lead_id}`);
    }
  }
  return lines.join('\n');
}

// AI intro line for the briefing (short, motivating). Falls back to a static line.
async function briefingIntro(kind, name, counts) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('no key');
    const client = new OpenAI({ apiKey: key });
    const when = kind === 'morning' ? 'פתיחת יום' : 'סיכום יום';
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `כתוב משפט פתיחה קצר אחד בעברית ל${when} של נציג מכירות באולם אירועים "שרביה", בגובה העיניים ומעודד. ${name ? `שם: ${name}. ` : ''}נתונים: ${counts.tier1} חוזים ממתינים לחתימה, ${counts.tier2} הצעות מחיר פתוחות, ${counts.tier3} דחופים/חמים. החזר רק את המשפט.`,
      }],
    });
    return completion.choices[0].message.content.trim();
  } catch {
    const when = kind === 'morning' ? 'בוקר טוב! הנה הפוקוס להיום' : 'סיכום היום — מה שעדיין פתוח';
    return when;
  }
}

function counts(items) {
  return {
    tier1: items.filter(i => i.tier === 1).length,
    tier2: items.filter(i => i.tier === 2).length,
    tier3: items.filter(i => i.tier === 3).length,
  };
}

async function buildAndSend(kind, recipient, scopeUser, baseUrl, titleSuffix = '') {
  const items = await getWorklist(scopeUser);
  if (!items.length) return false;
  const c = counts(items);
  const intro = await briefingIntro(kind, recipient.display_name, c);
  const header = kind === 'morning' ? '☀️ פתיחת יום — שרביה' : '🌙 סיכום יום — שרביה';
  const body = `${header}${titleSuffix}\n${intro}\n\n${worklistDigest(items, baseUrl)}`;
  await sendWhatsApp(recipient.phone, body);
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

    // Sales reps → their own worklist
    const { rows: reps } = await pool.query(
      `SELECT id, display_name, phone FROM users
       WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
         AND ('sales' = ANY(roles) OR role = 'sales')`
    );
    for (const rep of reps) {
      if (await alreadySent(kind, rep.id, day)) continue;
      const sent = await buildAndSend(kind, rep, { id: rep.id, roles: ['sales'] }, baseUrl);
      if (sent) await markSent(kind, rep.id, day);
      else await markSent(kind, rep.id, day); // nothing to send today — still mark to avoid re-check
    }

    // Managers/admins → aggregate (all reps' leads)
    const { rows: mgrs } = await pool.query(
      `SELECT id, display_name, phone FROM users
       WHERE phone IS NOT NULL AND NOT COALESCE(blocked, false)
         AND ('admin' = ANY(roles) OR 'manager' = ANY(roles) OR role IN ('admin','manager'))`
    );
    for (const mgr of mgrs) {
      if (await alreadySent(kind, mgr.id, day)) continue;
      const sent = await buildAndSend(kind, mgr, { id: mgr.id, roles: ['manager'] }, baseUrl, ' (מנהל — כל הנציגים)');
      await markSent(kind, mgr.id, day);
      void sent;
    }
    console.log(`[SalesBriefing] ${kind} sent to ${reps.length} reps + ${mgrs.length} managers`);
  } catch (err) {
    console.error('[SalesBriefing] error:', err.message);
  }
}

module.exports = { runSalesBriefings };
