import { useState } from 'react';
import api from '../api';
import { DOC_TYPES, PAYMENT_METHODS, VAT_OPTIONS, PAYMENT_DOC_TYPES } from '../utils/docTypes';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function InvoiceModal({ lead, allPhones, allPhoneLabels, onClose, onCreated }) {
  const [docType,       setDocType]       = useState(300);
  const [paymentMethod, setPaymentMethod] = useState(4);
  const [items,         setItems]         = useState([{ description: 'שירותי הפקת אירוע', quantity: 1, price: '', vatType: 1 }]);
  const [docDate,       setDocDate]       = useState(todayStr());
  const [secondDate,    setSecondDate]    = useState(todayStr());
  const [sendByEmail,   setSendByEmail]   = useState(false);
  const [sendByWa,      setSendByWa]      = useState(false);
  const [waMessage,     setWaMessage]     = useState('');
  const [waPhone,       setWaPhone]       = useState(allPhones?.[0] || lead?.phone || '');
  const [taxId,         setTaxId]         = useState(lead?.signer_id_number || '');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState(null);
  const [created,       setCreated]       = useState(null);

  function updateItem(i, field, val) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
  }
  function addItem() {
    setItems(prev => [...prev, { description: '', quantity: 1, price: '', vatType: 1 }]);
  }
  function removeItem(i) {
    setItems(prev => prev.filter((_, idx) => idx !== i));
  }

  const needsPmt    = PAYMENT_DOC_TYPES.includes(docType);
  const secondLabel = needsPmt ? 'תאריך תשלום' : 'לתשלום עד';

  async function submit() {
    const allValid = items.every(it => it.description && Number(it.price) > 0 && Number(it.quantity) > 0);
    if (!allValid) { setError('נא למלא את כל פרטי הפריטים'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/greeninvoice/document', {
        leadId:          lead.id,
        type:            docType,
        items:           items.map(it => ({ description: it.description, quantity: Number(it.quantity), price: Number(it.price), vatType: Number(it.vatType) })),
        docDate,
        dueDate:         needsPmt ? undefined : secondDate,
        paymentDate:     needsPmt ? secondDate : undefined,
        paymentMethod,
        taxId:           taxId.trim() || undefined,
        sendByEmail,
        sendByWhatsApp:  sendByWa,
        whatsappMessage: waMessage,
        whatsappPhone:   sendByWa ? waPhone : undefined,
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-black text-slate-800 text-base">צור מסמך פיננסי</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {created?.pending ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-4xl">&#9203;</div>
            <p className="font-bold text-slate-800">המסמך נשלח לאישור מנהל</p>
            <p className="text-xs text-slate-500">המנהל יקבל הודעת ווטסאפ ויאשר את המסמך</p>
            <button onClick={onClose}
              className="mt-2 px-6 py-2 rounded-xl font-bold text-white text-sm"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              סגור
            </button>
          </div>
        ) : created ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-4xl">&#10003;</div>
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

              {/* Payment method — receipt types only */}
              {needsPmt && (
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

              {/* Items */}
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-2">פריטים</label>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2 items-start">
                        <input
                          value={it.description}
                          onChange={e => updateItem(i, 'description', e.target.value)}
                          placeholder="תיאור"
                          className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400"
                        />
                        {items.length > 1 && (
                          <button onClick={() => removeItem(i)}
                            className="text-slate-400 hover:text-red-500 text-lg leading-none pt-1">&#x2715;</button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 block mb-0.5">כמות</label>
                          <input type="number" min="1"
                            value={it.quantity}
                            onChange={e => updateItem(i, 'quantity', e.target.value)}
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 block mb-0.5">מחיר (₪)</label>
                          <input type="number" min="0"
                            value={it.price}
                            onChange={e => updateItem(i, 'price', e.target.value)}
                            placeholder="0"
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 block mb-0.5">מע"מ</label>
                          <select
                            value={it.vatType}
                            onChange={e => updateItem(i, 'vatType', Number(e.target.value))}
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400 bg-white"
                          >
                            {VAT_OPTIONS.map(v => (
                              <option key={v.value} value={v.value}>{v.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addItem}
                  className="mt-2 text-xs text-violet-600 font-bold hover:text-violet-800 transition">
                  + הוסף פריט
                </button>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">תאריך מסמך</label>
                  <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">{secondLabel}</label>
                  <input type="date" value={secondDate} onChange={e => setSecondDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
                </div>
              </div>

              {/* Client info */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-xs text-slate-600">
                <p className="font-bold text-slate-700 mb-1">פרטי לקוח</p>
                <p>שם: {lead.orderer_name || lead.name}</p>
                {lead.phone && <p>טלפון: <a href={`tel:${lead.phone}`} className="text-violet-600">{lead.phone}</a></p>}
                {lead.email && <p>אימייל: {lead.email}</p>}
                <div className="pt-1">
                  <label className="block font-bold text-slate-600 mb-0.5">ח.פ / ת.ז (מספר עוסק)</label>
                  <input value={taxId} onChange={e => setTaxId(e.target.value)}
                    placeholder="נשלף מהחוזה החתום — ניתן לעריכה"
                    className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400" />
                  {!taxId.trim() && <p className="text-amber-600 mt-0.5">לא הוזן — GreenInvoice עלול לדחות מסמך ללא מספר תקין</p>}
                </div>
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
                  {sendByWa && allPhones?.length > 1 && (
                    <div className="mt-2 space-y-1">
                      <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                      {allPhones.map(p => (
                        <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                          <input type="radio" name="invoiceWaPhone" value={p}
                            checked={waPhone === p} onChange={() => setWaPhone(p)} />
                          {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                        </label>
                      ))}
                    </div>
                  )}
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
