// "תשלום ללא מסמך" — an employee marked in the lead card that a deposit / full payment
// was received (the "מקדמה התקבלה" / "תשלום מלא התקבל" checkboxes, or the stage move to
// "התקבלה מקדמה"), and no receipt followed. Added 2026-09-13, reworked 2026-09-14:
// the trigger is the employee's marking in the card — NOT customer messages.
//
// A signal auto-closes once a receipt-type document (קבלה / חשבונית-מס-קבלה, or a
// pending document of those types) exists on the lead; a user can also dismiss it.
const pool = require('../db/pool');

const KIND_LABEL = { deposit: 'מקדמה', full_payment: 'תשלום מלא' };

// Receipt-type documents on the lead (issued files + pending approvals), newest last
async function receiptCount(leadId) {
  const { rows: [r] } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM files WHERE lead_id = $1
         AND (filename LIKE 'קבלה-%' OR filename LIKE 'חשבונית-מס-קבלה-%')) +
      (SELECT COUNT(*)::int FROM pending_documents WHERE lead_id = $1 AND status <> 'rejected'
         AND (payload->>'type') IN ('400','320')) AS n
  `, [leadId]);
  return r?.n || 0;
}

// How many receipts a lead "should" have for the given kind to be considered documented:
// the deposit needs one, the full payment needs one more than the deposit (if a deposit
// was marked at all).
async function isDocumented(lead, kind) {
  const n = await receiptCount(lead.id);
  if (kind === 'deposit') return n >= 1;
  const hadDeposit = lead.deposit_confirmed || lead.stage === 'deposit' || lead.stage === 'production' || lead.stage === 'completed';
  return n >= (hadDeposit ? 2 : 1);
}

// Called from PATCH /api/leads/:id with the row before and after the update.
async function onLeadUpdated(prev, lead, userId) {
  if (!prev || !lead) return;
  const events = [];
  const depositNow = (lead.deposit_confirmed && !prev.deposit_confirmed) || (lead.stage === 'deposit' && prev.stage !== 'deposit');
  const fullNow    = lead.full_payment_confirmed && !prev.full_payment_confirmed;
  if (depositNow) events.push('deposit');
  if (fullNow)    events.push('full_payment');
  for (const kind of events) {
    try {
      if (await isDocumented(lead, kind)) continue;
      const amount = kind === 'deposit' ? lead.deposit_amount : lead.full_payment_amount;
      const date   = kind === 'deposit' ? lead.deposit_date   : lead.full_payment_date;
      const { rows: [u] } = userId ? await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]) : { rows: [] };
      await pool.query(`
        INSERT INTO payment_signals (lead_id, kind, said_at, amount, method, snippet, marked_by)
        SELECT $1, $2, $3, $4, NULL, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM payment_signals WHERE lead_id = $1 AND kind = $2 AND status = 'open')
      `, [lead.id, kind, date || new Date(), amount != null && amount !== '' ? Number(amount) : null,
          (kind === 'deposit' ? 'מקדמה סומנה כהתקבלה' : 'תשלום מלא סומן כהתקבל') + (u?.display_name ? ` על ידי ${u.display_name}` : ''),
          userId || null]);
    } catch (err) {
      console.error('[paymentSignals] onLeadUpdated error:', err.message);
    }
  }
}

// Cron: close open signals whose receipt has since been issued.
async function closeDocumentedPaymentSignals() {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.kind, l.id AS lead_id, l.stage, l.deposit_confirmed
      FROM payment_signals s JOIN leads l ON l.id = s.lead_id WHERE s.status = 'open'
    `);
    for (const s of rows) {
      const lead = { id: s.lead_id, stage: s.stage, deposit_confirmed: s.deposit_confirmed };
      if (await isDocumented(lead, s.kind)) {
        await pool.query(`UPDATE payment_signals SET status = 'done', resolved_at = NOW() WHERE id = $1`, [s.id]);
      }
    }
  } catch (err) {
    console.error('[paymentSignals] close scan error:', err.message);
  }
}

module.exports = { onLeadUpdated, closeDocumentedPaymentSignals, KIND_LABEL };
