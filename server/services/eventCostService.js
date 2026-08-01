const pool = require('../db/pool');
const { OpenAI } = require('openai');

// Normalizes a cost line. When qty and unit_price are both numeric the amount
// is ALWAYS computed as qty × unit_price (LLM arithmetic and client input are
// not trusted); otherwise the flat amount is used as-is.
function normalizeLine(l, i) {
  const qty       = l.qty       != null && l.qty       !== '' && !isNaN(Number(l.qty))        ? Number(l.qty)        : null;
  const unitPrice = l.unit_price != null && l.unit_price !== '' && !isNaN(Number(l.unit_price)) ? Number(l.unit_price) : null;
  const amount = (qty != null && unitPrice != null)
    ? Math.round(qty * unitPrice)
    : (Number(l.amount) || 0);
  return {
    id:         l.id || i + 1,
    label:      String(l.label || '').trim(),
    qty,
    unit_price: unitPrice,
    amount,
    basis:      (l.basis != null ? String(l.basis) : '').trim(),
  };
}

// Computes an event's cost lines with AI, based on the cost-model document(s)
// in the assistant's knowledge base + the lead's contract data, and saves them
// to event_costs. With onlyIfEmpty, existing (possibly hand-edited) lines are
// never overwritten — used by the automatic run on contract signing.
async function generateEventCosts(leadId, userId = null, { onlyIfEmpty = false } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  if (onlyIfEmpty) {
    const { rows } = await pool.query('SELECT lines FROM event_costs WHERE lead_id = $1', [leadId]);
    if (rows.length && Array.isArray(rows[0].lines) && rows[0].lines.length > 0) return null;
  }

  const [{ rows: kbFiles }, { rows: [lead] }, { rows: contractRows }] = await Promise.all([
    pool.query('SELECT filename, content_text FROM ai_knowledge_files ORDER BY created_at DESC'),
    pool.query('SELECT name, event_type, guest_count, event_date FROM leads WHERE id = $1', [leadId]),
    pool.query(`SELECT contract_data FROM contracts WHERE lead_id = $1
                ORDER BY (status = 'signed') DESC, created_at DESC LIMIT 1`, [leadId]),
  ]);
  if (!lead) throw new Error('Lead not found');
  if (!kbFiles.length) {
    throw new Error('אין מסמכים במאגר הידע של העוזר — העלה את מסמך מודל העלויות בהגדרות');
  }

  const cd     = contractRows[0]?.contract_data || null;
  const f      = cd?.fields || {};
  const guests = f.guests || f.packageGuests || lead.guest_count || '';
  const eventInfo = [
    `שם האירוע/לקוח: ${lead.name || ''}`,
    `סוג אירוע: ${lead.event_type || ''}`,
    `מספר אורחים: ${guests}`,
    `תאריך אירוע: ${lead.event_date ? String(lead.event_date).slice(0, 10) : ''}`,
    cd?.calculated?.subtotal != null ? `סכום החוזה לפני מע"מ: ${cd.calculated.subtotal} ש"ח` : '',
    f.chefMenu ? `תפריט שף: ${f.chefMenu}` : '',
    f.barMenu  ? `תפריט בר: ${f.barMenu}`  : '',
  ].filter(Boolean).join('\n');

  const docs = kbFiles.map(k => `## מסמך: ${k.filename}\n${k.content_text}`).join('\n\n');
  const openai = new OpenAI({ apiKey: key });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `אתה מחשב עלויות הפקה לאירוע באולם אירועים לפי מודל העלויות של העסק.

המסמכים של העסק (כולל מודל העלויות):
${docs}

פרטי האירוע:
${eventInfo}

חשב את שורות העלות של האירוע לפי המודל שבמסמכים (למשל: מלצרים, ברמנים, שף/קייטרינג, אבטחה, ניקיון וכו' — לפי הכללים והתעריפים שבמודל, בהתאם למספר האורחים).
החזר JSON בלבד בפורמט:
{"lines":[{"label":"<שם העלות בעברית>","qty":<כמות יחידות כמספר, או null אם זו עלות קבועה>,"unit_price":<מחיר ליחידה בש"ח כמספר, או null>,"amount":<סכום בש"ח — רק לשורות ללא כמות>,"basis":"<הסבר קצר, למשל: מלצר לכל 17 אורחים>"}]}
חשוב: לעלות שנגזרת מכמות (מלצרים, מנות לאורח וכו') החזר qty ו-unit_price ואל תחשב את המכפלה בעצמך — המערכת תכפיל. לעלות קבועה החזר amount בלבד עם qty ו-unit_price כ-null.
אם אין במסמכים מודל עלויות ברור — החזר {"lines":[]}.`,
    }],
  });

  let lines;
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    lines = (parsed.lines || [])
      .filter(l => (l.label || '').trim())
      .map((l, i) => normalizeLine({ ...l, id: i + 1 }, i));
  } catch {
    throw new Error('תשובת ה-AI לא תקינה — נסה שוב');
  }
  if (!lines.length) {
    throw new Error('ה-AI לא מצא מודל עלויות ישים במסמכי מאגר הידע');
  }

  const { rows: [row] } = await pool.query(`
    INSERT INTO event_costs (lead_id, lines, ai_generated_at, updated_by, updated_at)
    VALUES ($1, $2, NOW(), $3, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET lines = $2, ai_generated_at = NOW(), updated_by = $3, updated_at = NOW()
    RETURNING lines, ai_generated_at
  `, [leadId, JSON.stringify(lines), userId]);

  return { lines: row.lines, ai_generated_at: row.ai_generated_at };
}

module.exports = { generateEventCosts, normalizeLine };
