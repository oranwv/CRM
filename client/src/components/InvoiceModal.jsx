import { useState } from 'react';
import api from '../api';

const DOC_TYPES = [
  { type: 300, label: 'דרישת תשלום' },
  { type: 305, label: 'חשבון עסקה' },
  { type: 400, label: 'קבלה' },
  { type: 320, label: 'חשבונית מס קבלה' },
];

const PAYMENT_METHODS = [
  { value: 4,  label: 'העברה בנקאית' },
  { value: 3,  label: 'כרטיס אשראי' },
  { value: 1,  label: 'מזומן' },
  { value: 2,  label: "צ'ק" },
  { value: 10, label: 'ביט / אפליקציה' },
  { value: 11, label: 'אחר' },
];

export default function InvoiceModal({ lead, onClose, onCreated }) {
  const depositAmount   = lead.deposit_amount    ? Number(lead.deposit_amount)    : null;
  const remainingAmount = lead.remaining_balance_override ? Number(lead.remaining_balance_override) : null;

  const [docType,       setDocType]       = useState(300);
  const [paymentMethod, setPaymentMethod] = useState(4);
  const [amountSource,  setAmountSource]  = useState('custom');
  const [customAmount,  setCustomAmount]  = useState('');
  const [description,   setDescription]   = useState('שירותי הפקת אירוע');
  const [includeVat,    setIncludeVat]    = useState(true);
  const [sendByEmail,   setSendByEmail]   = useState(false);
  const [sendByWa,      setSendByWa]      = useState(false);
  const [waMessage,     setWaMessage]     = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState(null);
  const [created,       setCreated]       = useState(null);

  const resolvedAmount =
    amountSource === 'deposit'   ? depositAmount :
    amountSource === 'remaining' ? remainingAmount :
    customAmount ? Number(customAmount) : null;

  async function submit() {
    if (!resolvedAmount || resolvedAmount <= 0) {
      setError('נא להזין סכום תקין');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/greeninvoice/document', {
        leadId:          lead.id,
        type:            docType,
        amount:          resolvedAmount,
        description,
        includeVat,
        paymentMethod,
        sendByEmail,
        sendByWhatsApp:  sendByWa,
        whatsappMessage: waMessage,
      });
      setCreated(data);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה ביצירת המסמך');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-black text-slate-800 text-base">צור מסמך פיננסי</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {created ? (
          /* Success state */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-4xl">✓</div>
            <p className="font-bold text-slate-800">המסמך נוצר בהצלחה!</p>
            <p className="text-xs text-slate-500">{created.filename}</p>
            <a href={created.url} target="_blank" rel="noreferrer"
              className="text-xs text-violet-600 underline hover:text-violet-800">
              פתח במערכת גרין אינוויס
            </a>
            <button onClick={onClose}
              className="mt-2 px-6 py-2 rounded-xl font-bold text-white text-sm"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              סגור
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Document type */}
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-2">סוג מסמך</label>
                <div className="grid grid-cols-2 gap-2">
                  {DOC_TYPES.map(d => (
                    <button key={d.type} onClick={() => setDocType(d.type)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border-2 transition text-center ${
                        docType === d.type
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-slate-200 text-slate-600 hover:border-violet-300'
                      }`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment method — required for receipt types */}
              {[400, 320].includes(docType) && (
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-2">אמצעי תשלום</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_METHODS.map(m => (
                      <button key={m.value} onClick={() => setPaymentMethod(m.value)}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold border-2 transition text-center ${
                          paymentMethod === m.value
                            ? 'border-violet-500 bg-violet-50 text-violet-700'
                            : 'border-slate-200 text-slate-600 hover:border-violet-300'
                        }`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">תיאור</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-2">סכום</label>
                <div className="space-y-2">
                  {depositAmount != null && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="amountSrc" checked={amountSource === 'deposit'}
                        onChange={() => setAmountSource('deposit')} />
                      <span className="text-sm text-slate-700">מקדמה — ₪{depositAmount.toLocaleString('he-IL')}</span>
                    </label>
                  )}
                  {remainingAmount != null && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="amountSrc" checked={amountSource === 'remaining'}
                        onChange={() => setAmountSource('remaining')} />
                      <span className="text-sm text-slate-700">יתרה לתשלום — ₪{remainingAmount.toLocaleString('he-IL')}</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="amountSrc" checked={amountSource === 'custom'}
                      onChange={() => setAmountSource('custom')} />
                    <span className="text-sm text-slate-700">סכום אחר</span>
                  </label>
                  {amountSource === 'custom' && (
                    <input type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
                      placeholder="סכום בשקלים"
                      className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
                  )}
                </div>
              </div>

              {/* VAT */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeVat} onChange={e => setIncludeVat(e.target.checked)} />
                <span className="text-sm text-slate-700">כולל מע"מ</span>
              </label>

              {/* Client info */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-xs text-slate-600">
                <p className="font-bold text-slate-700 mb-1">פרטי לקוח</p>
                <p>שם: {lead.name}</p>
                {lead.phone && <p>טלפון: {lead.phone}</p>}
                {lead.email && <p>אימייל: {lead.email}</p>}
              </div>

              {/* Sending options */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sendByEmail} onChange={e => setSendByEmail(e.target.checked)}
                    disabled={!lead.email} />
                  <span className={`text-sm ${lead.email ? 'text-slate-700' : 'text-slate-400'}`}>
                    שלח במייל דרך גרין אינוויס{!lead.email && ' (אין אימייל בתיק)'}
                  </span>
                </label>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={sendByWa} onChange={e => setSendByWa(e.target.checked)}
                      disabled={!lead.phone} />
                    <span className={`text-sm ${lead.phone ? 'text-slate-700' : 'text-slate-400'}`}>
                      שלח בווטסאפ{!lead.phone && ' (אין טלפון בתיק)'}
                    </span>
                  </label>
                  {sendByWa && (
                    <textarea value={waMessage} onChange={e => setWaMessage(e.target.value)}
                      placeholder="הודעה (קישור למסמך יצורף אוטומטית)"
                      rows={3}
                      className="mt-2 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400 resize-none" />
                  )}
                </div>
              </div>

              {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 px-5 py-3 flex justify-end gap-3">
              <button onClick={onClose}
                className="text-xs px-4 py-2 rounded-xl font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 transition">
                ביטול
              </button>
              <button onClick={submit} disabled={submitting}
                className="text-xs px-5 py-2 rounded-xl font-bold text-white disabled:opacity-50 transition"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                {submitting ? 'יוצר מסמך...' : 'צור מסמך'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
