const NORMALIZE_SQL = `
  CASE
    WHEN REGEXP_REPLACE({col},'[^0-9]','','g') LIKE '972%'
      THEN REGEXP_REPLACE({col},'[^0-9]','','g')
    WHEN REGEXP_REPLACE({col},'[^0-9]','','g') LIKE '0%'
      THEN '972' || SUBSTRING(REGEXP_REPLACE({col},'[^0-9]','','g'), 2)
    ELSE REGEXP_REPLACE({col},'[^0-9]','','g')
  END`;

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

// When the same phone belongs to several leads (duplicates, a returning customer), prefer the
// one that is still being worked on: open stages before lost/completed, then the most recently
// touched. Inbound calls and WhatsApp messages land on that lead (Oran, 2026-10-28: a missed
// call went into the closed duplicate instead of the open one).
const PREFER_OPEN = `CASE WHEN l.stage IN ('lost','completed') THEN 1 ELSE 0 END, COALESCE(l.updated_at, l.created_at) DESC NULLS LAST, l.id DESC`;

async function findLeadByPhone(pool, normalizedPhone) {
  if (!normalizedPhone) return null;

  const leadsSQL = NORMALIZE_SQL.replace(/{col}/g, 'l.phone');
  const { rows } = await pool.query(
    `SELECT l.id FROM leads l WHERE ${leadsSQL} = $1 ORDER BY ${PREFER_OPEN} LIMIT 1`,
    [normalizedPhone]
  );
  if (rows.length) return rows[0].id;

  const contactsSQL = NORMALIZE_SQL.replace(/{col}/g, 'c.value');
  const { rows: byContact } = await pool.query(
    `SELECT c.lead_id FROM lead_contacts c JOIN leads l ON l.id = c.lead_id
     WHERE c.type = 'phone' AND ${contactsSQL} = $1 ORDER BY ${PREFER_OPEN} LIMIT 1`,
    [normalizedPhone]
  );
  return byContact.length ? byContact[0].lead_id : null;
}

module.exports = { normalizePhone, findLeadByPhone };
