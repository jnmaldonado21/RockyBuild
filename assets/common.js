/* Shared code for the crew page and the leadership page. */
(function () {
  const CFG = Object.assign(
    { apiUrl: '', title: 'Cut list', sheetUrl: '', pollSeconds: 30, maxBundle: 10, kerf: 0.125,
      appName: 'Tackle, Track, Complete', appShort: 'TTC' },
    window.CUT_CONFIG || {}
  );
  const DEMO = !CFG.apiUrl;

  const STATUSES = [
    { name: 'Not Started',      cls: 's-ns'  },
    { name: 'In Progress',      cls: 's-ip'  },
    { name: 'Cut',              cls: 's-cut' },
    { name: 'Bundled',          cls: 's-tag' },
    { name: 'Need to Purchase', cls: 's-buy' }
  ];
  const CLS = Object.fromEntries(STATUSES.map(s => [s.name, s.cls]));
  CLS['Tagged'] = 's-tag';
  // Older sheets may still say "Tagged"; treat it as Bundled everywhere.
  const normStatus = s => s === 'Tagged' ? 'Bundled' : (CLS[s] ? s : 'Not Started');
  function normalize(data) {
    (data.sheets || []).forEach(sh => sh.rows.forEach(r => { if (r.type === 'cut') r.status = normStatus(r.status); }));
    const legacy = x => x === 'Tagged' ? 'Bundled' : x;
    (data.log || []).forEach(e => { e.statusFrom = legacy(e.statusFrom); e.statusTo = legacy(e.statusTo); });
    data.units = data.units || [];
    data.claims = data.claims || [];
    return data;
  }

  /* ---------- Small utilities ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const NS = 'cutlist:' + (DEMO ? 'demo:' : 'live:');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(NS + k); } catch (e) {} }
  };

  /* ---------- Piece math (planner lives in planner.js) ---------- */
  const P = window.CutPlanner;
  const { parseInches, fmtIn, isSheetGood, effDone, leftToCut, lumberFor } = P;
  const pieceRange = (label, qty) => qty > 1 ? `${label}1–${label}${qty}` : `${label}1`;

  function bundlesFor(label, qty, max) {
    const out = [];
    for (let start = 1; start <= qty; start += max) {
      const end = Math.min(qty, start + max - 1);
      out.push({ range: start === end ? `${label}${start}` : `${label}${start}–${label}${end}`,
                 tape: start === end ? `${label} ${start}` : `${label} ${start}–${end}`, count: end - start + 1 });
    }
    return out;
  }

  // Lumber report + cut plan for the whole shop (areas mixed on boards, spare wood first).
  const lumberReport = (sheets, lumber, stock, stateOf) => P.report(sheets, lumber, stock, CFG.kerf, stateOf);
  const piecesLeftFor = (sheets, stateOf, size, area) =>
    (P.piecesLeft(sheets.filter(s => s.name === area), stateOf)[size] || []).length;

  /* ---------- Tape colors ---------- */
  const TAPE_HEX = {
    red: '#D62828', blue: '#1F5FD0', green: '#2E9E4F', yellow: '#F2C80F', orange: '#F07F13',
    purple: '#7B3FB5', pink: '#E8589A', black: '#20262D', white: '#FFFFFF', silver: '#A7AFB8',
    gray: '#8C959F', grey: '#8C959F', gold: '#D4A017', brown: '#8B5A2B', teal: '#12A0A0', lime: '#8BCB2D'
  };
  function tapeHex(name) {
    const n = String(name || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3,6}$/.test(n)) return n;
    for (const k of Object.keys(TAPE_HEX)) if (n.includes(k)) return TAPE_HEX[k];
    return '#8C959F';
  }
  function inkOn(hex) {
    const h = hex.replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.4 ? '#1C232B' : '#FFFFFF';
  }
  const swatch = (color, cls = '') =>
    `<span class="swatch ${cls}" style="--sw:${tapeHex(color)}" aria-hidden="true"></span>`;

  /* ---------- Time ---------- */
  function timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    if (s < 172800) return 'yesterday';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------- Photos ---------- */
  async function compressImage(file, max = 1600, quality = 0.72) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("That file couldn't be opened as a photo. Try a JPG or PNG."));
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const driveId = url => { const m = String(url || '').match(/\/d\/([\w-]+)/) || String(url || '').match(/[?&]id=([\w-]+)/); return m ? m[1] : null; };
  function photoThumb(url, w = 480) {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const id = driveId(url);
    return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${w}` : url;
  }
  const photoLink = url => url && url.startsWith('data:') ? null : url;

  /* ---------- API (live or demo) ---------- */
  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ redirect: 'follow' }, opts));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const demo = {
    state() {
      const s = store.get('demo-state', null);
      const out = s && s.sheets ? s : clone(window.CUT_DEMO);
      out.crew = (out.crew || []).map(c => typeof c === 'string' ? { name: c, pin: '1234', joined: '', active: true } : c);
      return out;
    },
    save(s) { if (!store.set('demo-state', s)) { s.log.forEach(l => { l.photo = ''; }); store.set('demo-state', s); } },
    view(view) {
      const s = this.state();
      const cutoff = Date.now() - 6 * 3600000;
      const out = { ok: true, sheets: s.sheets, crew: (s.crew || []).filter(c => c.active).map(c => c.name), tape: s.tape, lumber: s.lumber, stock: s.stock || [],
                    units: s.units || [], claims: (s.claims || []).filter(c => new Date(c.since).getTime() > cutoff), serverTime: new Date().toISOString() };
      if (view === 'lead') {
        out.lumber = s.lumber; out.log = s.log; out.messages = s.messages; out.safety = s.safety || [];
        out.crewInfo = (s.crew || []).map(c => ({ name: c.name, joined: c.joined, active: c.active, hasPin: !!c.pin }));
      }
      else out.messages = s.messages.filter(m => m.type === 'Question' && m.status === 'Answered' && m.reply);
      return clone(out);
    },
    post(p) {
      const s = this.state();
      const now = new Date().toISOString();
      const same = (a, b) => String(a).trim().replace(/\s+/g, ' ').toLowerCase() === String(b).trim().replace(/\s+/g, ' ').toLowerCase();
      if (p.action === 'signup') {
        const name = String(p.name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2) return { ok: false, error: 'Enter your first and last name.' };
        if (s.crew.some(c => same(c.name, name))) return { ok: false, error: `Someone named ${name} already signed up. If that's you, sign in with your PIN. If not, add a middle initial or nickname.` };
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        s.crew.push({ name, pin, joined: now, active: true });
        this.save(s);
        return { ok: true, name, userPin: pin };
      }
      if (p.action === 'resetPin') {
        if (String(p.pin) !== '1234') return { ok: false, error: 'That PIN is not right. In demo mode the PIN is 1234.' };
        const c = s.crew.find(x => same(x.name, p.name));
        if (!c) return { ok: false, error: 'No one by that name is on the crew list.' };
        c.pin = String(Math.floor(1000 + Math.random() * 9000));
        this.save(s);
        return { ok: true, name: c.name, userPin: c.pin };
      }
      if (['signin', 'signoff', 'message', 'safety', 'stockCount', 'claim', 'release'].includes(p.action)) {
        const me = s.crew.find(c => same(c.name, p.name || ''));
        if (!p.name || !p.userPin) return { ok: false, auth: true, error: 'Sign in with your name and PIN first.' };
        if (!me) return { ok: false, auth: true, error: `No one named ${p.name} is signed up. Tap "I'm new" to join.` };
        if (me.pin !== String(p.userPin)) return { ok: false, auth: true, error: `That PIN doesn't match ${me.name}. In demo mode, the sample crew's PINs are 1234.` };
        p.name = me.name;
        if (p.action === 'signin') return { ok: true, name: me.name };
      }
      if (p.action === 'signoff') {
        if (!p.name) return { ok: false, error: 'Add your name before saving.' };
        if (!p.photo || !p.photo.data) return { ok: false, error: 'Add a photo of the finished work before saving.' };
        const find = (sheet, label) => { const sh = s.sheets.find(x => x.name === sheet); return sh && sh.rows.find(r => r.type === 'cut' && r.label === label); };
        const findUnit = c => (s.units || []).find(u => u.area === c.sheet && u.unit === c.label);
        const conflicts = p.changes.filter(c => {
          if (c.kind === 'unit') { const u = findUnit(c); return !u || u.stage !== c.from.status; }
          const r = find(c.sheet, c.label); return !r || normStatus(r.status) !== c.from.status || r.done !== c.from.done; })
          .map(c => ({ sheet: c.sheet, label: c.label, reason: 'changed by someone else' }));
        if (conflicts.length) return { ok: false, conflicts, error: 'Some lines changed while you were working.' };
        const batch = Math.random().toString(16).slice(2, 10);
        p.changes.forEach(c => {
          if (c.kind === 'unit') {
            const u = findUnit(c);
            s.log.unshift({ time: now, batch, name: p.name, area: c.sheet, label: c.label, statusFrom: u.stage, statusTo: c.to.status, doneFrom: 0, doneTo: 0, photo: p.photo.data, note: p.note || '' });
            Object.assign(u, { stage: c.to.status, updated: now, by: p.name });
            if (['Built', 'Finished', 'Loaded in'].includes(c.to.status)) s.claims = (s.claims || []).filter(x => !(x.kind === 'unit' && x.area === c.sheet && x.item === c.label));
            return;
          }
          if (['Bundled', 'Need to Purchase'].includes(c.to.status)) s.claims = (s.claims || []).filter(x => !(x.kind === 'cut' && x.area === c.sheet && x.item === c.label));
          const r = find(c.sheet, c.label);
          s.log.unshift({ time: now, batch, name: p.name, area: c.sheet, label: c.label, statusFrom: r.status, statusTo: c.to.status,
                          doneFrom: r.done, doneTo: c.to.done, photo: p.photo.data, note: p.note || '' });
          Object.assign(r, { status: c.to.status, done: c.to.done, updated: now, by: p.name, photo: '' });
        });
        this.save(s);
        return { ok: true, batch };
      }
      if (p.action === 'message') {
        if (!p.name || !p.message) return { ok: false, error: 'Add your name and a message.' };
        s.messages.unshift({ time: now, id: Math.random().toString(16).slice(2, 10), name: p.name, type: p.type, area: p.area || '',
                             label: p.label || '', message: p.message, photo: p.photo ? p.photo.data : '', status: 'Open', reply: '', repliedBy: '', repliedAt: '' });
        this.save(s);
        return { ok: true };
      }
      if (p.action === 'safety') {
        if (!p.name) return { ok: false, error: 'Add your name to check in.' };
        s.safety = s.safety || [];
        s.safety.unshift({ time: now, name: p.name, items: (p.items || []).length });
        this.save(s);
        return { ok: true };
      }
      if (p.action === 'stockCount') {
        if (!p.name) return { ok: false, error: 'Add your name before saving the count.' };
        s.stock = s.stock || [];
        if (p.mode === 'replace') s.stock = s.stock.filter(x => x.size !== p.size);
        (p.boards || []).forEach(b => s.stock.push({ size: p.size, length: b.length, count: b.count, by: p.name, at: now }));
        this.save(s);
        return { ok: true };
      }
      if (p.action === 'claim') {
        if (!p.name) return { ok: false, error: 'Add your name first.' };
        s.claims = s.claims || [];
        const cur = s.claims.find(x => x.kind === p.kind && x.area === p.area && x.item === p.item);
        if (cur && cur.name !== p.name && !p.takeOver) return { ok: false, claimedBy: cur.name, since: cur.since, error: cur.name + ' is already on this.' };
        s.claims = s.claims.filter(x => !(x.kind === p.kind && x.area === p.area && x.item === p.item));
        s.claims.push({ kind: p.kind, area: p.area, item: p.item, name: p.name, since: now });
        this.save(s);
        return { ok: true };
      }
      if (p.action === 'release') {
        s.claims = (s.claims || []).filter(x => !(x.kind === p.kind && x.area === p.area && x.item === p.item));
        this.save(s);
        return { ok: true };
      }
      if (p.action === 'sendSummary') {
        if (String(p.pin) !== '1234') return { ok: false, error: 'That PIN is not right. In demo mode the PIN is 1234.' };
        return { ok: false, error: "Demo mode doesn't send email. Once the sheet is connected, this emails the summary to the address in the Settings tab." };
      }
      if (p.action === 'checkPin' || p.action === 'reply') {
        if (String(p.pin) !== '1234') return { ok: false, error: 'That PIN is not right. In demo mode the PIN is 1234.' };
        if (p.action === 'reply') {
          const m = s.messages.find(x => x.id === p.id);
          if (!m) return { ok: false, error: 'That message no longer exists.' };
          Object.assign(m, { reply: p.reply || '', status: p.reply ? 'Answered' : 'Closed', repliedBy: p.name || 'Leadership', repliedAt: now });
          this.save(s);
        }
        return { ok: true };
      }
      return { ok: false, error: 'Unknown action' };
    }
  };

  const api = {
    async get(view) {
      if (DEMO) { await sleep(120); return normalize(demo.view(view)); }
      const sep = CFG.apiUrl.includes('?') ? '&' : '?';
      const d = await fetchJSON(`${CFG.apiUrl}${sep}view=${encodeURIComponent(view)}&t=${Date.now()}`);
      if (!d || !d.ok) throw new Error((d && d.error) || 'Unexpected response');
      return normalize(d);
    },
    async post(payload) {
      if (DEMO) { await sleep(350); return demo.post(payload); }
      return fetchJSON(CFG.apiUrl, { method: 'POST', body: JSON.stringify(payload) });
    }
  };

  /* ---------- Shared UI ---------- */
  function tapeMeasure(id, label) {
    const nums = [10, 20, 30, 40, 50, 60, 70, 80, 90].map(n => `<span style="left:${n}%">${n}</span>`).join('');
    return `<div class="tape" id="${id}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${esc(label)}">
      <div class="tape-fill"></div><div class="tape-ticks"></div>
      <div class="tape-nums" aria-hidden="true">${nums}</div>
      <div class="tape-hook" aria-hidden="true"><span>0%</span></div></div>`;
  }
  function setTape(el, done, total) {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    el.querySelector('.tape-fill').style.width = pct + '%';
    el.querySelector('.tape-hook').style.left = pct + '%';
    const flag = el.querySelector('.tape-hook span');
    flag.style.setProperty('--p', pct);
    flag.textContent = pct + '%';
    el.setAttribute('aria-valuenow', pct);
    return pct;
  }
  function miniBar(done, total, color) {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    return `<span class="minibar" role="img" aria-label="${pct}% tagged"><span style="width:${pct}%;${color ? `background:${tapeHex(color)}` : ''}"></span></span>`;
  }

  function setSync(el, state, text) { el.dataset.state = state; el.textContent = text; }

  let toastTimer;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function duplicateLabels(sheets) {
    const seen = new Map();
    sheets.forEach(sh => sh.rows.forEach(r => {
      if (r.type !== 'cut') return;
      if (!seen.has(r.label)) seen.set(r.label, []);
      seen.get(r.label).push(sh.name);
    }));
    return [...seen].filter(([, where]) => where.length > 1);
  }

  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  window.Cut = {
    CFG, DEMO, STATUSES, CLS, normStatus, esc, clone, store, api, today,
    unitStatus: (sheets, units, stateOf) => P.unitStatus(sheets, units, stateOf), UNIT_STAGES: P.UNIT_STAGES,
    effDone, leftToCut, pieceRange, bundlesFor, parseInches, fmtIn, lumberFor, lumberReport, piecesLeftFor, isSheetGood,
    tapeHex, inkOn, swatch, timeAgo, compressImage, photoThumb, photoLink,
    tapeMeasure, setTape, miniBar, setSync, toast, duplicateLabels
  };
})();
