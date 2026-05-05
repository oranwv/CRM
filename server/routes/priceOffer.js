const path = require('path');
const fs   = require('fs');
const puppeteer = require('puppeteer-core');

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

function buildHtml({ fields, rows, texts }) {
  const subtotal = rows.reduce((s, r) => s + (r.qty * r.price), 0);
  const vat      = Math.round(subtotal * 0.18);
  const total    = subtotal + vat;

  const headerRowsHtml = [
    { label: 'לכבוד',             value: fields.name,      ltr: false },
    { label: 'מייל',              value: fields.email,     ltr: true  },
    { label: 'טלפון',             value: fields.phone,     ltr: true  },
    { label: 'תאריך האירוע',      value: fields.eventDate, ltr: false },
    { label: 'שעת פתיחת דלתות',   value: fields.doorTime,  ltr: false },
    { label: 'שעת סיום האירוע',   value: fields.endTime,   ltr: false },
  ]
    .filter(r => r.value)
    .map(({ label, value, ltr }) => `
      <tr>
        <td style="font-weight:bold;white-space:nowrap;padding-left:6pt;vertical-align:top;padding-bottom:2pt;">&#x202B;${esc(label)}:&#x202C;</td>
        <td style="direction:${ltr ? 'ltr' : 'rtl'};padding-bottom:2pt;vertical-align:top;">${esc(value)}</td>
      </tr>`)
    .join('');

  const tableHeadersHtml = texts.tableHeaders
    .map(h => `<th style="border:1px solid #ccc;padding:4px 6px;text-align:center;background:#f5f5f5;">${esc(h)}</th>`)
    .join('');

  const dataRowsHtml = rows.map(r => `
    <tr>
      <td style="border:1px solid #ccc;padding:4px 6px;">${esc(r.label)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:8pt;color:#555;">${esc(r.desc || '')}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${esc(String(r.qty))}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${fmt(r.price)} ש"ח</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${fmt(r.qty * r.price)} ש"ח</td>
    </tr>`).join('');

  const includesHtml = texts.includes.map((item, i) => {
    let text = item;
    if (i === 3 && fields.chefMenu) text += ' ' + fields.chefMenu;
    if (i === 4 && fields.barMenu)  text += ' ' + fields.barMenu;
    return `<div>• ${esc(text)}</div>`;
  }).join('');

  const extrasHtml = texts.extras
    .map(item => `<div>• ${esc(item)}</div>`)
    .join('');

  const notesHtml = fields.notes
    ? `<p style="margin-top:8pt;">&#x202B;הערות: &#x202C;${esc(fields.notes)}</p>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl">
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
body { font-family: 'Alef', Arial, sans-serif; font-size: 10pt; color: #222; direction: rtl; line-height: 1.7; }
</style>
</head>
<body>

${logoB64 ? `<div style="text-align:center;margin-bottom:10pt;"><img src="data:image/jpeg;base64,${logoB64}" style="height:80px;object-fit:contain;" /></div>` : ''}

<h2 style="text-align:center;font-size:15pt;font-weight:bold;margin-bottom:12pt;">${esc(texts.title)}</h2>

<table style="margin-bottom:8pt;border-collapse:collapse;">
  <tbody>${headerRowsHtml}</tbody>
</table>

<p style="margin-top:8pt;font-size:9pt;color:#555;">${esc(texts.arrival)}</p>

<h3 style="margin-top:12pt;margin-bottom:4pt;font-weight:bold;">${esc(texts.costsHeader)}</h3>

<table style="width:100%;border-collapse:collapse;font-size:9pt;">
  <thead><tr>${tableHeadersHtml}</tr></thead>
  <tbody>
    ${dataRowsHtml}
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:right;font-weight:bold;">&#x202B;סה"כ חייב במע"מ:&#x202C;</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;font-weight:bold;">${fmt(subtotal)} ש"ח</td>
    </tr>
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:right;">&#x202B;מע"מ (18%):&#x202C;</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${fmt(vat)} ש"ח</td>
    </tr>
    <tr style="font-weight:bold;">
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:right;">&#x202B;סה"כ לתשלום:&#x202C;</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${fmt(total)} ש"ח</td>
    </tr>
  </tbody>
</table>

<p style="margin-top:10pt;">${esc(texts.minGuestsPrefix)} ${esc(fields.guests || '')} ${esc(texts.minGuestsSuffix)}</p>

<p style="margin-top:8pt;margin-bottom:2pt;font-weight:bold;">${esc(texts.includesHeader)}</p>
<div style="line-height:2;">${includesHtml}</div>

<p style="margin-top:10pt;font-weight:bold;">${esc(texts.extrasHeader)}</p>
<div style="line-height:2;">${extrasHtml}</div>

${notesHtml}

<p style="margin-top:10pt;font-size:9pt;color:#555;">${esc(texts.payment)}</p>
<p style="font-size:9pt;color:#555;">${esc(texts.validity)}</p>
<p style="margin-top:6pt;font-weight:bold;">${esc(texts.closing)}</p>

</body>
</html>`;
}

router.post('/', async (req, res) => {
  let browser;
  try {
    const { fields, rows, texts } = req.body;

    const html = buildHtml({ fields, rows, texts });

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
