const axios = require('axios');

const BASE = 'https://graph.facebook.com/v21.0';

function configured() {
  return !!(process.env.META_RSVP_PHONE_NUMBER_ID && process.env.META_RSVP_ACCESS_TOKEN);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.META_RSVP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function sendTemplate(to, templateName, bodyParams) {
  if (!configured()) throw new Error('META_RSVP credentials not configured');
  const parameters = bodyParams.map(p => ({ type: 'text', text: String(p) }));
  const { data } = await axios.post(
    `${BASE}/${process.env.META_RSVP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'he' },
        components: [{ type: 'body', parameters }],
      },
    },
    { headers: headers() }
  );
  return data;
}

async function sendText(to, text) {
  if (!configured()) throw new Error('META_RSVP credentials not configured');
  const { data } = await axios.post(
    `${BASE}/${process.env.META_RSVP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    },
    { headers: headers() }
  );
  return data;
}

module.exports = { configured, sendTemplate, sendText };
