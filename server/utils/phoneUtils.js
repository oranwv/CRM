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

async function findLeadByPhone(pool, normalizedPhone) {
  if (!normalizedPhone) return null;

  const leadsSQL = NORMALIZE_SQL.replace(/{col}/g, 'phone');
  const { rows } = await pool.query(
    `SELECT id FROM leads WHERE ${leadsSQL} = $1 LIMIT 1`,
    [normalizedPhone]
  );
  if (rows.length) return rows[0].id;

  const contactsSQL = NORMALIZE_SQL.replace(/{col}/g, 'value');
  const { rows: byContact } = await pool.query(
    `SELECT lead_id FROM lead_contacts WHERE type = 'phone' AND ${contactsSQL} = $1 LIMIT 1`,
    [normalizedPhone]
  );
  return byContact.length ? byContact[0].lead_id : null;
}

module.exports = { normalizePhone, findLeadByPhone };
