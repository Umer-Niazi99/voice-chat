require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { school, APOLOGY_UR, buildSystemPrompt } = require('./knowledge');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const GROQ_KEY = process.env.GROQ_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVEN_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const PRIMARY_MODEL = process.env.ELEVEN_MODEL || 'eleven_v3';
const PORT = process.env.PORT || 3000;

if (!GROQ_KEY || !ELEVEN_KEY) console.warn('\n[!] Missing GROQ_API_KEY or ELEVENLABS_API_KEY in .env\n');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/info', (req, res) => res.json(school));

// ---------- Groq model discovery (so a retired model never breaks the app) ----------
const CHAT_PREF = [process.env.GROQ_CHAT_MODEL, 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
  'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct'].filter(Boolean);
const STT_PREF = [process.env.GROQ_STT_MODEL, 'whisper-large-v3', 'whisper-large-v3-turbo'].filter(Boolean);
const NOT_CHAT = /whisper|guard|tts|orpheus|playai|embed|safeguard|compound/i;

let available = null;
async function loadModels() {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_KEY}` } });
    if (!r.ok) throw new Error(`models list failed (${r.status})`);
    available = ((await r.json()).data || []).map((m) => m.id);
    console.log(`  Groq models found: ${available.length}`);
  } catch (e) {
    console.warn('  Could not list Groq models:', e.message);
    available = [];
  }
}
function modelOrder(pref, accept) {
  const av = available || [];
  if (!av.length) return pref;
  const ranked = pref.filter((m) => av.includes(m));
  const others = av.filter((id) => accept(id) && !pref.includes(id));
  return [...ranked, ...others];
}
const chatModels = () => modelOrder(CHAT_PREF, (id) => !NOT_CHAT.test(id));
const sttModels = () => modelOrder(STT_PREF, (id) => /whisper/i.test(id));

const isModelProblem = (status, body) => (status === 404 || status === 400 || status === 403) && /model/i.test(body);
const workingModel = { chat: null, stt: null };

// ---------- Groq: speech to text (Whisper) ----------
async function transcribe(buffer, mime) {
  if (available === null) await loadModels();
  const ext = /mp4|m4a|aac/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
  const models = workingModel.stt ? [workingModel.stt] : sttModels();
  let last = 'no speech-to-text model available on this Groq key';
  for (const model of models) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime || 'audio/webm' }), `voice.${ext}`);
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: form
    });
    if (r.ok) { workingModel.stt = model; return ((await r.json()).text || '').trim(); }
    const body = await r.text();
    last = `Groq transcription failed (${r.status}) with ${model}: ${body.slice(0, 200)}`;
    if (!isModelProblem(r.status, body)) throw new Error(last);
  }
  throw new Error(last);
}

// ---------- Groq: understanding ----------
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* try to extract */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}

async function understand(question, history) {
  if (available === null) await loadModels();
  const messages = [{ role: 'system', content: buildSystemPrompt() }];
  history.slice(-6).forEach((m) => {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content.slice(0, 500) });
    }
  });
  messages.push({ role: 'user', content: question });

  const models = workingModel.chat ? [workingModel.chat] : chatModels();
  let last = 'no chat model available on this Groq key';
  for (const model of models) {
    for (const useJsonMode of [true, false]) {
      const payload = { model, messages, temperature: 0.2, max_tokens: 1200 };
      if (/gpt-oss/i.test(model)) payload.reasoning_effort = 'low';
      if (useJsonMode) payload.response_format = { type: 'json_object' };
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        workingModel.chat = model;
        const data = await r.json();
        const parsed = parseJson(data.choices?.[0]?.message?.content || '');
        if (!parsed) return { related: false, answer: '' };
        return { related: parsed.related === true, answer: String(parsed.answer || '').trim() };
      }
      const body = await r.text();
      last = `Groq chat failed (${r.status}) with ${model}: ${body.slice(0, 200)}`;
      if (useJsonMode && r.status === 400 && /response_format|json/i.test(body)) continue; // retry without json mode
      if (isModelProblem(r.status, body)) break; // try next model
      throw new Error(last);
    }
  }
  throw new Error(last);
}

// ---------- ElevenLabs: text to speech ----------
async function speak(text) {
  const clean = text.replace(/[*_`#>]/g, '').slice(0, 700);
  const models = [...new Set([PRIMARY_MODEL, 'eleven_multilingual_v2'])];
  let lastErr = '';
  for (const model of models) {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: clean, model_id: model })
      }
    );
    if (r.ok) return Buffer.from(await r.arrayBuffer()).toString('base64');
    lastErr = `${r.status} ${(await r.text()).slice(0, 160)}`;
  }
  throw new Error(`ElevenLabs failed: ${lastErr}`);
}

let apologyAudio = null;

app.post('/api/ask', upload.single('audio'), async (req, res) => {
  try {
    if (!GROQ_KEY || !ELEVEN_KEY) return res.status(500).json({ error: 'Server API keys are missing in .env' });

    let question = (req.body.text || '').trim();
    if (!question && req.file) {
      if (req.file.size < 1500) return res.status(400).json({ error: 'I could not hear anything. Please try again.' });
      question = await transcribe(req.file.buffer, req.file.mimetype);
    }
    if (!question) return res.status(400).json({ error: 'I could not hear anything. Please try again.' });

    let history = [];
    try { history = JSON.parse(req.body.history || '[]'); } catch { history = []; }

    const { related, answer } = await understand(question, history);

    if (!related || !answer) {
      try { if (!apologyAudio) apologyAudio = await speak(APOLOGY_UR); } catch (e) { console.error(e.message); }
      return res.json({ transcript: question, related: false, answer: APOLOGY_UR, audio: apologyAudio });
    }

    let audio = null;
    try { audio = await speak(answer); } catch (e) { console.error(e.message); }
    res.json({ transcript: question, related: true, answer, audio });
  } catch (err) {
    console.error(err);
    const cause = err && err.cause && err.cause.code ? ` [${err.cause.code}]` : '';
    res.status(500).json({ error: 'Server error: ' + err.message + cause });
  }
});

app.listen(PORT, async () => {
  console.log(`\n  Thinkers Alliance portal running -> http://localhost:${PORT}`);
  if (GROQ_KEY) {
    await loadModels();
    console.log(`  Chat model: ${chatModels()[0] || 'none found'} | Speech model: ${sttModels()[0] || 'none found'}\n`);
  }
});
