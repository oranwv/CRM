// One OpenAI client for the whole server, with usage metering.
//
//   const { openai } = require('./openaiClient');
//   openai('deal-advisor').chat.completions.create({...})   // same API as the SDK
//
// Every chat completion / transcription is written to `ai_usage` with tokens, audio
// seconds and an estimated USD cost (price table below), tagged with the feature that
// made the call. The costs panel in ניהול reads that table — nothing else changes for
// callers. Streaming calls get `stream_options.include_usage` added so the final chunk
// carries the token counts.
const { OpenAI } = require('openai');
const pool = require('../db/pool');

// USD per 1M tokens (input, output) / per minute of audio. Update when OpenAI changes prices.
const PRICES = {
  'gpt-4o':               { input: 2.50, output: 10.00 },
  'gpt-4o-mini':          { input: 0.15, output: 0.60 },
  'gpt-4.1':              { input: 2.00, output: 8.00 },
  'gpt-4.1-mini':         { input: 0.40, output: 1.60 },
  'whisper-1':            { perMinute: 0.006 },
  'gpt-4o-transcribe':    { perMinute: 0.006 },
  'gpt-4o-mini-transcribe': { perMinute: 0.003 },
};

function priceFor(model) {
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES).find(k => model?.startsWith(k));
  return base ? PRICES[base] : null;
}

function estimateCost(model, { inputTokens = 0, outputTokens = 0, audioSeconds = 0 }) {
  const p = priceFor(model);
  if (!p) return null;
  let usd = 0;
  if (p.input)  usd += (inputTokens / 1e6) * p.input;
  if (p.output) usd += (outputTokens / 1e6) * p.output;
  if (p.perMinute) usd += (audioSeconds / 60) * p.perMinute;
  return Math.round(usd * 1e6) / 1e6;
}

async function record({ feature, model, inputTokens = 0, outputTokens = 0, audioSeconds = 0, meta = null }) {
  const cost = estimateCost(model, { inputTokens, outputTokens, audioSeconds });
  try {
    await pool.query(
      `INSERT INTO ai_usage (provider, feature, model, input_tokens, output_tokens, audio_seconds, cost_usd, meta)
       VALUES ('openai', $1, $2, $3, $4, $5, $6, $7)`,
      [feature || 'unknown', model || null, inputTokens || 0, outputTokens || 0, Math.round(audioSeconds || 0), cost, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('[ai_usage] record failed:', err.message);
  }
}

let _raw = null;
function raw() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  if (!_raw) _raw = new OpenAI({ apiKey: key });
  return _raw;
}

// Wraps an async iterable stream so the usage chunk (last one) is recorded when consumed.
function meteredStream(stream, feature, model) {
  const it = stream[Symbol.asyncIterator]();
  let usage = null;
  const wrapped = {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      const r = await it.next();
      if (!r.done && r.value?.usage) usage = r.value.usage;
      if (r.done) {
        record({ feature, model, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens });
      }
      return r;
    },
    async return(v) { if (usage) record({ feature, model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }); return it.return ? it.return(v) : { done: true, value: v }; },
    controller: stream.controller,
  };
  return wrapped;
}

// Returns an object with the same shape callers already use:
//   .chat.completions.create(...)  and  .audio.transcriptions.create(...)
function openai(feature = 'unknown') {
  const client = raw();
  return {
    chat: {
      completions: {
        async create(params, options) {
          if (params.stream) {
            const stream = await client.chat.completions.create({ ...params, stream_options: { include_usage: true, ...(params.stream_options || {}) } }, options);
            return meteredStream(stream, feature, params.model);
          }
          const res = await client.chat.completions.create(params, options);
          record({ feature, model: res.model || params.model, inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens });
          return res;
        },
      },
    },
    audio: {
      transcriptions: {
        // Pass `audioSeconds` (not an OpenAI param) when the caller knows the duration; otherwise
        // the size of the uploaded bytes is used as a rough estimate (~16 KB/s for webm/mp3 voice).
        async create({ audioSeconds, ...params }, options) {
          const res = await client.audio.transcriptions.create(params, options);
          let seconds = Number(audioSeconds) || 0;
          if (!seconds) {
            const size = params.file?.size || params.file?.length || 0;
            seconds = size ? Math.max(1, Math.round(size / 16000)) : 0;
          }
          record({ feature, model: params.model, audioSeconds: seconds });
          return res;
        },
      },
    },
    _raw: client,
  };
}

module.exports = { openai, record, estimateCost, PRICES };
