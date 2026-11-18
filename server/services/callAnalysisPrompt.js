// The instructions the model follows when it summarises a call (Oran's "v2.0" guidelines,
// 2026-11-18). Managers edit them in הגדרות → "הנחיות לסיכום שיחות" (settings.call_analysis_prompt);
// an empty setting means the default in callAnalysisPrompt.md.
//
// Two parts are NOT editable and are always added by the server:
//   • OUTPUT_FORMAT — the JSON fields. The CRM reads them by name (summary, dates_mentioned …);
//     a renamed field would silently empty the call cards.
//   • the call's own data (direction, rep, lead, CRM background, transcript) — sent as the user
//     message by callAnalysis.js.
// If a pasted prompt contains its own "# פורמט הפלט" / "# נתוני השיחה הנוכחית" sections they are
// cut off, so pasting the whole document (as Oran wrote it) is safe.
const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool');

const SETTING_KEY = 'call_analysis_prompt';
const DEFAULT_INSTRUCTIONS = fs.readFileSync(path.join(__dirname, 'callAnalysisPrompt.md'), 'utf8').trim();

const OUTPUT_FORMAT = `# פורמט הפלט

החזר JSON תקין בלבד, ללא טקסט נוסף וללא עטיפת Markdown.

שמור בדיוק על שמות השדות והטיפוסים הבאים:

{
  "summary": "",
  "dates_mentioned": [],
  "prices_mentioned": [],
  "customer_needs": [],
  "objections": [],
  "agreements": [],
  "next_steps": [],
  "sentiment": "נייטרלי",
  "sales_score": 0,
  "coaching_tips": [],
  "event_details": {
    "date": "",
    "guests": "",
    "budget": "",
    "event_type": ""
  }
}

כל המערכים מכילים מחרוזות בלבד.

אם אין מידע לשדה, החזר מערך ריק או מחרוזת ריקה בהתאם לטיפוס.

אין להוסיף שדות חדשים.

אין להשמיט שדות.

אין להחזיר ערכי null.

השתמש בתווי ירידת שורה תקינים בתוך מחרוזת ה-summary, כך שה-JSON יישאר תקין.`;

// Drop the sections the server owns from a pasted prompt
function cleanInstructions(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  const cut = t.search(/^#{1,3}\s*(פורמט הפלט|נתוני השיחה הנוכחית)\s*$/m);
  if (cut !== -1) t = t.slice(0, cut);
  return t.replace(/\n-{3,}\s*$/, '').trim();
}

async function getInstructions() {
  try {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTING_KEY]);
    const custom = cleanInstructions(rows[0]?.value);
    if (custom) return { text: custom, custom: true };
  } catch {}
  return { text: DEFAULT_INSTRUCTIONS, custom: false };
}

const systemPrompt = (instructions) => `${instructions}\n\n---\n\n${OUTPUT_FORMAT}`;

module.exports = { SETTING_KEY, DEFAULT_INSTRUCTIONS, OUTPUT_FORMAT, cleanInstructions, getInstructions, systemPrompt };
