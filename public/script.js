(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  /* ================= Website ================= */
  const burger = $('#burger'), menu = $('#menu');
  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  menu.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') { menu.classList.remove('open'); burger.setAttribute('aria-expanded', false); }
  });

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }), { threshold: 0.12 })
    : null;
  const watchReveal = () => $$('.reveal:not(.in)').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  const fmt = (n) => new Intl.NumberFormat('en-PK').format(n);
  const initial = (n) => n.replace(/\bSir\b/g, '').trim().charAt(0).toUpperCase();

  fetch('/api/info').then((r) => r.json()).then((s) => {
    const all = [...s.teachers.first, ...s.teachers.second];
    $('#stats').innerHTML = [
      [2, 'Years'], [all.length, 'Teachers'], [s.subjects.length, 'Subjects'], [s.activities.length, 'Activities']
    ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');

    $('#subjectGrid').innerHTML = s.subjects.map((sub, i) => {
      const t1 = s.teachers.first.filter((t) => t.subject === sub.name).map((t) => t.name);
      const t2 = s.teachers.second.filter((t) => t.subject === sub.name).map((t) => t.name);
      const by = [t1.length ? `1st year: ${t1.join(', ')}` : '', t2.length ? `2nd year: ${t2.join(', ')}` : ''].filter(Boolean).join(' · ');
      return `<article class="card reveal" style="transition-delay:${i * 60}ms"><div class="tile">${sub.name.charAt(0)}</div><h3>${sub.name}</h3><p>${sub.blurb}</p><p class="by">${by}</p></article>`;
    }).join('');

    const grid = $('#teacherGrid');
    const render = (year) => {
      grid.innerHTML = s.teachers[year].map((t, i) =>
        `<li class="teacher" style="animation-delay:${i * 50}ms"><div class="avatar">${initial(t.name)}</div><div><b>${t.name}</b><span>${t.subject}</span></div></li>`
      ).join('');
    };
    render('first');
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('on', x === tab));
      render(tab.dataset.year);
    }));

    $('#feeGrid').innerHTML =
      `<div class="card fee reveal"><p class="lbl">First year</p><div class="amt">${fmt(s.fees.first)} <small>PKR</small></div></div>` +
      `<div class="card fee reveal" style="transition-delay:80ms"><p class="lbl">Second year</p><div class="amt">${fmt(s.fees.second)} <small>PKR</small></div></div>`;

    $('#actGrid').innerHTML = s.activities.map((a, i) =>
      `<div class="card reveal" style="transition-delay:${i * 70}ms"><div class="act-n">0${i + 1}</div><h3>${a}</h3></div>`
    ).join('');

    watchReveal();
  }).catch(() => {});
  watchReveal();

  /* ================= Voice widget ================= */
  const panel = $('#panel'), launcher = $('#launcher');
  const orb = $('#orb'), statusEl = $('#status'), chat = $('#chat');
  const form = $('#textForm'), input = $('#textInput');

  let state = 'idle', recorder = null, chunks = [], stream = null;
  let audioCtx = null, raf = 0, maxTimer = 0, history = [];
  const player = new Audio();
  player.preload = 'auto';

  function openChat(open) {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', !open);
    launcher.setAttribute('aria-expanded', open);
    if (!open) { if (state === 'recording') cancelRecording(); player.pause(); if (state === 'speaking') setState('idle'); }
  }
  launcher.addEventListener('click', () => openChat(!panel.classList.contains('open')));
  $('#closeChat').addEventListener('click', () => openChat(false));
  $$('[data-open-chat]').forEach((b) => b.addEventListener('click', () => openChat(true)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openChat(false); });

  const isUrdu = (t) => /[\u0600-\u06FF]/.test(t);
  const messages = { idle: 'Tap to speak', recording: 'Listening… tap to send', thinking: 'Thinking…', speaking: 'Speaking…' };

  function setState(s, text) {
    state = s;
    orb.dataset.state = s;
    statusEl.textContent = text || messages[s];
    if (s !== 'recording') orb.style.setProperty('--lvl', 0);
  }

  // iOS/Safari only allow audio started by a tap, so unlock the player on the tap itself
  function unlockAudio() {
    const rate = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    player.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    player.play().catch(() => {});
  }

  function playAudio(b64) {
    if (!b64) { setState('idle'); return; }
    player.onended = () => setState('idle');
    player.onerror = () => setState('idle', 'Could not play audio');
    player.src = 'data:audio/mpeg;base64,' + b64;
    setState('speaking');
    player.play().catch(() => setState('idle', 'Tap ▶ on the answer to listen'));
  }

  function addMsg(role, text, audio) {
    const row = document.createElement('div');
    row.className = 'msg ' + (role === 'user' ? 'user' : role === 'err' ? 'bot err' : 'bot');
    const b = document.createElement('div');
    b.className = 'bubble' + (isUrdu(text) ? ' ur' : '');
    b.textContent = text;
    row.appendChild(b);
    if (role === 'bot' && audio) {
      const btn = document.createElement('button');
      btn.className = 'replay';
      btn.setAttribute('aria-label', 'Play answer');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      btn.onclick = () => { if (state !== 'recording' && state !== 'thinking') playAudio(audio); };
      row.appendChild(btn);
    }
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
  }

  async function ask(fd, label) {
    setState('thinking');
    fd.append('history', JSON.stringify(history.slice(-6)));
    try {
      const res = await fetch('/api/ask', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error) throw new Error(data.error);
        throw new Error('Cannot reach the portal server (code ' + res.status + '). Run "npm start" and open http://localhost:3000 (do not use Live Server or open index.html directly).');
      }
      addMsg('user', data.transcript || label);
      addMsg('bot', data.answer, data.audio);
      history.push({ role: 'user', content: data.transcript }, { role: 'assistant', content: data.answer });
      playAudio(data.audio);
    } catch (e) {
      addMsg('err', e.name === 'TypeError'
        ? 'Cannot reach the portal server. Make sure "npm start" is running and you opened http://localhost:3000'
        : (e.message || 'Something went wrong. Please try again.'));
      setState('idle');
    }
  }

  const pickMime = () => {
    if (!window.MediaRecorder) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  };

  let cancelled = false;
  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      addMsg('err', 'Voice recording is not supported here. Please type your question, or open the site over HTTPS / localhost.');
      return;
    }
    try {
      unlockAudio();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      addMsg('err', 'Microphone permission is needed. Please allow the mic and try again.');
      return;
    }
    const mime = pickMime();
    chunks = []; cancelled = false;
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      cleanupMic();
      if (cancelled) { setState('idle'); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
      const fd = new FormData();
      fd.append('audio', blob, 'voice');
      ask(fd, '🎤');
    };
    recorder.start();
    setState('recording');
    visualize();
    maxTimer = setTimeout(stopRecording, 30000);
  }

  function stopRecording() {
    clearTimeout(maxTimer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  function cancelRecording() { cancelled = true; stopRecording(); }

  function cleanupMic() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  }

  function visualize() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const an = audioCtx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) { const d = (x - 128) / 128; sum += d * d; }
        orb.style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / data.length) * 4).toFixed(3));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* visual only */ }
  }

  orb.addEventListener('click', () => {
    if (state === 'idle' || state === 'speaking') { player.pause(); startRecording(); }
    else if (state === 'recording') stopRecording();
  });

  function sendText(text) {
    if (!text || state === 'thinking' || state === 'recording') return;
    unlockAudio();
    const fd = new FormData();
    fd.append('text', text);
    ask(fd, text);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    input.value = '';
    sendText(t);
  });

  const chips = ['Fees for first year?', 'Who teaches Physics?', 'Which activities do you have?', 'فرسٹ ایئر کی فیس کتنی ہے؟'];
  $('#chips').innerHTML = chips.map((c) => `<button class="chip" type="button">${c}</button>`).join('');
  $$('.chip').forEach((c) => c.addEventListener('click', () => sendText(c.textContent)));

  addMsg('bot', 'Assalam o Alaikum! Ask me about fees, teachers, subjects or activities.');
})();
 