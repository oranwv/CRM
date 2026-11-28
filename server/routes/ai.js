const router = require('express').Router();
const { biz } = require('../services/businessProfile');
const multer = require('multer');
const pool   = require('../db/pool');
const { OpenAI, toFile } = require('openai');

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const { openai: meteredOpenAI } = require('../services/openaiClient');
const getClient = (feature = 'ai-tools') => meteredOpenAI(feature);

// Vocabulary hint for dictating a price offer / contract change (names and terms the model would otherwise mishear)
const DICTATION_PROMPT = 'איש צוות של שרביה, מקום אירועים ביפו, מכתיב הצעת מחיר או חוזה לאירוע: חבילה, מחיר לאורח, אורחים, לפני מע"מ, כולל מע"מ, מקדמה, תפריט שף, תפריט בר, ארוחת בוקר, ארוחת צהריים, מאפים, גבינות, סלטים, קינוחים, מלצרים, ברמנים, מנהל אירוע, תאורה והגברה, די ג׳יי, מתחם, שעת התחלה, שעת סיום.';

// POST /api/ai/transcribe — voice recording → text (OpenAI Whisper, Hebrew)
router.post('/transcribe', audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא התקבלה הקלטה' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'תמלול אינו זמין (OPENAI_API_KEY חסר)' });
  try {
    const mkFile = () => toFile(req.file.buffer, req.file.originalname || 'audio.webm', { type: req.file.mimetype || 'audio/webm' });
    const audioSeconds = Number(req.body?.seconds) > 0 ? Math.round(Number(req.body.seconds)) : Math.round((req.file.size || 0) / 16000);
    // context=dictation (Phase 102d): the user dictates an offer / a change to a document.
    // Uses the stronger transcription model with a vocabulary prompt; long recordings and
    // any failure fall back to whisper-1 with the same prompt. Other callers are unchanged.
    if (req.body?.context === 'dictation') {
      const prompt = DICTATION_PROMPT;
      // gpt-4o-transcribe caps its output length, so very long dictations go to whisper-1
      if (audioSeconds <= 300) {
        try {
          const t = await getClient('voice-dictation').audio.transcriptions.create({ model: 'gpt-4o-transcribe', file: await mkFile(), language: 'he', prompt, audioSeconds });
          if ((t.text || '').trim()) return res.json({ text: t.text });
        } catch (e) {
          console.error('[AI] gpt-4o-transcribe failed, falling back to whisper-1:', e.message);
        }
      }
      const t = await getClient('voice-dictation').audio.transcriptions.create({ model: 'whisper-1', file: await mkFile(), language: 'he', prompt, audioSeconds });
      return res.json({ text: t.text || '' });
    }
    const transcription = await getClient('voice-note').audio.transcriptions.create({ model: 'whisper-1', file: await mkFile(), language: 'he', audioSeconds });
    res.json({ text: transcription.text || '' });
  } catch (err) {
    console.error('[AI] transcribe error:', err.message);
    res.status(500).json({ error: 'שגיאה בתמלול ההקלטה' });
  }
});

// POST /api/ai/translate — translate text to Hebrew or English
router.post('/translate', async (req, res) => {
  const { text, to } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const instruction = to === 'en'
    ? 'Translate the following text to English. Return only the translated text, nothing else.'
    : 'תרגם את הטקסט הבא לעברית. החזר רק את הטקסט המתורגם, ללא הסברים.';

  try {
    const completion = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${instruction}\n\n${text}` }],
    });
    res.json({ result: completion.choices[0].message.content.trim() });
  } catch (err) {
    console.error('[AI] translate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/reply — generate a sales reply based on full conversation history
router.post('/reply', async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) return res.status(400).json({ error: 'leadId required' });

  try {
    const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { rows: messages } = await pool.query(
      'SELECT direction, body, timestamp AS ts FROM messages WHERE lead_id = $1',
      [leadId]
    );
    const { rows: interactions } = await pool.query(
      'SELECT direction, body, created_at AS ts FROM lead_interactions WHERE lead_id = $1',
      [leadId]
    );

    const history = [...messages, ...interactions]
      .sort((a, b) => new Date(a.ts) - new Date(b.ts))
      .map(r => `[${r.direction === 'inbound' ? 'לקוח' : biz().name}]: ${r.body}`)
      .join('\n');

    const leadContext = [
      lead.name   ? `שם: ${lead.name}`         : '',
      lead.event_type ? `סוג אירוע: ${lead.event_type}` : '',
      lead.event_date ? `תאריך אירוע: ${lead.event_date}` : '',
      lead.guest_count ? `מוזמנים: ${lead.guest_count}` : '',
    ].filter(Boolean).join(' | ');

    const prompt = `פרטי הליד: ${leadContext}

היסטוריית השיחה:
${history || '(אין היסטוריה)'}

כתוב תגובה מקצועית וחמה בעברית להודעה האחרונה של הלקוח. היה ממוקד, ידידותי ודחוף להמשך התהליך לקראת הזמנת האירוע.`;

    const { rows: aiRows } = await pool.query("SELECT value FROM settings WHERE key = 'ai_instructions'");
    const aiInstructions = aiRows[0]?.value?.trim() || '';
    const replySystem = `אתה איש מכירות מקצועי של ${biz().kind} ${biz().name}${biz().city ? ' ב' + biz().city : ''}. אתה כותב תגובות חמות, מקצועיות ומשכנעות ללקוחות פוטנציאליים בעברית. החזר רק את טקסט ההודעה ללא כותרות או הסברים.${aiInstructions ? '\n\n' + aiInstructions : ''}`;

    const completion = await getClient().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: replySystem },
        { role: 'user', content: prompt },
      ],
    });
    res.json({ result: completion.choices[0].message.content.trim() });
  } catch (err) {
    console.error('[AI] reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/improve — improve a draft message
router.post('/improve', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const { rows: aiRows2 } = await pool.query("SELECT value FROM settings WHERE key = 'ai_instructions'");
    const aiInstructions2 = aiRows2[0]?.value?.trim() || '';
    const improveSystem = `אתה עוזר לאיש מכירות של ${biz().kind} ${biz().name} לשפר הודעות ללקוחות. שפר את ההודעה הבאה — תהיה מקצועי יותר, חם ומשכנע, תוך שמירה על הכוונה המקורית. החזר רק את טקסט ההודעה המשופרת ללא הסברים.${aiInstructions2 ? '\n\n' + aiInstructions2 : ''}`;
    const completion = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: improveSystem },
        { role: 'user', content: text },
      ],
    });
    res.json({ result: completion.choices[0].message.content.trim() });
  } catch (err) {
    console.error('[AI] improve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
