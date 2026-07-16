const path = require('path');
const fs   = require('fs');
const puppeteer = require('puppeteer-core');
const pool = require('../db/pool');

const router = require('express').Router({ mergeParams: true });

// Load static assets once at startup
const alefRegB64  = fs.readFileSync(path.join(__dirname, '../fonts/Alef-Regular.ttf')).toString('base64');
const alefBoldB64 = fs.readFileSync(path.join(__dirname, '../fonts/Alef-Bold.ttf')).toString('base64');
const logoPath    = path.join(__dirname, '../../client/public/logo.jpg');
const logoB64     = fs.existsSync(logoPath) ? fs.readFileSync(logoPath).toString('base64') : '';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('he-IL');
}

function buildHtml({ fields, rows, texts, offerType, language }) {
  const en  = language === 'en' || fields.language === 'en';
  const dir = en ? 'ltr' : 'rtl';
  const cur = en ? 'NIS' : 'ש"ח';
  const m   = (n) => `${fmt(n)} ${cur}`;
  // RTL embedding marks are only needed in the Hebrew (RTL) layout.
  const rle = en ? '' : '‫';
  const pdf = en ? '' : '‬';
  const L = en ? {
    to: 'To', email: 'Email', phone: 'Phone', eventDate: 'Event date',
    doorTime: 'Doors open', endTime: 'Event end',
    subtotal: 'Subtotal (before VAT):', vat: 'VAT (18%):', total: 'Total to pay:',
    notes: 'Notes: ', noVat: 'Price does not include VAT',
    extraGuest: (g, p, wv) => `Each additional guest above ${g} guests is ${Number(p).toLocaleString()} ${cur} ${wv ? 'incl. VAT' : 'excl. VAT'}`,
  } : {
    to: 'לכבוד', email: 'מייל', phone: 'טלפון', eventDate: 'תאריך האירוע',
    doorTime: 'שעת פתיחת דלתות', endTime: 'שעת סיום האירוע',
    subtotal: 'סה"כ חייב במע"מ:', vat: 'מע"מ (18%):', total: 'סה"כ לתשלום:',
    notes: 'הערות: ', noVat: 'המחיר אינו כולל מע"מ',
    extraGuest: (g, p, wv) => `עלות כל אורח נוסף מעל ${g} אורחים הינה ${Number(p).toLocaleString()} ${cur} ${wv ? 'כולל מע"מ' : 'לא כולל מע"מ'}`,
  };

  const withVat       = fields.withVat !== false;
  const fixedSubtotal = rows.filter(r => !r.isPct).reduce((s, r) => s + (r.qty * r.price), 0);
  const getRowTotal   = (r) => r.isPct ? Math.round(fixedSubtotal * (r.pct || 0) / 100) : r.qty * r.price;
  const subtotal      = rows.reduce((s, r) => s + getRowTotal(r), 0);
  const vat           = withVat ? Math.round(subtotal * 0.18) : 0;
  const total         = subtotal + vat;

  const headerRowsHtml = [
    { label: L.to,        value: fields.name,      ltr: false },
    { label: L.email,     value: fields.email,     ltr: true  },
    { label: L.phone,     value: fields.phone,     ltr: true  },
    { label: L.eventDate, value: fields.eventDate, ltr: false },
    { label: L.doorTime,  value: fields.doorTime,  ltr: false },
    { label: L.endTime,   value: fields.endTime,   ltr: false },
  ]
    .filter(r => r.value)
    .map(({ label, value, ltr }) => `
      <tr>
        <td style="font-weight:bold;white-space:nowrap;padding-left:6pt;vertical-align:top;padding-bottom:2pt;">${rle}${esc(label)}:${pdf}</td>
        <td style="direction:${en ? 'ltr' : (ltr ? 'ltr' : 'rtl')};padding-bottom:2pt;vertical-align:top;">${esc(value)}</td>
      </tr>`)
    .join('');

  const tableHeadersHtml = texts.tableHeaders
    .map(h => `<th style="border:1px solid #ccc;padding:4px 6px;text-align:center;background:#f5f5f5;">${esc(h)}</th>`)
    .join('');

  const dataRowsHtml = rows.map(r => {
    const rowTotal  = r.isPct ? Math.round(fixedSubtotal * (r.pct || 0) / 100) : r.qty * r.price;
    const priceCell = r.isPct ? `${r.pct || 0}%` : m(r.price);
    const qtyCell   = r.isPct ? '-' : esc(String(r.qty));
    return `<tr>
      <td style="border:1px solid #ccc;padding:4px 6px;">${esc(r.label)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:8pt;color:#555;">${esc(r.desc || '')}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${qtyCell}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${priceCell}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${m(rowTotal)}</td>
    </tr>`;
  }).join('');

  const venueDescItemsHtml = (texts.venueDescItems || [])
    .filter(item => item.trim())
    .map(item => `<p style="font-size:9pt;margin-bottom:2pt;">${esc(item)}</p>`)
    .join('');
  const venueDescHtml = `
<p style="margin-top:6pt;font-weight:bold;font-size:9pt;">${esc(texts.venueDescHeader || '')}</p>
<p style="font-size:9pt;margin-bottom:2pt;">${esc(texts.venueDescIntro || '')}</p>
<div style="font-size:9pt;line-height:1.8;">${venueDescItemsHtml}</div>`;

  const extraGuestHtml = (fields.extraGuestPrice && Number(fields.extraGuestPrice) > 0)
    ? `<p style="margin-top:4pt;">${esc(L.extraGuest(String(fields.guests || ''), fields.extraGuestPrice, withVat))}</p>`
    : '';

  const packageCostLinesHtml = (texts.packageCostLines || [])
    .filter(l => l.trim())
    .map(l => `<div>${esc(l)}</div>`)
    .join('');
  const packageCostHtml = `<div style="font-size:9pt;line-height:2;margin-top:4pt;">${packageCostLinesHtml}</div>`;

  // Anchor the popup menu texts to their bullet by content, not position — the
  // list is editable, so fixed indices drift when items are added or removed.
  const chefIdx = texts.includes.findIndex(x => /תפריט שף|chef menu/i.test(x || ''));
  const barIdx  = texts.includes.findIndex(x => /תפריט בר|bar menu/i.test(x || ''));
  const includesHtml = texts.includes.map((item, i) => {
    let text = item;
    if (i === chefIdx && fields.chefMenu && !item.includes(fields.chefMenu)) text += ' ' + fields.chefMenu;
    if (i === barIdx  && fields.barMenu  && !item.includes(fields.barMenu))  text += ' ' + fields.barMenu;
    if (!text.trim()) return '';
    return `<div>• ${esc(text)}</div>`;
  }).join('');

  const extrasHtml = texts.extras
    .filter(item => item.trim())
    .map(item => `<div>• ${esc(item)}</div>`)
    .join('');

  const notesHtml = fields.notes
    ? `<p style="margin-top:8pt;">${rle}${esc(L.notes)}${pdf}${esc(fields.notes)}</p>`
    : '';

  return `<!DOCTYPE html>
<html dir="${dir}">
<head>
<meta charset="UTF-8">
<style>
@font-face {
  font-family: 'Alef';
  src: url('data:font/truetype;base64,${alefRegB64}') format('truetype');
  font-weight: normal;
}
@font-face {
  font-family: 'Alef';
  src: url('data:font/truetype;base64,${alefBoldB64}') format('truetype');
  font-weight: bold;
}
@page { size: A4; margin: 15mm 20mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Alef', Arial, sans-serif; font-size: 10pt; color: #222; direction: ${dir}; line-height: 1.7; }
</style>
</head>
<body>

${logoB64 ? `<div style="text-align:center;margin-bottom:10pt;"><img src="data:image/jpeg;base64,${logoB64}" style="height:80px;object-fit:contain;" /></div>` : ''}

<h2 style="text-align:center;font-size:15pt;font-weight:bold;margin-bottom:12pt;">${esc(texts.title)}</h2>

<table style="margin-bottom:8pt;border-collapse:collapse;">
  <tbody>${headerRowsHtml}</tbody>
</table>

<p style="margin-top:8pt;font-size:9pt;color:#555;">${esc(texts.arrival)}</p>

${venueDescHtml}

<h3 style="margin-top:12pt;margin-bottom:4pt;font-weight:bold;">${esc(texts.costsHeader)}</h3>

${offerType === 'package' ? packageCostHtml : `
<table style="width:100%;border-collapse:collapse;font-size:9pt;">
  <thead><tr>${tableHeadersHtml}</tr></thead>
  <tbody>
    ${dataRowsHtml}
    ${withVat ? `
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${en ? 'left' : 'right'};font-weight:bold;">${rle}${esc(L.subtotal)}${pdf}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;font-weight:bold;">${m(subtotal)}</td>
    </tr>
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${en ? 'left' : 'right'};">${rle}${esc(L.vat)}${pdf}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${m(vat)}</td>
    </tr>` : ''}
    <tr style="font-weight:bold;">
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${en ? 'left' : 'right'};">${rle}${esc(L.total)}${pdf}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${m(total)}</td>
    </tr>
  </tbody>
</table>

<p style="margin-top:10pt;">${esc(texts.minGuestsPrefix)} ${esc(fields.guests || '')} ${esc(texts.minGuestsSuffix)}</p>

${extraGuestHtml}
`}

<p style="margin-top:8pt;margin-bottom:2pt;font-weight:bold;">${esc(texts.includesHeader)}</p>
<div style="line-height:2;">${includesHtml}</div>

<p style="margin-top:10pt;font-weight:bold;">${esc(texts.extrasHeader)}</p>
<div style="line-height:2;">${extrasHtml}</div>

${notesHtml}

<p style="margin-top:10pt;font-size:9pt;color:#555;">${esc(texts.payment)}</p>
${!withVat ? `<p style="font-size:9pt;font-weight:bold;">${esc(L.noVat)}</p>` : ''}
<p style="font-size:9pt;color:#555;">${esc(texts.validity)}</p>
<p style="margin-top:6pt;font-weight:bold;">${esc(texts.closing)}</p>

</body>
</html>`;
}

router.get('/latest', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM price_offers WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  let browser;
  try {
    const { fields, rows, texts, offerType, language } = req.body;

    const html = buildHtml({ fields, rows, texts, offerType, language });

    // Save offer data for later import into contracts (non-blocking — never break PDF generation)
    const fieldsToSave = { ...fields, language: language || fields.language || 'he' };
    pool.query(
      `INSERT INTO price_offers (lead_id, fields, rows, offer_type, includes) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, JSON.stringify(fieldsToSave), JSON.stringify(rows), offerType || 'regular', JSON.stringify(texts?.includes || [])]
    ).catch(err => console.error('[PriceOffer] Failed to save offer history:', err.message));

    browser = await Promise.race([
      puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF generation timeout')), 30000)),
    ]);

    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const safeName = encodeURIComponent(`price-offer-${fields.name || 'offer'}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="price-offer.pdf"; filename*=UTF-8''${safeName}`);
    res.send(buffer);
  } catch (err) {
    console.error('[PriceOffer PDF]', err);
    if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = router;
