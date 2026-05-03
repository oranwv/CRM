const path = require('path');
const fs = require('fs');
const pdfmake = require('pdfmake');

pdfmake.setFonts({
  Alef: {
    normal:      path.join(__dirname, '../fonts/Alef-Regular.ttf'),
    bold:        path.join(__dirname, '../fonts/Alef-Bold.ttf'),
    italics:     path.join(__dirname, '../fonts/Alef-Regular.ttf'),
    bolditalics: path.join(__dirname, '../fonts/Alef-Bold.ttf'),
  },
});
pdfmake.setUrlAccessPolicy(() => false);

const router = require('express').Router({ mergeParams: true });

function fmt(n) {
  return Number(n || 0).toLocaleString('he-IL');
}

router.post('/', async (req, res) => {
  try {
    const { fields, rows, texts } = req.body;

    // Logo — embed as base64 from local file
    const logoPath = path.join(__dirname, '../../client/public/logo.jpg');
    let logoBlock = null;
    if (fs.existsSync(logoPath)) {
      const b64 = fs.readFileSync(logoPath).toString('base64');
      logoBlock = {
        image: `data:image/jpeg;base64,${b64}`,
        width: 150,
        alignment: 'center',
        margin: [0, 0, 0, 10],
      };
    }

    // Totals
    const subtotal = rows.reduce((s, r) => s + (r.qty * r.price), 0);
    const vat      = Math.round(subtotal * 0.18);
    const total    = subtotal + vat;

    // Header fields table (label | value)
    const headerRows = [
      { label: 'לכבוד',           value: fields.name,      ltr: false },
      { label: 'מייל',            value: fields.email,     ltr: true  },
      { label: 'טלפון',           value: fields.phone,     ltr: true  },
      { label: 'תאריך האירוע',    value: fields.eventDate, ltr: false },
      { label: 'שעת פתיחת דלתות', value: fields.doorTime,  ltr: false },
      { label: 'שעת סיום האירוע', value: fields.endTime,   ltr: false },
    ].filter(r => r.value);

    const headerTable = {
      table: {
        widths: ['auto', '*'],
        body: headerRows.map(({ label, value, ltr }) => [
          { text: label + ':', bold: true, alignment: 'right', noWrap: true, margin: [6, 0, 0, 2] },
          { text: value, alignment: ltr ? 'left' : 'right', margin: [0, 0, 0, 2] },
        ]),
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 8],
    };

    // Pricing table — columns reversed for RTL visual order:
    // visual right→left: שם הפריט | תיאור | כמות | מחיר | סה"כ
    // array  left→right: סה"כ     | מחיר  | כמות | תיאור | שם הפריט
    const reversedHeaders = [...texts.tableHeaders].reverse();
    const headerRow = reversedHeaders.map(h => ({
      text: h, alignment: 'center', bold: true, fillColor: '#f5f5f5',
    }));

    const dataRows = rows.map(r => [
      { text: fmt(r.qty * r.price) + ' ש"ח', alignment: 'center' },
      { text: fmt(r.price) + ' ש"ח',         alignment: 'center' },
      { text: String(r.qty),                  alignment: 'center' },
      { text: r.desc || '',  alignment: 'right', fontSize: 8, color: '#555' },
      { text: r.label,       alignment: 'right' },
    ]);

    // Summary rows: value in col 0 (total col), label spans cols 1–4
    const summaryRows = [
      [
        { text: fmt(subtotal) + ' ש"ח', alignment: 'center', bold: true },
        { text: 'סה"כ חייב במע"מ:', colSpan: 4, alignment: 'right', bold: true },
        {}, {}, {},
      ],
      [
        { text: fmt(vat) + ' ש"ח', alignment: 'center' },
        { text: 'מע"מ (18%):', colSpan: 4, alignment: 'right' },
        {}, {}, {},
      ],
      [
        { text: fmt(total) + ' ש"ח', alignment: 'center', bold: true },
        { text: 'סה"כ לתשלום:', colSpan: 4, alignment: 'right', bold: true },
        {}, {}, {},
      ],
    ];

    const pricingTable = {
      table: {
        widths: ['auto', 'auto', 'auto', '*', '*'],
        headerRows: 1,
        body: [headerRow, ...dataRows, ...summaryRows],
      },
      margin: [0, 0, 0, 10],
    };

    // Includes list (items 3 and 4 append chefMenu/barMenu)
    const includesItems = texts.includes.map((item, i) => {
      let text = '• ' + item;
      if (i === 3 && fields.chefMenu) text += ' ' + fields.chefMenu;
      if (i === 4 && fields.barMenu)  text += ' ' + fields.barMenu;
      return { text, alignment: 'right', margin: [0, 0, 0, 2] };
    });

    const extrasItems = texts.extras.map(item => ({
      text: '• ' + item, alignment: 'right', margin: [0, 0, 0, 2],
    }));

    const content = [
      ...(logoBlock ? [logoBlock] : []),
      { text: texts.title, fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 12] },
      headerTable,
      { text: texts.arrival, fontSize: 9, color: '#555', margin: [0, 8, 0, 0] },
      { text: texts.costsHeader, bold: true, fontSize: 11, margin: [0, 12, 0, 4] },
      pricingTable,
      {
        text: `${texts.minGuestsPrefix} ${fields.guests || ''} ${texts.minGuestsSuffix}`,
        margin: [0, 10, 0, 0],
      },
      { text: texts.includesHeader, bold: true, margin: [0, 8, 0, 2] },
      ...includesItems,
      { text: texts.extrasHeader, bold: true, margin: [0, 10, 0, 2] },
      ...extrasItems,
      ...(fields.notes
        ? [{ text: 'הערות: ' + fields.notes, margin: [0, 8, 0, 0] }]
        : []),
      { text: texts.payment,  fontSize: 9, color: '#555', margin: [0, 10, 0, 0] },
      { text: texts.validity, fontSize: 9, color: '#555' },
      { text: texts.closing,  bold: true, margin: [0, 6, 0, 0] },
    ];

    const docDefinition = {
      content,
      defaultStyle: { font: 'Alef', fontSize: 10, alignment: 'right' },
      pageSize: 'A4',
      pageMargins: [30, 30, 30, 30],
    };

    const doc = pdfmake.createPdf(docDefinition);
    const stream = await doc.getStream();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="price-offer-${fields.name || 'offer'}.pdf"`);
    stream.pipe(res);
    stream.end();
  } catch (err) {
    console.error('[PriceOffer PDF]', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

module.exports = router;
