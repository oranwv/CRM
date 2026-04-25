const router = require('express').Router();
const pool   = require('../db/pool');
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const pool = require('../db/pool');

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey: key });
}

// POST /api/ai/translate — translate text to Hebrew or English
router.post('/translate', async (req, res) => {
  const { text, to } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const instruction = to === 'en'
    ? 'Translate the following text to English. Return only the translated text, nothing else.'
    : 'תרגם את הטקסט הבא לעברית. החזר רק את הטקסט המתורגם, ללא הסברים.';

  try {
    const msg = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${instruction}\n\n${text}` }],
    });
    res.json({ result: msg.content[0].text.trim() });
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
      .map(r => `[${r.direction === 'inbound' ? 'לקוח' : 'שרביה'}]: ${r.body}`)
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
    const replySystem = `אתה איש מכירות מקצועי של אולם אירועים שרביה בתל אביב. אתה כותב תגובות חמות, מקצועיות ומשכנעות ללקוחות פוטנציאליים בעברית. החזר רק את טקסט ההודעה ללא כותרות או הסברים.${aiInstructions ? '\n\n' + aiInstructions : ''}`;

    const msg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: replySystem,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ result: msg.content[0].text.trim() });
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
    const improveSystem = `אתה עוזר לאיש מכירות של אולם אירועים שרביה לשפר הודעות ללקוחות. שפר את ההודעה הבאה — תהיה מקצועי יותר, חם ומשכנע, תוך שמירה על הכוונה המקורית. החזר רק את טקסט ההודעה המשופרת ללא הסברים.${aiInstructions2 ? '\n\n' + aiInstructions2 : ''}`;
    const msg = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: improveSystem,
      messages: [{ role: 'user', content: text }],
    });
    res.json({ result: msg.content[0].text.trim() });
  } catch (err) {
    console.error('[AI] improve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
