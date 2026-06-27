// Core of the Instagram Click-to-WhatsApp CTA template:
// "שלום! אפשר לקבל מידע נוסף על זה? " — WhatsApp may append a trailing space
// or an ad/product reference, so we match the core phrase, not the full string.
const INSTAGRAM_CTA = 'אפשר לקבל מידע נוסף על זה';

// Classify the channel of an inbound WhatsApp lead from its first message text.
// Returns 'instagram' for Instagram-ad-originated chats, otherwise 'whatsapp'.
function classifyInboundSource(messageText) {
  return (messageText || '').includes(INSTAGRAM_CTA) ? 'instagram' : 'whatsapp';
}

module.exports = { classifyInboundSource, INSTAGRAM_CTA };
