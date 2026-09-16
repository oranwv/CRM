// Speaker-separated transcript from a Twilio dual-channel recording.
//
// Twilio records the two legs of a <Dial> on separate channels (record-from-answer-dual):
// channel 0 = the parent call (browser rep on an outbound call / the customer on an inbound
// call), channel 1 = the dialed party. We download the WAV, split it into two mono WAVs in
// pure JS (8 kHz 16-bit PCM — no ffmpeg on Railway), transcribe each with Whisper
// (verbose_json → timed segments), and interleave the segments by start time into
// "נציג: … / לקוח: …" lines. Falls back to a plain single-track transcript if anything fails.
const axios = require('axios');
const { toFile } = require('openai');

const WHISPER_PROMPT = 'שיחת טלפון בעברית בין נציג מכירות של שרביה, מקום אירועים ביפו, ללקוח שמתעניין באירוע: חתונה, בר מצווה, אירוע חברה, מחיר לאורח, תאריך, תפריט, בר.';
const MAX_UPLOAD = 24 * 1024 * 1024; // Whisper limit is 25 MB per file

async function downloadWav(recordingUrl) {
  const res = await axios.get(`${recordingUrl}.wav`, {
    responseType: 'arraybuffer', timeout: 120000,
    params: { RequestedChannels: 2 },
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
  });
  return Buffer.from(res.data);
}

// Minimal RIFF/WAVE reader for 16-bit PCM. Returns { sampleRate, channels, pcm (Buffer of the data chunk) }.
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV missing fmt/data');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported WAV format ${fmt.format}/${fmt.bits}`);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, pcm: data };
}

function wavHeader(dataLen, sampleRate, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(dataLen, 40);
  return h;
}

// Split interleaved stereo 16-bit PCM into two mono WAV buffers.
function splitChannels({ sampleRate, channels, pcm }) {
  if (channels !== 2) return null;
  const frames = Math.floor(pcm.length / 4);
  const left = Buffer.alloc(frames * 2), right = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm.copy(left, i * 2, i * 4, i * 4 + 2);
    pcm.copy(right, i * 2, i * 4 + 2, i * 4 + 4);
  }
  return [Buffer.concat([wavHeader(left.length, sampleRate), left]), Buffer.concat([wavHeader(right.length, sampleRate), right])];
}

// Cut a mono WAV into ≤ MAX_UPLOAD pieces; returns [{ buf, offsetSec }]
function chunkMono(wav, sampleRate) {
  const pcm = wav.subarray(44);
  const bytesPerSec = sampleRate * 2;
  const maxBytes = Math.floor((MAX_UPLOAD - 44) / bytesPerSec) * bytesPerSec;
  if (pcm.length <= maxBytes) return [{ buf: wav, offsetSec: 0 }];
  const out = [];
  for (let start = 0; start < pcm.length; start += maxBytes) {
    const slice = pcm.subarray(start, Math.min(pcm.length, start + maxBytes));
    out.push({ buf: Buffer.concat([wavHeader(slice.length, sampleRate), slice]), offsetSec: start / bytesPerSec });
  }
  return out;
}

// Whisper with timestamps → [{ start, end, text }]
async function transcribeSegments(openai, wavBuf, offsetSec, audioSeconds) {
  const file = await toFile(wavBuf, 'channel.wav', { type: 'audio/wav' });
  const r = await openai.audio.transcriptions.create({
    model: 'whisper-1', file, language: 'he', prompt: WHISPER_PROMPT,
    response_format: 'verbose_json', timestamp_granularities: ['segment'], audioSeconds,
  });
  return (r.segments || []).map(s => ({ start: s.start + offsetSec, end: s.end + offsetSec, text: (s.text || '').trim() }))
    .filter(s => s.text && !(s.no_speech_prob > 0.8));
}

// Roles per channel by call type (see header comment)
function rolesFor(call) {
  return call.direction === 'inbound' ? ['לקוח', 'נציג'] : ['נציג', 'לקוח'];
}

// Returns { text, lines: [{ speaker, start, text }] , mode: 'dual'|'mono' }
async function transcribeCall({ openai, call, recordingUrl, durationSec }) {
  const wav = parseWav(await downloadWav(recordingUrl));
  const channels = splitChannels(wav);
  if (!channels) {
    // Mono recording (e.g. voicemail <Record>) — one track, no speakers
    const segs = [];
    for (const c of chunkMono(Buffer.concat([wavHeader(wav.pcm.length, wav.sampleRate), wav.pcm]), wav.sampleRate)) {
      segs.push(...await transcribeSegments(openai, c.buf, c.offsetSec, durationSec));
    }
    return { mode: 'mono', lines: segs.map(s => ({ speaker: null, start: s.start, text: s.text })), text: segs.map(s => s.text).join(' ') };
  }
  const roles = rolesFor(call);
  const all = [];
  for (let ch = 0; ch < 2; ch++) {
    for (const c of chunkMono(channels[ch], wav.sampleRate)) {
      const segs = await transcribeSegments(openai, c.buf, c.offsetSec, durationSec);
      for (const s of segs) all.push({ ...s, speaker: roles[ch] });
    }
  }
  all.sort((a, b) => a.start - b.start);
  // Merge consecutive segments of the same speaker into one line
  const lines = [];
  for (const s of all) {
    const last = lines[lines.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 1.5) { last.text += ' ' + s.text; last.end = s.end; }
    else lines.push({ speaker: s.speaker, start: s.start, end: s.end, text: s.text });
  }
  const text = lines.map(l => `${l.speaker}: ${l.text}`).join('\n');
  return { mode: 'dual', lines, text };
}

module.exports = { transcribeCall, WHISPER_PROMPT };
