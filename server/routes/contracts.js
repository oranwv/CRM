const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const puppeteer = require('puppeteer-core');
const axios     = require('axios');
const pool      = require('../db/pool');
const { uploadBuffer, getSignedUrl } = require('../services/storageService');
const { sendEmail }    = require('../services/gmailService');
const { generateEventCosts } = require('../services/eventCostService');

const alefRegB64  = fs.readFileSync(path.join(__dirname, '../fonts/Alef-Regular.ttf')).toString('base64');
const alefBoldB64 = fs.readFileSync(path.join(__dirname, '../fonts/Alef-Bold.ttf')).toString('base64');
const logoPath    = path.join(__dirname, '../../client/public/logo.jpg');
const logoB64     = fs.existsSync(logoPath) ? fs.readFileSync(logoPath).toString('base64') : '';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(n) { return Number(n || 0).toLocaleString('he-IL'); }

function buildContractHtml({ contractData, signingData, staffSignature }) {
  const { fields, rows, calculated } = contractData;
  const texts = contractData.texts || {};
  const isPackage = (contractData.offerType || 'regular') === 'package';
  const en   = contractData.language === 'en';
  const dir  = en ? 'ltr' : 'rtl';
  const cur  = en ? 'NIS' : '&#x05E9;"&#x05D7;';
  const money = (n) => `${fmt(n)} ${cur}`;
  const ta   = en ? 'right' : 'left'; // totals label alignment (toward the amount cell)
  const t = (key) => esc(texts[key] || '');
  const tArr = (key) => Array.isArray(texts[key]) ? texts[key] : [];
  const {
    clientName, eventDate, startTime, endTime,
    guests, extraGuestPrice, chefMenu, barMenu, depositPercent,
    packageGuests, packageTotal, packageExtraGuestPrice,
  } = fields;
  const { subtotal, vat, total, depositAmount, depositAmountVat, remainingBalance, cancellationDate } = calculated;

  const signed = !!signingData;
  const ul = (text, extra = 40) => `<span style="display:inline-block;border-bottom:1px solid #333;padding-left:${extra}px;">${esc(text)}</span>`;
  const fmtDate = (d) => { if (!d) return ''; if (d.includes('-')) { const [y, m, dd] = d.split('-'); return en ? `${dd}/${m}/${y}` : `${dd}.${m}.${y}`; } return d; };
  const ordererName    = signed ? ul(signingData.ordererName, 40)                 : '<span style="display:inline-block;min-width:140px;border-bottom:1px solid #333;">&nbsp;</span>';
  const signerName     = signed ? ul(signingData.signerName, 40)                  : '<span style="display:inline-block;min-width:140px;border-bottom:1px solid #333;">&nbsp;</span>';
  const signerIdNumber = signed ? ul(signingData.signerIdNumber, 30)              : '<span style="display:inline-block;min-width:120px;border-bottom:1px solid #333;">&nbsp;</span>';
  const signingDate    = signed ? ul(fmtDate(signingData.signingDate), 30)        : '<span style="display:inline-block;min-width:100px;border-bottom:1px solid #333;">&nbsp;</span>';

  const eventDateDisplay = eventDate
    ? new Date(eventDate + 'T12:00:00').toLocaleDateString(en ? 'en-GB' : 'he-IL')
    : '';

  const fixedRowsSubtotal = (rows || []).filter(r => !r.isPct).reduce((s, r) => s + (r.qty ?? 0) * (r.price ?? 0), 0);
  const dataRowsHtml = (rows || []).map(r => {
    const rowTotal  = r.isPct ? Math.round(fixedRowsSubtotal * (r.pct || 0) / 100) : (r.qty ?? 0) * (r.price ?? 0);
    const priceCell = r.isPct ? `${r.pct || 0}%` : money(r.price);
    const qtyCell   = r.isPct ? '-' : esc(String(r.qty ?? ''));
    return `<tr>
      <td style="border:1px solid #ccc;padding:4px 6px;">${esc(r.label)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:8pt;color:#555;">${esc(r.desc || '')}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${qtyCell}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${priceCell}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${money(rowTotal)}</td>
    </tr>`;
  }).join('');

  const customerSigHtml = signed && signingData.signatureImage
    ? `<img src="${signingData.signatureImage}" style="max-height:70px;max-width:180px;display:block;margin:0 auto;" />`
    : '<div style="height:70px;"></div>';

  const staffSigHtml = staffSignature
    ? `<img src="${staffSignature}" style="max-height:70px;max-width:180px;display:block;margin:0 auto;" />`
    : '<div style="height:70px;"></div>';

  const shkalHtml = '&#x05E9;"&#x05D7;';

  return `<!DOCTYPE html>
<html dir="${dir}">
<head>
<meta charset="UTF-8">
<style>
@font-face { font-family:'Alef'; src:url('data:font/truetype;base64,${alefRegB64}') format('truetype'); font-weight:normal; }
@font-face { font-family:'Alef'; src:url('data:font/truetype;base64,${alefBoldB64}') format('truetype'); font-weight:bold; }
@page { size:A4; margin:15mm 20mm; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:'Alef',Arial,sans-serif; font-size:10pt; color:#222; direction:${dir}; line-height:1.8; }
p { margin-bottom:4pt; }
h2 { text-align:center; font-size:14pt; margin-bottom:10pt; }
h3 { font-size:11pt; font-weight:bold; margin-top:10pt; margin-bottom:4pt; }
table { border-collapse:collapse; width:100%; }
th,td { font-size:9pt; }
ul { list-style:none; padding:0; }
li { margin-bottom:2pt; }
</style>
</head>
<body>

${logoB64 ? `<div style="text-align:center;margin-bottom:10pt;"><img src="data:image/jpeg;base64,${logoB64}" style="height:70px;object-fit:contain;" /></div>` : ''}

<h2>${t('title') || (en ? 'Event Booking Agreement' : '&#x05D4;&#x05E1;&#x05DB;&#x05DD; &#x05D4;&#x05D6;&#x05DE;&#x05E0;&#x05EA; &#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2;')}</h2>

<p>${en
  ? `Entered into and signed on ${signingDate} for an event on ${esc(eventDateDisplay)}`
  : `&#x05E9;&#x05E0;&#x05E2;&#x05E8;&#x05DA; &#x05D5;&#x05E0;&#x05D7;&#x05EA;&#x05DD; &#x05D1;&#x05D9;&#x05D5;&#x05DD; ${signingDate} &#x05DC;&#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2; &#x05D1;&#x05EA;&#x05D0;&#x05E8;&#x05D9;&#x05DA; ${esc(eventDateDisplay)}`}</p>

<p>${en
  ? `Between: ${ordererName}&nbsp;&nbsp;&nbsp;ID/Company No.: ${signerIdNumber}`
  : `&#x202B;&#x05D1;&#x05D9;&#x05DF;:&#x202C; ${ordererName}&nbsp;&nbsp;&nbsp;&#x202B;&#x05EA;.&#x05D6;/&#x05D7;.&#x05E4;:&#x202C; ${signerIdNumber}`}</p>
<p>${en ? '(jointly and severally, hereinafter: "the Orderer")' : '(&#x05D1;&#x05D9;&#x05D7;&#x05D3; &#x05D5;&#x05DC;&#x05D7;&#x05D5;&#x05D3; &#x05DC;&#x05D4;&#x05DC;&#x05DF;: "&#x05D4;&#x05DE;&#x05D6;&#x05DE;&#x05D9;&#x05DF;")'}</p>
<p style="text-align:${ta};">${en ? 'First party;' : '&#x05DE;&#x05E6;&#x05D3; &#x05D0;&#x05D7;&#x05D3;;'}</p>
<p>${en ? 'And between:' : '&#x05DC;&#x05D1;&#x05D9;&#x05DF;:'}</p>
<p>${en ? 'Sharabiya, partnership no. 558450383' : '&#x05E9;&#x05E8;&#x05D1;&#x05D9;&#x05D4;, &#x05DE;&#x05E1;&#x05E4;&#x05E8; &#x05E9;&#x05D5;&#x05EA;&#x05E4;&#x05D5;&#x05EA; 558450383'}</p>
<p>${en ? 'Marche, 18 Shimon HaTzadik St., Tel Aviv.' : '&#x05DE;&#x05E8;&#x05D7;\' &#x05E9;&#x05DE;&#x05E2;&#x05D5;&#x05DF; &#x05D4;&#x05E6;&#x05D3;&#x05D9;&#x05E7; 18 &#x05EA;&#x05DC; &#x05D0;&#x05D1;&#x05D9;&#x05D1;.'}</p>
<p>${en ? '(hereinafter: "the Vendor")' : '(&#x05DC;&#x05D4;&#x05DC;&#x05DF;: "&#x05D4;&#x05E1;&#x05E4;&#x05E7;")'}</p>
<p style="text-align:${ta};margin-bottom:10pt;">${en ? 'Second party;' : '&#x05DE;&#x05E6;&#x05D3; &#x05E9;&#x05E0;&#x05D9;;'}</p>

<p>${t('whereas1')}</p>
<p>${t('whereas2')}</p>
<p style="margin-bottom:8pt;">${t('therefore')}</p>
<p style="margin-bottom:10pt;">${t('preamble')}</p>

<h3>1. ${en ? 'The Event:' : '&#x05D4;&#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2;:'}</h3>
<p>${en ? `Event date: ${esc(eventDateDisplay)}` : `&#x05EA;&#x05D0;&#x05E8;&#x05D9;&#x05DA; &#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2;: ${esc(eventDateDisplay)}`}</p>
<p>${en ? 'Venue: Sharabiya, 3 Rabbi Pinchas Ben Yair St., Tel Aviv&#8211;Yafo' : '&#x05D0;&#x05D5;&#x05DC;&#x05DD; &#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2;&#x05D9;&#x05DD;: &#x05E9;&#x05E8;&#x05D1;&#x05D9;&#x05D9;&#x05D4; &#x05D1;&#x05E8;&#x05D7;&#x05D5;&#x05D1; &#x05E8;&#x05D1;&#x05D9; &#x05E4;&#x05E0;&#x05D7;&#x05E1; &#x05D1;&#x05DF; &#x05D9;&#x05D0;&#x05D9;&#x05E8; 3 &#x05EA;&#x05DC; -&#x05D0;&#x05D1;&#x05D9;&#x05D1; &#x05D9;&#x05E4;&#x05D5;'}</p>
<p>${en ? `Start time: ${esc(startTime)}` : `&#x05E9;&#x05E2;&#x05EA; &#x05D4;&#x05EA;&#x05D7;&#x05DC;&#x05D4;: ${esc(startTime)}`}</p>
<p>${en ? `End time: ${esc(endTime)}` : `&#x05E9;&#x05E2;&#x05EA; &#x05E1;&#x05D9;&#x05D5;&#x05DD; &#x05D4;&#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2;: ${esc(endTime)}`}</p>

${tArr('eventExtraLines').map(l => (l && l.trim()) ? `<p>${esc(l)}</p>` : '').join('\n')}
<h3>2. ${en ? 'Costs:' : '&#x05E2;&#x05DC;&#x05D5;&#x05D9;&#x05D5;&#x05EA;:'}</h3>
${isPackage ? `
<p>${en
  ? `Package cost for ${esc(String(packageGuests || ''))} guests - ${money(packageTotal)} incl. VAT`
  : `&#x05E2;&#x05DC;&#x05D5;&#x05EA; &#x05D4;&#x05D7;&#x05D1;&#x05D9;&#x05DC;&#x05D4; &#x05E2;&#x05D1;&#x05D5;&#x05E8; ${esc(String(packageGuests || ''))} &#x05D0;&#x05D5;&#x05E8;&#x05D7;&#x05D9;&#x05DD; - ${money(packageTotal)} &#x05DB;&#x05D5;&#x05DC;&#x05DC; &#x05DE;&#x05E2;"&#x05DE;`}</p>
${packageExtraGuestPrice && Number(packageExtraGuestPrice) > 0
  ? `<p>${en
      ? `Each additional guest above ${esc(String(packageGuests || ''))} guests at ${money(packageExtraGuestPrice)} incl. VAT`
      : `&#x05DB;&#x05DC; &#x05D0;&#x05D5;&#x05E8;&#x05D7; &#x05E0;&#x05D5;&#x05E1;&#x05E3; &#x05DE;&#x05E2;&#x05DC; ${esc(String(packageGuests || ''))} &#x05D0;&#x05D5;&#x05E8;&#x05D7;&#x05D9;&#x05DD; &#x05D1;&#x05EA;&#x05D5;&#x05E1;&#x05E4;&#x05EA; &#x05E9;&#x05DC; ${money(packageExtraGuestPrice)} &#x05DB;&#x05D5;&#x05DC;&#x05DC; &#x05DE;&#x05E2;"&#x05DE;`}</p>`
  : ''}
` : `
<table style="margin-bottom:6pt;">
  <thead>
    <tr>
      <th style="border:1px solid #ccc;padding:4px 6px;background:#f5f5f5;">${en ? 'Item' : '&#x05E9;&#x05DD; &#x05D4;&#x05E4;&#x05E8;&#x05D9;&#x05D8;'}</th>
      <th style="border:1px solid #ccc;padding:4px 6px;background:#f5f5f5;">${en ? 'Description' : '&#x05EA;&#x05D9;&#x05D0;&#x05D5;&#x05E8;'}</th>
      <th style="border:1px solid #ccc;padding:4px 6px;background:#f5f5f5;text-align:center;">${en ? 'Qty' : '&#x05DB;&#x05DE;&#x05D5;&#x05EA;'}</th>
      <th style="border:1px solid #ccc;padding:4px 6px;background:#f5f5f5;text-align:center;">${en ? 'Price' : '&#x05DE;&#x05D7;&#x05D9;&#x05E8;'}</th>
      <th style="border:1px solid #ccc;padding:4px 6px;background:#f5f5f5;text-align:center;">${en ? 'Total before VAT' : '&#x202B;&#x05E1;&#x05D4;"&#x05DB; &#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05DE;&#x05E2;"&#x05DE;&#x202C;'}</th>
    </tr>
  </thead>
  <tbody>
    ${dataRowsHtml}
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${ta};font-weight:bold;">${en ? 'Total subject to VAT:' : '&#x202B;&#x05E1;&#x05D4;"&#x05DB; &#x05D7;&#x05D9;&#x05D9;&#x05D1; &#x05D1;&#x05DE;&#x05E2;"&#x05DE;:&#x202C;'}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;font-weight:bold;">${money(subtotal)}</td>
    </tr>
    <tr>
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${ta};">${en ? 'VAT (18%):' : '&#x202B;&#x05DE;&#x05E2;"&#x05DE; (18%):&#x202C;'}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${money(vat)}</td>
    </tr>
    <tr style="font-weight:bold;">
      <td colspan="4" style="border:1px solid #ccc;padding:4px 6px;text-align:${ta};">${en ? 'Total to pay:' : '&#x202B;&#x05E1;&#x05D4;"&#x05DB; &#x05DC;&#x05EA;&#x05E9;&#x05DC;&#x05D5;&#x05DD;:&#x202C;'}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;">${money(total)}</td>
    </tr>
  </tbody>
</table>

<p>${en
  ? `This agreement is for holding an event with a minimum of ${esc(String(guests || ''))} guests`
  : `&#x05D4;&#x05E1;&#x05DB;&#x05DD; &#x05D6;&#x05D4; &#x05E2;&#x05D1;&#x05D5;&#x05E8; &#x05E7;&#x05D9;&#x05D5;&#x05DD; &#x05D0;&#x05D9;&#x05E8;&#x05D5;&#x05E2; &#x05E2;&#x05DD; &#x05DE;&#x05D9;&#x05E0;&#x05D9;&#x05DE;&#x05D5;&#x05DD; ${esc(String(guests || ''))} &#x05D0;&#x05D5;&#x05E8;&#x05D7;&#x05D9;&#x05DD;`}</p>
${extraGuestPrice && Number(extraGuestPrice) > 0
  ? `<p>${en
      ? `Each guest above ${esc(String(guests || ''))} guests at a cost of ${money(extraGuestPrice)} excl. VAT`
      : `&#x05DB;&#x05DC; &#x05D0;&#x05D5;&#x05E8;&#x05D7; &#x05DE;&#x05E2;&#x05DC; ${esc(String(guests || ''))} &#x05D0;&#x05D5;&#x05E8;&#x05D7;&#x05D9;&#x05DD; &#x05D1;&#x05E2;&#x05DC;&#x05D5;&#x05EA; &#x05E9;&#x05DC; ${money(extraGuestPrice)} &#x05DC;&#x05D0; &#x05DB;&#x05D5;&#x05DC;&#x05DC; &#x05DE;&#x05E2;"&#x05DE;`}</p>`
  : ''}
`}
${tArr('costExtraLines').map(l => (l && l.trim()) ? `<p>${esc(l)}</p>` : '').join('\n')}

<h3>3. ${t('includesHeader')}</h3>
<ul>
  ${(() => {
    const includes = tArr('includes');
    // Anchor the popup menu texts to their bullet by content, not position — the
    // list is editable and may come from a price offer with a different layout.
    const chefIdx = includes.findIndex(x => /תפריט שף|chef menu/i.test(x || ''));
    const barIdx  = includes.findIndex(x => /תפריט בר|bar menu/i.test(x || ''));
    let n = 0; // sub-clause counter — counts only rendered (non-empty) items
    return includes.map((item, i) => {
      let text = item;
      if (i === chefIdx && fields.chefMenu && !item.includes(fields.chefMenu)) text += ' ' + fields.chefMenu;
      if (i === barIdx  && fields.barMenu  && !item.includes(fields.barMenu))  text += ' ' + fields.barMenu;
      if (!text.trim()) return '';
      n += 1;
      return `<li>3.${n} ${esc(text)}</li>`;
    }).join('\n  ');
  })()}
</ul>

<h3>4. ${t('paymentHeader')}</h3>
<p>${t('depositLine')} <strong>${texts.depositAmtLabel != null ? esc(texts.depositAmtLabel) : money(depositAmount)} ${texts.depositPctLabel != null ? esc(texts.depositPctLabel) : `(${esc(String(depositPercent))}%)`}</strong> ${t('depositSuffix')} <strong>${texts.depositAmtVatLabel != null ? esc(texts.depositAmtVatLabel) : money(depositAmountVat)}</strong></p>
${texts.finalSettlementIntro ? `
<p>${t('finalSettlementIntro')}</p>
<p>${t('securityCheckPre')} <strong>${texts.remainderAmtLabel ? esc(texts.remainderAmtLabel) : money(remainingBalance)}</strong> ${t('securityCheckSuf')}</p>
<p>${t('reserveCheckPre')} <strong>${texts.reserveAmtLabel ? esc(texts.reserveAmtLabel) : money(Math.round(total * 0.1))}</strong> ${t('reserveCheckSuf')}</p>
<p>${t('checksUsageNote')}</p>
` : `
<p>${t('remainderLine')} <strong>${money(remainingBalance)} ${t('remainderSuffix')}</strong></p>
<p>${t('checkNote')}</p>
`}
<p>${t('paymentNote')}</p>
${tArr('paymentExtras').map(l => (l && l.trim()) ? `<p>${esc(l)}</p>` : '').join('\n')}

<h3>5. ${t('cancellationHeader')}</h3>
<ul>
  ${tArr('cancellationItems').map((item, i) =>
    i === 0
      ? `<li>5.${i + 1} ${esc(item)} <strong>${texts.cancellationDateLabel ? esc(texts.cancellationDateLabel) : esc(cancellationDate)}</strong></li>`
      : `<li>5.${i + 1} ${esc(item)}</li>`
  ).join('\n  ')}
</ul>

<h3>6. ${t('obligationsHeader')}</h3>
<ul>
  ${tArr('obligations').map((item, i) => `<li>6.${i + 1} ${esc(item)}</li>`).join('\n  ')}
</ul>

${tArr('legalParagraphs').map((p, i) => `<p style="${i === 0 ? 'margin-top:8pt;' : ''}">${esc(p)}</p>`).join('\n')}

<p style="margin-top:12pt;font-weight:bold;">${en ? 'In witness whereof the parties have signed:' : '&#x05DC;&#x05E8;&#x05D0;&#x05D9;&#x05D4; &#x05D1;&#x05D0;&#x05D5; &#x05D4;&#x05E6;&#x05D3;&#x05D3;&#x05D9;&#x05DD; &#x05E2;&#x05DC; &#x05D4;&#x05D7;&#x05EA;&#x05D5;&#x05DD;:'}</p>
<p>${en ? `Orderer name: ${ordererName}` : `&#x202B;&#x05E9;&#x05DD; &#x05D4;&#x05DE;&#x05D6;&#x05DE;&#x05D9;&#x05DF;:&#x202C; ${ordererName}`}</p>
<p>${en ? `Signer name: ${signerName}` : `&#x202B;&#x05E9;&#x05DD; &#x05D4;&#x05D7;&#x05D5;&#x05EA;&#x05DD;:&#x202C; ${signerName}`}</p>

<table style="width:100%;margin-top:20pt;">
  <tr>
    <td style="width:50%;text-align:center;vertical-align:bottom;padding:8pt;">
      ${customerSigHtml}
      <div style="border-top:1px solid #333;padding-top:4pt;margin-top:4pt;">${en ? 'The Orderer' : '&#x05D4;&#x05DE;&#x05D6;&#x05DE;&#x05D9;&#x05DF;'}</div>
    </td>
    <td style="width:50%;text-align:center;vertical-align:bottom;padding:8pt;">
      ${staffSigHtml}
      <div style="border-top:1px solid #333;padding-top:4pt;margin-top:4pt;">${en ? 'The Vendor' : '&#x05D4;&#x05E1;&#x05E4;&#x05E7;'}</div>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ── Lead-scoped router (protected, mergeParams gets :id) ──────────────────────
const contractLeadRouter = require('express').Router({ mergeParams: true });

contractLeadRouter.get('/latest', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { type } = req.query;
    // type is optional: when omitted, return the latest contract of ANY type
    // (import now precedes type selection; the response carries offerType).
    const params = [leadId];
    let typeClause = '';
    if (type) { typeClause = " AND contract_data->>'offerType' = $2"; params.push(type); }
    const { rows } = await pool.query(
      `SELECT contract_data FROM contracts
       WHERE lead_id = $1${typeClause}
       ORDER BY created_at DESC LIMIT 1`,
      params
    );
    res.json(rows[0]?.contract_data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

contractLeadRouter.post('/', async (req, res) => {
  try {
    const { contract_data, sent_via, whatsapp_phone } = req.body;
    // A lead can have several contact people — whatsapp_phone may arrive as an
    // array or a comma-separated list and is stored as a comma-separated list.
    const waPhoneList = (Array.isArray(whatsapp_phone) ? whatsapp_phone : String(whatsapp_phone || '').split(','))
      .map(x => String(x).trim()).filter(Boolean).join(',') || null;
    if (!contract_data) return res.status(400).json({ error: 'contract_data required' });
    const download = !!req.body.download;

    const token = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO contracts (lead_id, token, contract_data, created_by, sent_via, whatsapp_phone)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, token`,
      [req.params.id, token, JSON.stringify(contract_data), req.user.id, sent_via || null, waPhoneList]
    );

    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1,'note','outbound',$2,$3)`,
      [req.params.id, download ? 'חוזה נוצר והורד (ללא שליחה)' : 'חוזה נשלח לחתימה', req.user.id]
    );

    const leadId = req.params.id;
    const userId = req.user.id;
    const contractDataCopy = contract_data;

    // Generates the unsigned PDF, saves it to the lead's files, returns the buffer + filename
    async function generateUnsignedPdf() {
      let browser;
      try {
        const { rows: lr } = await pool.query('SELECT name FROM leads WHERE id=$1', [leadId]);
        if (!lr[0]) return null;
        const html = buildContractHtml({ contractData: contractDataCopy, signingData: null, staffSignature: null });
        browser = await puppeteer.launch({
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          headless: true,
        });
        const page = await browser.newPage();
        page.setDefaultTimeout(25000);
        await page.setContent(html, { waitUntil: 'load' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
        await browser.close();
        browser = null;
        const filename = `חוזה ${lr[0].name}.pdf`;
        const { url, storedName } = await uploadBuffer(pdfBuffer, filename, 'application/pdf');
        await pool.query(
          'INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [leadId, filename, url, storedName, 'contract', userId]
        );
        console.log('[Contracts] unsigned PDF saved for lead', leadId);
        return { pdfBuffer, filename };
      } catch (err) {
        if (browser) await browser.close().catch(() => {});
        console.error('[Contracts] unsigned PDF error:', err.message);
        return null;
      }
    }

    if (download) {
      // Download-only: generate inline and stream the PDF back
      const result = await generateUnsignedPdf();
      if (!result) return res.status(500).json({ error: 'PDF generation failed' });
      const safeName = encodeURIComponent(result.filename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="contract.pdf"; filename*=UTF-8''${safeName}`);
      return res.send(result.pdfBuffer);
    }

    res.json({ id: rows[0].id, token: rows[0].token });
    // Background: generate unsigned PDF and save to lead files
    setImmediate(generateUnsignedPdf);
  } catch (err) {
    console.error('[Contracts] create error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Public router (no auth) ───────────────────────────────────────────────────
const contractPublicRouter = require('express').Router();

contractPublicRouter.get('/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, l.name as lead_name, l.phone as lead_phone, l.email as lead_email
       FROM contracts c JOIN leads l ON l.id = c.lead_id
       WHERE c.token=$1`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'חוזה לא נמצא' });
    const c = rows[0];
    if (c.status === 'signed') return res.status(410).json({ error: 'החוזה כבר נחתם', signed: true });
    res.json({ contract_data: c.contract_data, lead_name: c.lead_name, status: c.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

contractPublicRouter.post('/:token/sign', async (req, res) => {
  let browser;
  try {
    const { ordererName, signerName, signerIdNumber, signingDate, signatureImage } = req.body;
    if (!ordererName || !signerName || !signerIdNumber || !signingDate || !signatureImage) {
      return res.status(400).json({ error: 'כל שדות החתימה נדרשים' });
    }

    const { rows } = await pool.query(
      `SELECT c.*, l.phone as lead_phone, l.email as lead_email,
              l.name as lead_name, l.event_date as lead_event_date
       FROM contracts c JOIN leads l ON l.id = c.lead_id
       WHERE c.token=$1 AND c.status='pending'`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(410).json({ error: 'החוזה כבר נחתם או שהקישור אינו תקף' });
    const contract = rows[0];

    const settingsRes = await pool.query(`SELECT value FROM settings WHERE key='staff_signature'`);
    const staffSignature = settingsRes.rows[0]?.value || '';

    const html = buildContractHtml({
      contractData: contract.contract_data,
      signingData: { ordererName, signerName, signerIdNumber, signingDate, signatureImage },
      staffSignature,
    });

    browser = await Promise.race([
      puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF timeout')), 30000)),
    ]);
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    await browser.close();
    browser = null;

    const _ed = contract.lead_event_date ? new Date(contract.lead_event_date) : null;
    const dateSuffix = _ed ? `${_ed.getDate()}.${_ed.getMonth()+1}.${String(_ed.getFullYear()).slice(2)}` : '';
    const filename = `חוזה חתום ${contract.lead_name}${dateSuffix ? ` ${dateSuffix}` : ''}.pdf`;
    const { url: signedPdfUrl, storedName } = await uploadBuffer(pdfBuffer, filename, 'application/pdf');

    await pool.query(
      `INSERT INTO files (lead_id, filename, url, stored_name, file_type) VALUES ($1,$2,$3,$4,$5)`,
      [contract.lead_id, filename, signedPdfUrl, storedName, 'contract']
    );

    await pool.query(
      `UPDATE contracts SET status='signed', signed_at=NOW(), signer_name=$1, signer_id_number=$2,
       signature_image=$3, signed_pdf_url=$4, orderer_name=$5 WHERE id=$6`,
      [signerName, signerIdNumber, signatureImage, signedPdfUrl, ordererName, contract.id]
    );

    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1,'note','inbound',$2,NULL)`,
      [contract.lead_id, `החוזה נחתם על ידי ${ordererName} — חותם: ${signerName} (ת.ז: ${signerIdNumber})`]
    );

    // Send to Sharabiya
    try {
      await sendEmail({
        to: 'sharabiyajaffa@gmail.com',
        subject: `חוזה חתום — ${ordererName}`,
        body: `החוזה נחתם.\nמזמין: ${ordererName}\nחותם: ${signerName} (ת.ז: ${signerIdNumber})\nתאריך: ${signingDate}.`,
        attachmentBuffer: pdfBuffer,
        attachmentName: filename,
        attachmentMime: 'application/pdf',
      });
    } catch (e) { console.error('[Contracts] sharabiya email failed:', e.message); }

    // Send to customer — same message body for both channels
    // clientEmailExtra holds the additional contact people the contract was
    // emailed to; the signed copy goes back to all of them.
    const extraEmails = Array.isArray(contract.contract_data?.fields?.clientEmailExtra)
      ? contract.contract_data.fields.clientEmailExtra.filter(Boolean)
      : [];
    const clientEmail = contract.contract_data?.fields?.clientEmail || contract.lead_email;
    const clientEmailTo = [clientEmail, ...extraEmails].filter(Boolean).join(', ');
    const { rows: emailSettings } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('contract_email_body','contract_email_bank')`
    );
    const settingsMap  = Object.fromEntries(emailSettings.map(r => [r.key, r.value]));
    const customBody   = settingsMap.contract_email_body?.trim() || '';
    const bankDetails  = settingsMap.contract_email_bank?.trim() || '';
    const clientMessage = [
      `שלום ${ordererName},`,
      '',
      'תודה על החתימה! החוזה החתום מצורף.',
      ...(customBody   ? ['', customBody]               : []),
      ...(bankDetails  ? ['', 'פרטי תשלום:', bankDetails] : []),
      '',
      'בברכה, צוות שרביה',
    ].join('\n');

    if (clientEmail) {
      try {
        await sendEmail({
          to: clientEmailTo,
          subject: 'החוזה החתום שלך — שרביה',
          body: clientMessage,
          attachmentBuffer: pdfBuffer,
          attachmentName: filename,
          attachmentMime: 'application/pdf',
        });
      } catch (e) { console.error('[Contracts] client email failed:', e.message); }
    }

    // WhatsApp: when the contract was sent via WhatsApp — always; for contracts
    // created before sent_via existed — only as the no-email fallback (old behavior).
    // whatsapp_phone holds every recipient the contract was sent to (comma
    // separated) — the signed copy goes back to all of them, not just the first.
    const waTarget = contract.whatsapp_phone || contract.contract_data?.fields?.clientPhone || contract.lead_phone;
    const waPhones = [];
    for (const entry of String(waTarget || '').split(',')) {
      const digits = entry.replace(/\D/g, '').replace(/^0/, '972');
      if (digits && !waPhones.includes(digits)) waPhones.push(digits);
    }
    const shouldSendWa = contract.sent_via === 'whatsapp' || (!contract.sent_via && !clientEmail);
    if (shouldSendWa && waPhones.length) {
      try {
        const { GREEN_API_URL, GREEN_API_INSTANCE, GREEN_API_TOKEN } = process.env;
        if (GREEN_API_URL && GREEN_API_INSTANCE && GREEN_API_TOKEN) {
          // Bucket is private — Green API must fetch via a signed URL (the stored
          // public URL 404s). 1h expiry is ample; Green API downloads immediately.
          const waFileUrl = await getSignedUrl(storedName, 3600);
          for (const phone of waPhones) {
            try {
              await axios.post(
                `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}/sendFileByUrl/${GREEN_API_TOKEN}`,
                { chatId: `${phone}@c.us`, urlFile: waFileUrl, fileName: filename, caption: clientMessage },
                { timeout: 15000 }
              );
              await pool.query(
                `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value)
                 VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3)`,
                [contract.lead_id, `[חוזה חתום מצורף]\n${clientMessage}`, phone]
              );
            } catch (e) { console.error('[Contracts] WhatsApp send failed for', phone, e.message); }
          }
        }
      } catch (e) { console.error('[Contracts] WhatsApp send failed:', e.message); }
    }

    res.json({ success: true });

    // The event just closed — compute its cost lines from the AI cost model in
    // the background. Never overwrites existing (possibly hand-edited) lines.
    setImmediate(() => {
      generateEventCosts(contract.lead_id, null, { onlyIfEmpty: true })
        .then(r => { if (r) console.log('[Contracts] event costs generated for lead', contract.lead_id); })
        .catch(err => console.error('[Contracts] event cost generation failed:', err.message));
    });
  } catch (err) {
    console.error('[Contracts] sign error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'שגיאה בחתימה על החוזה' });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = { contractLeadRouter, contractPublicRouter };
