import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '/api';

function fmt(n) { return Number(n || 0).toLocaleString('he-IL'); }

function ContractDisplay({ data }) {
  const { fields, rows, calculated } = data;
  const { clientName, eventDate, startTime, endTime, guests, extraGuestPrice, chefMenu, barMenu, depositPercent } = fields;
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

      <p><strong>הואיל:</strong> הספק הינו המחזיק הבלעדי והמפעיל של מתחם אירועים "שרבייה" הנמצא בישוב תל אביב- יפו (להלן: "אולם אירועים");</p>
      <p><strong>והואיל:</strong> וברצון המזמין להזמין מאת הספק שירותיו והכל כפי שיפורט בהסכם זה;</p>
      <p>לפיכך הוסכם והותנה בין הצדדים:</p>
      <p>המבוא להסכם זה וכל הנספחים, בין המצורפים במועד חתימת הסכם זה ובין שיצורפו אליו בעתיד, מהווים חלק בלתי נפרד הימנו.</p>

      <div>
        <p className="font-bold">האירוע:</p>
        <p>תאריך אירוע: {eventDateDisplay}</p>
        <p>אולם אירועים: שרבייה ברחוב רבי פנחס בן יאיר 3 תל -אביב יפו</p>
        <p>שעת התחלה: {startTime}</p>
        <p>שעת סיום האירוע: {endTime}</p>
      </div>

      <div>
        <p className="font-bold">עלויות:</p>
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
              {(rows || []).map((r, i) => (
                <tr key={i}>
                  <td className="border border-slate-300 p-1.5">{r.label}</td>
                  <td className="border border-slate-300 p-1.5 text-slate-500">{r.desc || ''}</td>
                  <td className="border border-slate-300 p-1.5 text-center">{r.qty}</td>
                  <td className="border border-slate-300 p-1.5 text-center">{fmt(r.price)} ש"ח</td>
                  <td className="border border-slate-300 p-1.5 text-center">{fmt((r.qty||0)*(r.price||0))} ש"ח</td>
                </tr>
              ))}
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
      </div>

      <div>
        <p className="font-bold">המחיר כולל בתוכו:</p>
        <ul className="list-disc pr-5 space-y-0.5">
          <li>צוות הקמה</li>
          <li>צוות תפעול</li>
          <li>מנהל אירוע וליווי לאורך התהליך</li>
          <li>מלצרים</li>
          <li>ברמנים + מנהל בר</li>
          <li>תפריט שף {chefMenu}</li>
          <li>תפריט בר {barMenu}</li>
          <li>אבטחה</li>
          <li>צוות ניקיון</li>
          <li>מקרן להקרנה על הקיר (לא כולל מחשב וכבל HDMI)</li>
          <li>במה והקמת עמדת די ג'יי</li>
          <li>מיקרופון</li>
          <li>מערכת הגברה ותאורה כולל תפעול לאורך כל האירוע</li>
          <li>עיצוב המקום - שולחנות אבירים עם מפות לבנות, כדי נוי דקורטיבים, פינות ישיבה אלטרנטיביות כולל ספות, שולחנות בר גבוהים, שולחנות נמוכים, חביות יין עתיקות</li>
        </ul>
      </div>

      <div>
        <p className="font-bold">תנאי תשלום:</p>
        <p>במעמד חתימת הסכם זה תינתן מקדמה על-סך <strong>{fmt(depositAmount)} ש"ח ({depositPercent}%)</strong> לא כולל מע"מ. סה"כ <strong>{fmt(depositAmountVat)} ש"ח</strong> כולל מע"מ</p>
        <p>ביום האירוע, לפני תחילת האירוע יש לשלם את יתרת הסכום על סך <strong>{fmt(remainingBalance)} ש"ח כולל מע"מ</strong>.</p>
        <p>לחלופין - ניתן להביא צ'ק ביטחון של הסכום הנ"ל בתחילת האירוע.</p>
        <p>חשוב לציין כי ללא הנ"ל מנהל האירוע לא יתחיל ויקיים את האירוע!</p>
      </div>

      <div>
        <p className="font-bold">ביטול האירוע:</p>
        <ul className="list-disc pr-5 space-y-0.5">
          <li>במקרה של אי אישור לעריכת אירועים של פיקוד העורף/כוח עליון שאינו מאפשר לקיים את האירוע — הסכימו הצדדים על דחיית מועד האירוע למועד אחר עד לתאריך <strong>{cancellationDate}</strong></li>
          <li>במקרה של ביטול תוך פחות מחודשיים ממועד האירוע – יחויב המזמין בדמי ביטול של 50% מהסכום הכולל.</li>
          <li>במקרה של ביטול תוך פחות מחודש ועד שבוע ממועד האירוע – יחויב המזמין בדמי ביטול של 75% מהסכום הכולל.</li>
          <li>במקרה של ביטול תוך פחות משבוע ממועד האירוע – יחויב המזמין בדמי ביטול מלאים.</li>
        </ul>
      </div>

      <div>
        <p className="font-bold">התחייבויות והצהרות הצדדים:</p>
        <ul className="list-disc pr-5 space-y-0.5 text-xs leading-6">
          <li>האולם על חלקיו ישמש ללקוח לקיום האירוע. הספק מתחייב לאפשר למזמין עריכת האירוע באולם ובמועד כפי שפורטו לעיל.</li>
          <li>הספק יעמיד את האולם לרשות המזמין כשהוא נקי, ומסודר.</li>
          <li>המזמין מצהיר כי הובאו לידיעתו שעות בהן מתקיימים האירועים והוא מסכים לכך, כי האירוע יתקיים בין שעות הפעילות המפורטות לעיל בלבד.</li>
          <li>המזמין מצהיר כי הינו אחראי הבלעדי למעשיו ו/או למעשי נותני השירות שהוזמנו על ידו, למעט נותני השירות המפורטים ברשימת המומלצים של הספק.</li>
          <li>בנוסף המזמין אחראי על פי דין למעשי אורחיו וכי הוא יפצה את הספק לאחר פסק דין חלוט בגין כל נזק שיגרם ממעשה ו/או ממחדל של כל אחד מהנ"ל.</li>
          <li>מובהר בזאת, כי הספק אינו אחראי על שום ציוד ו/או חפצים אישיים, אשר נשכחו על ידי מי מטעם המזמין במתחם האולם.</li>
          <li>ידוע למזמין כי לא ניתן להשתמש בזיקוקים מכל סוג שהוא בכל שטח האתר, לרבות בחניה וכן לא ניתן להשתמש בקישוטים מתפזרים כדוגמת קונפטי וכדומה.</li>
          <li>עוצמת המוזיקה המתנגנת באירוע לא תעלה על המותר בחוק.</li>
          <li>המזמין יודע, מסכים, מאשר ומבין כי באולם האירועים יש הוראה חד משמעית כי אסור לעשן בתוכו בהתאם לחוק איסור עישון במקומות ציבוריים וכי יש בגן פינות עישון מיועדת לכך.</li>
          <li>באחריות הלקוח לשלם לאקו"ם באתר הבית.</li>
        </ul>
      </div>

      <p className="text-xs">למען הסר ספק, אם לא התייצב המזמין לביצוע התחשבנות כאמור בסעיף זה, יהא רשאי הספק לפעול בכל הדרכים הניתנים לו על פי החוק והדין לשם גביית סכום האירוע.</p>
      <p className="text-xs">המזמין עין ובדק את מלוא התנאים המצוינים בהסכם זה והוא הסכים לכל סעיפיו. כל שינוי, תוספת או גריעה מהסכם זה, לא יהיה להם כל תוקף או נפקות, אלא אם כן נעשו בכתב ונחתמו ע"י שני הצדדים להסכם זה.</p>
      <p className="text-xs">הצדדים מצהירים במפורש כי אין בהסכם זה כדי ליצור בין הצדדים יחסי סוכנות ו/או שליחות ו/או שותפות מכל מין וסוג שהוא.</p>
      <p className="text-xs">שום ויתור, הנחה, הימנעות מפעולה במועדה, או מתן ארכה, לא יחשבו כוויתור של צד מהצדדים, להסכם זה על זכות מזכויותיו, אלא כן נעשה ויתור זה במפורש ובכתב ונחתם ע"י הצד שמוותר.</p>
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
