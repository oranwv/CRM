import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '/api';

function fmt(n) { return Number(n || 0).toLocaleString('he-IL'); }

function ContractDisplay({ data }) {
  const { fields, rows, calculated, texts } = data;
  const isPackage = (data.offerType || 'regular') === 'package';
  const { clientName, eventDate, startTime, endTime, guests, extraGuestPrice, chefMenu, barMenu, depositPercent,
          packageGuests, packageTotal, packageExtraGuestPrice } = fields;
  const { subtotal, vat, total, depositAmount, depositAmountVat, remainingBalance, cancellationDate } = calculated;

  const tableWrapRef = useRef(null);
  const [scrollHint, setScrollHint] = useState(false);

  useEffect(() => {
    const el = tableWrapRef.current;
    if (el && el.scrollWidth > el.clientWidth) setScrollHint(true);
  }, []);

  const eventDateDisplay = eventDate
    ? new Date(eventDate + 'T12:00:00').toLocaleDateString('he-IL')
    : '';

  return (
    <div className="text-sm leading-7 text-slate-800 space-y-3" dir="rtl">
      <p>שנערך ונחתם ביום ______________ לאירוע בתאריך {eventDateDisplay}</p>
      <p>בין: _______________ &nbsp;&nbsp; ת.ז/ח.פ: __________________</p>
      <p>(ביחד ולחוד להלן: "המזמין")</p>
      <p className="text-left">מצד אחד;</p>
      <p>לבין:<br />שרביה, מספר שותפות 558450383<br />מרח' שמעון הצדיק 18 תל אביב.<br />(להלן: "הספק")</p>
      <p className="text-left">מצד שני;</p>

      <p>{texts?.whereas1 || 'הואיל: הספק הינו המחזיק הבלעדי והמפעיל של מתחם אירועים "שרבייה" הנמצא בישוב תל אביב- יפו (להלן: "אולם אירועים");'}</p>
      <p>{texts?.whereas2 || 'והואיל: וברצון המזמין להזמין מאת הספק שירותיו והכל כפי שיפורט בהסכם זה;'}</p>
      <p>{texts?.therefore || 'לפיכך הוסכם והותנה בין הצדדים:'}</p>
      <p>{texts?.preamble || 'המבוא להסכם זה וכל הנספחים, בין המצורפים במועד חתימת הסכם זה ובין שיצורפו אליו בעתיד, מהווים חלק בלתי נפרד הימנו.'}</p>

      <div>
        <p className="font-bold">האירוע:</p>
        <p>תאריך אירוע: {eventDateDisplay}</p>
        <p>אולם אירועים: שרבייה ברחוב רבי פנחס בן יאיר 3 תל -אביב יפו</p>
        <p>שעת התחלה: {startTime}</p>
        <p>שעת סיום האירוע: {endTime}</p>
        {(texts?.eventExtraLines || []).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      <div>
        <p className="font-bold">עלויות:</p>
        {isPackage ? (
          <div className="space-y-1">
            <p>עלות החבילה עבור {packageGuests} אורחים - {fmt(packageTotal)} ש"ח כולל מע"מ</p>
            {Number(packageExtraGuestPrice) > 0 && (
              <p>כל אורח נוסף מעל {packageGuests} אורחים בתוספת של {fmt(packageExtraGuestPrice)} ש"ח כולל מע"מ</p>
            )}
          </div>
        ) : (
          <>
          <div className="relative">
            <div ref={tableWrapRef} className="overflow-x-auto" onScroll={() => setScrollHint(false)}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 p-1.5">שם הפריט</th>
                  <th className="border border-slate-300 p-1.5">תיאור</th>
                  <th className="border border-slate-300 p-1.5 text-center">כמות</th>
                  <th className="border border-slate-300 p-1.5 text-center">מחיר</th>
                  <th className="border border-slate-300 p-1.5 text-center">סה"כ</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const fixedSubtotal = (rows || []).filter(r => !r.isPct).reduce((s, r) => s + (r.qty||0)*(r.price||0), 0);
                  return (rows || []).map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 p-1.5">{r.label}</td>
                    <td className="border border-slate-300 p-1.5 text-slate-500">{r.desc || ''}</td>
                    <td className="border border-slate-300 p-1.5 text-center">{r.isPct ? '-' : r.qty}</td>
                    <td className="border border-slate-300 p-1.5 text-center">{r.isPct ? `${r.pct||0}%` : `${fmt(r.price)} ש"ח`}</td>
                    <td className="border border-slate-300 p-1.5 text-center">{fmt(r.isPct ? Math.round(fixedSubtotal*(r.pct||0)/100) : (r.qty||0)*(r.price||0))} ש"ח</td>
                  </tr>
                  ));
                })()}
                <tr><td colSpan={4} className="border border-slate-300 p-1.5 font-bold text-left">סה"כ חייב במע"מ:</td><td className="border border-slate-300 p-1.5 text-center font-bold">{fmt(subtotal)} ש"ח</td></tr>
                <tr><td colSpan={4} className="border border-slate-300 p-1.5 text-left">מע"מ (18%):</td><td className="border border-slate-300 p-1.5 text-center">{fmt(vat)} ש"ח</td></tr>
                <tr><td colSpan={4} className="border border-slate-300 p-1.5 font-bold text-left">סה"כ לתשלום:</td><td className="border border-slate-300 p-1.5 text-center font-bold">{fmt(total)} ש"ח</td></tr>
              </tbody>
            </table>
            </div>
            {scrollHint && (
              <div className="absolute top-0 left-0 bottom-0 w-10 bg-gradient-to-r from-white to-transparent pointer-events-none rounded-l" />
            )}
            {scrollHint && (
              <p className="text-xs text-slate-400 mt-1 text-left">← גלול לצפייה בטבלה</p>
            )}
          </div>
          <p className="mt-2">הסכם זה עבור קיום אירוע עם מינימום {guests} אורחים</p>
          {extraGuestPrice && Number(extraGuestPrice) > 0 && (
            <p>כל אורח מעל {guests} אורחים בעלות של {Number(extraGuestPrice).toLocaleString()} ש"ח לא כולל מע"מ</p>
          )}
          </>
        )}
        {(texts?.costExtraLines || []).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      <div>
        <p className="font-bold">{texts?.includesHeader || 'המחיר כולל בתוכו:'}</p>
        <ul className="list-disc pr-5 space-y-0.5">
          {(texts?.includes || []).map((item, i) => {
            let text = item;
            if (i === 5 && chefMenu) text += ' ' + chefMenu;
            if (i === 6 && barMenu)  text += ' ' + barMenu;
            if (!text.trim()) return null;
            return <li key={i}>{text}</li>;
          })}
        </ul>
      </div>

      <div>
        <p className="font-bold">{texts?.paymentHeader || 'תנאי תשלום:'}</p>
        <p>
          {texts?.depositLine || 'במעמד חתימת הסכם זה תינתן מקדמה על-סך'}{' '}
          <strong>{fmt(depositAmount)} ש"ח ({depositPercent}%)</strong>{' '}
          {texts?.depositSuffix || 'לא כולל מע"מ. סה"כ כולל מע"מ'}{' '}
          <strong>{fmt(depositAmountVat)} ש"ח</strong>
        </p>
        {texts?.finalSettlementIntro ? (
          <>
            <p>{texts.finalSettlementIntro}</p>
            <p>
              {texts.securityCheckPre}{' '}
              <strong>{texts.remainderAmtLabel || `${fmt(remainingBalance)} ש"ח`}</strong>{' '}
              {texts.securityCheckSuf}
            </p>
            <p>
              {texts.reserveCheckPre}{' '}
              <strong>{texts.reserveAmtLabel || `${fmt(Math.round(total * 0.1))} ש"ח`}</strong>{' '}
              {texts.reserveCheckSuf}
            </p>
            <p>{texts.checksUsageNote}</p>
          </>
        ) : (
          <>
            <p>
              {texts?.remainderLine || 'ביום האירוע, לפני תחילת האירוע יש לשלם את יתרת הסכום על סך'}{' '}
              <strong>{fmt(remainingBalance)} ש"ח {texts?.remainderSuffix || 'כולל מע"מ'}</strong>
            </p>
            <p>{texts?.checkNote || "לחלופין - ניתן להביא צ'ק ביטחון של הסכום הנ\"ל בתחילת האירוע."}</p>
          </>
        )}
        <p>{texts?.paymentNote || 'חשוב לציין כי ללא הנ"ל מנהל האירוע לא יתחיל ויקיים את האירוע!'}</p>
        {(texts?.paymentExtras || []).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      <div>
        <p className="font-bold">{texts?.cancellationHeader || 'ביטול האירוע:'}</p>
        <ul className="list-disc pr-5 space-y-0.5">
          {(texts?.cancellationItems || [
            'במקרה של אי אישור לעריכת אירועים של פיקוד העורף/כוח עליון שאינו מאפשר לקיים את האירוע — הסכימו הצדדים על דחיית מועד האירוע למועד אחר עד לתאריך',
            'במקרה של ביטול תוך פחות מחודשיים ממועד האירוע – יחויב המזמין בדמי ביטול של 50% מהסכום הכולל.',
            'במקרה של ביטול תוך פחות מחודש ועד שבוע ממועד האירוע – יחויב המזמין בדמי ביטול של 75% מהסכום הכולל.',
            'במקרה של ביטול תוך פחות משבוע ממועד האירוע – יחויב המזמין בדמי ביטול מלאים.',
          ]).map((item, i) => (
            <li key={i}>
              {item}
              {i === 0 && cancellationDate ? <strong> {cancellationDate}</strong> : null}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="font-bold">{texts?.obligationsHeader || 'התחייבויות והצהרות הצדדים:'}</p>
        <ul className="list-disc pr-5 space-y-0.5 text-xs leading-6">
          {(texts?.obligations || [
            'האולם על חלקיו ישמש ללקוח לקיום האירוע. הספק מתחייב לאפשר למזמין עריכת האירוע באולם ובמועד כפי שפורטו לעיל.',
            'הספק יעמיד את האולם לרשות המזמין כשהוא נקי, ומסודר.',
            'המזמין מצהיר כי הובאו לידיעתו שעות בהן מתקיימים האירועים והוא מסכים לכך, כי האירוע יתקיים בין שעות הפעילות המפורטות לעיל בלבד.',
            'המזמין מצהיר כי הינו אחראי הבלעדי למעשיו ו/או למעשי נותני השירות שהוזמנו על ידו, למעט נותני השירות המפורטים ברשימת המומלצים של הספק.',
            'בנוסף המזמין אחראי על פי דין למעשי אורחיו וכי הוא יפצה את הספק לאחר פסק דין חלוט בגין כל נזק שיגרם ממעשה ו/או ממחדל של כל אחד מהנ"ל.',
            'מובהר בזאת, כי הספק אינו אחראי על שום ציוד ו/או חפצים אישיים, אשר נשכחו על ידי מי מטעם המזמין במתחם האולם.',
            'ידוע למזמין כי לא ניתן להשתמש בזיקוקים מכל סוג שהוא בכל שטח האתר, לרבות בחניה וכן לא ניתן להשתמש בקישוטים מתפזרים כדוגמת קונפטי וכדומה.',
            'עוצמת המוזיקה המתנגנת באירוע לא תעלה על המותר בחוק.',
            'המזמין יודע, מסכים, מאשר ומבין כי באולם האירועים יש הוראה חד משמעית כי אסור לעשן בתוכו בהתאם לחוק איסור עישון במקומות ציבוריים וכי יש בגן פינות עישון מיועדת לכך.',
            'באחריות הלקוח לשלם לאקו"ם באתר הבית.',
          ]).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>

      {(texts?.legalParagraphs || [
        'למען הסר ספק, אם לא התייצב המזמין לביצוע התחשבנות כאמור בסעיף זה, יהא רשאי הספק לפעול בכל הדרכים הנתונות לו על פי החוק והדין לשם גביית סכום האירוע.',
        'המזמין עיין ובדק את מלוא התנאים המצוינים בהסכם זה והוא הסכים לכל סעיפיו. כל שינוי, תוספת או גריעה מהסכם זה, לא יהיה להם כל תוקף או נפקות, אלא אם כן נעשו בכתב ונחתמו ע"י שני הצדדים להסכם זה.',
        'הצדדים מצהירים במפורש כי אין בהסכם זה כדי ליצור בין הצדדים יחסי סוכנות ו/או שליחות ו/או שותפות מכל מין וסוג שהוא.',
        'שום ויתור, הנחה, היימנעות מפעולה בזמנה, או מתן ארכה, לא יחשבו כוויתור של צד מהצדדים להסכם זה על זכות מזכויותיו.',
      ]).map((para, i) => (
        <p key={i} className="text-xs">{para}</p>
      ))}
    </div>
  );
}

function SignatureCanvas({ onChange }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const lastPos   = useRef(null);

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const src    = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    lastPos.current = getPos(e);
  }

  function draw(e) {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const pos    = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    lastPos.current = pos;
    onChange(canvas.toDataURL('image/png'));
  }

  function stop(e) {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500} height={140}
        className="w-full border border-slate-300 rounded-xl bg-white touch-none cursor-crosshair"
        style={{ maxWidth: '100%' }}
        onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchMove={draw} onTouchEnd={stop}
      />
      <button type="button" onClick={clear}
        className="mt-1 text-xs text-slate-500 hover:text-red-500 underline">
        נקה חתימה
      </button>
    </div>
  );
}

export default function SignaturePage() {
  const { token } = useParams();
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [contractData, setContractData] = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [ordererName, setOrdererName] = useState('');
  const [signerName, setSignerName]   = useState('');
  const [signerIdNumber, setSignerIdNumber] = useState('');
  const [signingDate, setSigningDate] = useState('');
  const [signatureImage, setSignatureImage] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);

  useEffect(() => {
    fetch(`${API}/contracts/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); }
        else { setContractData(data.contract_data); }
      })
      .catch(() => setError('שגיאה בטעינת החוזה'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSign(e) {
    e.preventDefault();
    if (!ordererName.trim())    return alert('יש להזין שם מזמין');
    if (!signerName.trim())     return alert('יש להזין שם חותם');
    if (!signerIdNumber.trim()) return alert('יש להזין מספר ת.ז / ח.פ');
    if (!signingDate)           return alert('יש להזין תאריך חתימה');
    if (!signatureImage)        return alert('יש לחתום בתיבת החתימה');

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/contracts/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordererName, signerName, signerIdNumber, signingDate, signatureImage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setDone(true);
    } catch (err) {
      alert('שגיאה בחתימה: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
        <p className="text-slate-500 animate-pulse">טוען חוזה...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-2xl mb-3">📄</p>
          <p className="font-bold text-slate-800 mb-1">הקישור אינו תקף</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-4xl mb-4">✅</p>
          <p className="font-bold text-xl text-slate-800 mb-2">החוזה נחתם בהצלחה!</p>
          <p className="text-sm text-slate-500">עותק נשלח לכתובת המייל שלך (אם קיימת). תודה על שיתוף הפעולה — צוות שרביה.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h1 className="text-xl font-black text-slate-800 mb-1 text-center">הסכם הזמנת אירוע</h1>
          <p className="text-xs text-center text-slate-400 mb-6">קרא את ההסכם בעיון לפני החתימה</p>
          <ContractDisplay data={contractData} />
        </div>

        {!showForm ? (
          <div className="text-center pb-8">
            <button
              onClick={() => setShowForm(true)}
              className="px-8 py-3 rounded-2xl font-black text-white text-base shadow-lg"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              חתום על החוזה
            </button>
          </div>
        ) : (
          <form onSubmit={handleSign} className="bg-white rounded-2xl shadow-sm p-6 space-y-4 pb-8">
            <h2 className="font-black text-slate-800 text-lg mb-2">פרטי החתימה</h2>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">תאריך חתימה</label>
              <input type="date" value={signingDate} onChange={e => setSigningDate(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:border-violet-400 focus:outline-none"
                required />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">שם המזמין / שם החברה</label>
              <input type="text" value={ordererName} onChange={e => setOrdererName(e.target.value)}
                placeholder="שם הלקוח או שם החברה המזמינה"
                className="w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:border-violet-400 focus:outline-none"
                required />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">שם החותם</label>
              <input type="text" value={signerName} onChange={e => setSignerName(e.target.value)}
                placeholder="שם הנציג המורשה לחתימה"
                className="w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:border-violet-400 focus:outline-none"
                required />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">ת.ז / ח.פ</label>
              <input type="text" value={signerIdNumber} onChange={e => setSignerIdNumber(e.target.value)}
                placeholder="מספר תעודת זהות או חברה"
                className="w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:border-violet-400 focus:outline-none"
                required />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">חתימה</label>
              <p className="text-xs text-slate-400 mb-2">חתום בתיבה למטה עם האצבע או העכבר</p>
              <SignatureCanvas onChange={setSignatureImage} />
            </div>

            <button type="submit" disabled={submitting}
              className="w-full py-3 rounded-2xl font-black text-white text-base disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              {submitting ? 'שולח...' : 'אשר וחתום'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
