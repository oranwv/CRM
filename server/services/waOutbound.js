// Shared Green API outbound helpers (text + file by URL) for places that are not
// the lead WhatsApp tab — the AI assistant's "שלח בוואטסאפ", etc.
// Mirrors the send-file flow in routes/whatsapp.js: upload the bytes to Green API
// storage once, then sendFileByUrl per recipient. Never throws on a single bad
// recipient — returns the phones that were actually sent to.
const axios    = require('axios');
const FormData = require('form-data');

function base() {
  const { GREEN_API_URL, GREEN_API_INSTANCE, GREEN_API_TOKEN } = process.env;
  if (!GREEN_API_URL || !GREEN_API_INSTANCE || !GREEN_API_TOKEN) throw new Error('Green API is not configured');
  return `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}`;
}
const method = (m) => `${base()}/${m}/${process.env.GREEN_API_TOKEN}`;

// Same 3-second pacing as routes/whatsapp.js (module-local clock — good enough,
// Green API tolerates the occasional overlap).
let lastSend = 0;
async function slot() {
  const gap = 3000 - (Date.now() - lastSend);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  lastSend = Date.now();
}

async function sendTextToPhones(phones, message) {
  const sent = [];
  for (const phone of phones) {
    try {
      await slot();
      await axios.post(method('sendMessage'), { chatId: `${phone}@c.us`, message });
      sent.push(phone);
    } catch (err) {
      console.error('[waOutbound] text send failed for', phone, err.response?.data || err.message);
    }
  }
  return sent;
}

// { signedUrl, fileName, mime, caption } → phones that received the file
async function sendFileToPhones(phones, { signedUrl, fileName, mime = 'application/octet-stream', caption = '' }) {
  const fileRes = await axios.get(signedUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const fd = new FormData();
  fd.append('file', Buffer.from(fileRes.data), { filename: fileName, contentType: mime });
  const up = await axios.post(method('uploadFile'), fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
  const urlFile = up.data?.urlFile;
  if (!urlFile) throw new Error('Green API upload returned no urlFile');

  const sent = [];
  for (const phone of phones) {
    try {
      await slot();
      await axios.post(method('sendFileByUrl'), { chatId: `${phone}@c.us`, urlFile, fileName, caption });
      sent.push(phone);
    } catch (err) {
      console.error('[waOutbound] file send failed for', phone, err.response?.data || err.message);
    }
  }
  return sent;
}

module.exports = { sendTextToPhones, sendFileToPhones };
