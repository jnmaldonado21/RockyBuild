(function () {
  const C = window.Cut;
  const $ = id => document.getElementById(id);
  const ALL = '__all__';
  const S = { sheets: [], crew: [], tape: {}, lumber: [], messages: [], index: new Map(), current: '', filter: null, sig: '', lastError: '', loaded: false,
              units: [], claims: [], warned: new Set(),
              view: ['list', 'plan', 'build'].includes(C.store.get('view', 'list')) ? C.store.get('view', 'list') : 'list' };
  const staged = new Map(Object.entries(C.store.get('staged', {})));
  const keyOf = (sheet, label) => sheet + '::' + label;
  let soPhoto = null, askPhoto = null, busy = false;

  /* ================= Loading ================= */
  async function load() {
    try {
      const d = await C.api.get('crew');
      S.sheets = d.sheets || [];
      S.crew = d.crew || [];
      S.tape = d.tape || {};
      S.lumber = d.lumber || [];
      S.stock = d.stock || [];
      S.units = d.units || [];
      S.claims = d.claims || [];
      S.messages = d.messages || [];
      S.index = new Map();
      S.sheets.forEach(sh => sh.rows.forEach(r => { if (r.type === 'cut') S.index.set(keyOf(sh.name, r.label), { sheet: sh.name, item: r }); }));
      S.lastError = '';
      S.loaded = true;
      buildPicker();
      showDuplicates();
      render();
      if ($('signoff').open) renderChangeList();
      if ($('ask').open) renderAnswers();
      if (!S.opened && decodeURIComponent(location.hash.slice(1)) === 'safety') openSafety();
      if (!S.opened) maybeFirstTour();
      S.opened = true;
    } catch (err) {
      console.error(err);
      S.lastError = "Can't reach the sheet. Retrying…";
    }
    updateSync();
    updateBar();
  }

  function updateSync() {
    const el = $('sync');
    if (S.lastError) return C.setSync(el, 'err', S.lastError);
    if (!S.loaded) return C.setSync(el, 'busy', 'Loading…');
    if (C.DEMO) return C.setSync(el, 'demo', 'Demo: saves stay on this device');
    C.setSync(el, 'ok', 'Up to date');
  }

  /* ================= Area picker ================= */
  function buildPicker() {
    const sel = $('area');
    const names = S.sheets.map(s => s.name);
    const sig = names.join('|');
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.innerHTML = '<option value="">Choose an area…</option>' +
      names.map(n => `<option value="${C.esc(n)}">${C.esc(n)}</option>`).join('') +
      `<option value="${ALL}">All areas</option>`;
    let target = S.current;
    if (!target) {
      const h = decodeURIComponent(location.hash.slice(1));
      target = h === 'all' ? ALL : names.includes(h) ? h : '';
    }
    if (target && target !== ALL && !names.includes(target)) target = '';
    sel.value = target;
    S.current = target;
  }

  $('area').addEventListener('change', e => {
    S.current = e.target.value;
    S.filter = null;
    S.sig = '';
    try {
      const url = S.current === ALL ? '#all' : S.current ? '#' + encodeURIComponent(S.current) : location.pathname + location.search;
      history.replaceState(null, '', url);
    } catch (ignored) {}
    render();
  });

  function showDuplicates() {
    const dups = C.duplicateLabels(S.sheets).filter(([, where]) => S.current === ALL || where.includes(S.current));
    const box = $('notice');
    box.hidden = !dups.length;
    if (dups.length) {
      box.innerHTML = '<strong>Some labels are used in more than one area,</strong> so bundles could get mixed up: ' +
        dups.map(([l, where]) => `${C.esc(l)} (${where.map(C.esc).join(', ')})`).join('; ') + '. Check with leadership before labeling these.';
    }
  }

  /* ================= Rendering ================= */
  const shown = (key, it) => staged.has(key) ? staged.get(key).to : { status: it.status, done: it.done };

  function blocks() {
    if (!S.current) return [];
    const list = S.current === ALL ? S.sheets : S.sheets.filter(s => s.name === S.current);
    return list.map(sh => ({ sheet: sh.name, rows: sh.rows }));
  }

  function render() {
    const has = !!S.current;
    $('view').hidden = !has;
    $('empty').hidden = has;
    renderBanner();
    showDuplicates();
    if (!has) return;

    const bl = blocks();
    const sig = S.current + '|' + bl.map(b => b.sheet + ':' + b.rows.map(r => r.type === 'cut' ? 'c' + r.label + r.qty : 's' + r.text).join(',')).join(';');
    if (sig !== S.sig) {
      S.sig = sig;
      const multi = S.current === ALL;
      const html = [];
      bl.forEach(b => {
        if (multi) {
          html.push(`<tr class="group" data-sheet="${C.esc(b.sheet)}"><th colspan="6" scope="rowgroup"><div class="group-inner">
            <span class="group-name">${S.tape[b.sheet] ? C.swatch(S.tape[b.sheet]) : ''}${C.esc(b.sheet)}</span><span class="group-prog"></span></div></th></tr>`);
        }
        b.rows.forEach(r => html.push(r.type === 'section'
          ? `<tr class="section"><th colspan="6" scope="rowgroup">${C.esc(r.text)}</th></tr>`
          : rowHTML(b.sheet, r)));
      });
      $('rows').innerHTML = html.join('');
    }
    if (!$('tapeSlot').firstChild) $('tapeSlot').innerHTML = C.tapeMeasure('tape', 'Pieces labeled and bundled');
    refresh();
  }

  /* ================= Cut plan ================= */
  function setView(v) {
    S.view = v;
    C.store.set('view', v);
    $('tabList').setAttribute('aria-selected', v === 'list');
    $('tabPlan').setAttribute('aria-selected', v === 'plan');
    $('tabBuild').setAttribute('aria-selected', v === 'build');
    $('checklist').hidden = v !== 'list';
    $('plan').hidden = v !== 'plan';
    $('build').hidden = v !== 'build';
    $('chips').hidden = v !== 'list';
    $('filterNote').hidden = v !== 'list' || !S.filter;
    if (v === 'plan') renderPlan();
    if (v === 'build') renderBuild();
  }
  $('tabList').addEventListener('click', () => setView('list'));
  $('tabPlan').addEventListener('click', () => setView('plan'));
  $('tabBuild').addEventListener('click', () => setView('build'));
  $('tabList').parentElement.addEventListener('keydown', e => {
    const order = ['list', 'plan', 'build'], ids = { list: 'tabList', plan: 'tabPlan', build: 'tabBuild' };
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = order[(order.indexOf(S.view) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
    setView(next); $(ids[next]).focus();
  });

  function stockLine(r) {
    if (!r.onHand) return `${C.esc(r.size)}: not counted yet`;
    return `${C.esc(r.size)}: ${r.onHand} ${r.sheet ? 'sheets' : 'boards'}${r.countedAt ? `, counted ${C.esc(C.timeAgo(r.countedAt))} by ${C.esc(r.countedBy)}` : ''}`;
  }

  function renderPlan() {
    if (S.view !== 'plan' || !S.current) return;
    const stateOf = (sheet, r) => shown(keyOf(sheet, r.label), r);
    const report = C.lumberReport(S.sheets, S.lumber, S.stock, stateOf);
    const area = S.current === ALL ? null : S.current;
    const showAll = S.showAllBoards || !area;
    const colorOf = a => C.tapeHex(S.tape[a]);

    const head = `<div class="area-banner" style="margin-top:18px">
      <p><strong>Spare wood on hand.</strong> ${report.filter(r => !r.sheet || r.onHand).map(stockLine).join('. ') || 'Nothing counted yet'}.</p>
      <button type="button" class="btn-quiet" id="openStock">Count spare wood</button></div>
      ${area ? `<p class="plan-note">Showing boards with ${C.esc(area)} pieces. Some boards also hold pieces for other areas, marked by their tape color. Put every piece in its own area's stack.
        <button type="button" class="linkish" id="toggleAllBoards">${showAll ? `Show only ${C.esc(area)}` : 'Show every board in the shop'}</button></p>` : ''}`;

    const areaDims = new Set();
    S.sheets.filter(sh => sh.name === area).forEach(sh => sh.rows.forEach(r => { if (r.type === 'cut') areaDims.add(r.dim); }));
    const sizes = report.map(r => {
      if (area && !showAll && !areaDims.has(r.size)) return '';
      const relevant = pt => showAll || pt.pieces.some(p => p.area === area);
      if (!r.left) return `<div class="plan-size"><div class="plan-size-head"><h4>${C.esc(r.size)}</h4></div><p class="plan-done">Every ${C.esc(r.size)} piece is cut.</p></div>`;
      if (r.sheet) {
        const mine = area && !showAll ? C.piecesLeftFor(S.sheets, stateOf, r.size, area) : r.left;
        return `<div class="plan-size"><div class="plan-size-head"><h4>${C.esc(r.size)}</h4>
          <p>${mine} full ${mine === 1 ? 'sheet' : 'sheets'} still needed${area && !showAll ? ` for ${C.esc(area)}` : ''}, no cutting. ${r.onHand ? `${r.fromStock} can come from spare sheets.` : ''}</p></div></div>`;
      }
      const plan = r.plan;
      const newName = r.boardLength % 12 === 0 ? `${r.boardLength / 12}' boards` : `${C.fmtIn(r.boardLength)} boards`;
      const pats = plan.patterns.filter(relevant);
      const block = kind => {
        const list = pats.filter(pt => pt.kind === kind);
        if (!list.length) return '';
        const title = kind === 'stock' ? 'From spare wood (use these first)' : `From new ${newName}`;
        return `<p class="plan-group">${title}</p>` + list.map(pt => patternHTML(pt, area, colorOf, kind)).join('');
      };
      const hidden = plan.patterns.length - pats.length;
      const warn = [];
      if (plan.tooLong.length) warn.push(`${plan.tooLong.length} ${plan.tooLong.length === 1 ? 'piece is' : 'pieces are'} longer than any board on hand (${[...new Set(plan.tooLong.map(p => p.label))].join(', ')}). Ask leadership.`);
      if (plan.unknown.length) warn.push(`${plan.unknown.length} ${plan.unknown.length === 1 ? 'piece has' : 'pieces have'} no readable length (${[...new Set(plan.unknown.map(p => p.label))].join(', ')}).`);
      if (plan.stockLeft.length) warn.push(`${plan.stockLeft.length} spare ${plan.stockLeft.length === 1 ? 'board isn\'t' : 'boards aren\'t'} needed for any remaining cut.`);
      return `<div class="plan-size"><div class="plan-size-head"><h4>${C.esc(r.size)}</h4>
          <p>${r.left} ${r.left === 1 ? 'piece' : 'pieces'} still to cut: ${r.fromStock ? `${r.fromStock} spare ${r.fromStock === 1 ? 'board' : 'boards'} + ` : ''}${r.newBoards} new ${newName}</p></div>
        ${block('stock')}${block('new')}
        ${hidden && !showAll && !pats.length ? `<p class="plan-done" style="color:var(--muted)">No ${C.esc(r.size)} pieces left for ${C.esc(area)}.</p>` : ''}
        ${warn.map(w => `<p class="plan-note" style="padding:0 14px 12px">${C.esc(w)}</p>`).join('')}</div>`;
    }).join('');

    $('plan').innerHTML = head + sizes + `<p class="plan-note">The plan covers pieces that still need cutting, so it changes as the crew signs off or counts more spare wood.
      Every cut allows ${C.fmtIn(C.CFG.kerf)} for the blade. Cut the longest piece on each board first.</p>`;
  }

  function patternHTML(pt, area, colorOf, kind) {
    const kerf = C.CFG.kerf, len = pt.len;
    const used = pt.pieces.reduce((a, p) => a + p.len, 0) + kerf * pt.pieces.length;
    const exact = used > len + 1e-9;
    const areas = [...new Set(pt.pieces.map(p => p.area))];
    const nameAreas = areas.length > 1 || (area && areas[0] !== area) || !area;
    const segs = pt.pieces.map((p, i) => {
      const w = p.len / len * 100;
      const text = w > 28 ? `${p.label} ${C.fmtIn(p.len)}` : w > 7 ? p.label : '';
      return `<span class="seg${exact && i === pt.pieces.length - 1 ? ' last-exact' : ''}" style="width:${w.toFixed(3)}%;--area:${colorOf(p.area)}" title="${C.esc(p.label)} ${C.esc(C.fmtIn(p.len))}, ${C.esc(p.area)}">${C.esc(text)}</span>`;
    }).join('');
    const off = pt.offcut;
    const offText = off < 0.0625 ? 'no offcut' : `offcut ${C.fmtIn(off)}${off >= 24 ? ', keep it as spare wood' : ''}`;
    const desc = pt.pieces.map(p => `${p.label} ${C.fmtIn(p.len)}${nameAreas ? ` (${p.area})` : ''}`).join(' + ');
    const boardName = kind === 'stock' ? `${C.fmtIn(len)} spare` : 'new';
    return `<div class="pattern">
      <div class="pattern-count"><b>×${pt.count}</b><span>${boardName}</span></div>
      <div><div class="board" role="img" aria-label="${C.esc(C.fmtIn(len))} board: ${C.esc(desc)}, ${C.esc(offText)}">${segs}</div>
        <p class="pattern-text"><strong>${C.esc(desc)}</strong> <span class="off">(${C.esc(offText)})</span></p>
        ${(() => { const who = [...new Set(pt.pieces.map(p => { const c = claimOf('cut', p.area, p.label); return c ? `${c.name} is on ${p.label}` : ''; }).filter(Boolean))];
          return who.length ? `<p class="claim other" style="margin-top:4px">${C.esc(who.join('; '))}</p>` : ''; })()}</div>
    </div>`;
  }

  $('plan').addEventListener('click', e => {
    if (e.target.id === 'toggleAllBoards') { S.showAllBoards = !S.showAllBoards; renderPlan(); }
    if (e.target.id === 'openStock') openStock();
  });

  /* ================= Count spare wood ================= */
  function stockSizes() {
    const set = [];
    S.sheets.forEach(sh => sh.rows.forEach(r => { if (r.type === 'cut' && r.dim && !set.includes(r.dim)) set.push(r.dim); }));
    (S.stock || []).forEach(x => { if (!set.includes(x.size)) set.push(x.size); });
    return set;
  }

  function stockRowHTML(sheet, len = '', count = '') {
    return `<div class="stock-row">
      ${sheet ? '<span class="stock-len">Full sheets</span>' : `<label class="sr-only">Length</label><input type="text" class="stock-len" inputmode="decimal" placeholder="Length, e.g. 72 or 6' 2&quot;" value="${C.esc(len)}">`}
      <label class="sr-only">How many</label><input type="number" class="stock-count" inputmode="numeric" min="1" placeholder="How many" value="${C.esc(count)}">
      ${sheet ? '' : '<button type="button" class="icon-btn stock-del" aria-label="Remove this length">×</button>'}
      <span class="stock-parsed"></span>
    </div>`;
  }

  function renderStockForm() {
    const size = $('stSize').value;
    const sheet = C.isSheetGood(size) || !C.lumberFor(S.lumber, size).boardLength;
    const cur = (S.stock || []).filter(x => x.size === size && x.count > 0);
    $('stCurrent').innerHTML = cur.length
      ? `On file for ${C.esc(size)}: ${cur.map(x => sheet ? `${x.count} sheets` : `${C.esc(C.fmtIn(x.length))} ×${x.count}`).join(', ')}.`
      : `Nothing on file for ${C.esc(size)} yet.`;
    $('stRows').innerHTML = stockRowHTML(sheet);
    $('stAddRow').hidden = sheet;
    $('stQuick').hidden = sheet;
    updateStockButton();
  }

  function readStockRows() {
    const size = $('stSize').value;
    const sheet = C.isSheetGood(size) || !C.lumberFor(S.lumber, size).boardLength;
    const rows = [];
    let bad = 0;
    document.querySelectorAll('#stRows .stock-row').forEach(row => {
      const count = parseInt(row.querySelector('.stock-count').value, 10);
      const lenEl = row.querySelector('input.stock-len');
      const raw = lenEl ? lenEl.value.trim() : '';
      const len = sheet ? 0 : C.parseInches(raw);
      const out = row.querySelector('.stock-parsed');
      if (!sheet && raw) out.textContent = isNaN(len) ? 'Can\'t read that length' : `= ${C.fmtIn(len)}`;
      else out.textContent = '';
      if (!raw && !count) return;
      if ((!sheet && (isNaN(len) || len < 1)) || !(count > 0)) { bad++; return; }
      rows.push({ length: sheet ? 0 : Math.floor(len * 2) / 2, count });
    });
    return { size, sheet, rows, bad };
  }

  function updateStockButton() {
    const { rows, bad } = readStockRows();
    const name = getName('st');
    $('stSave').disabled = !rows.length || bad > 0 || !name || busy;
    const total = rows.reduce((a, r) => a + r.count, 0);
    $('stHint').textContent = busy ? 'Saving…' : bad ? 'Fix the rows marked above.' : !rows.length ? 'Add at least one length and count.'
      : !name ? 'Sign in to save.' : `${total} ${total === 1 ? 'board' : 'boards'}, saving as ${name}.`;
  }

  function openStock() {
    showError('stError', '');
    const sizes = stockSizes();
    $('stSize').innerHTML = sizes.map(z => `<option value="${C.esc(z)}">${C.esc(z)}</option>`).join('');
    renderNameField('st', updateStockButton);
    renderStockForm();
    $('stock').showModal();
  }

  $('stSize').addEventListener('change', renderStockForm);
  $('stRows').addEventListener('input', updateStockButton);
  $('stRows').addEventListener('click', e => {
    if (e.target.classList.contains('stock-del')) {
      e.target.closest('.stock-row').remove();
      if (!document.querySelector('#stRows .stock-row')) $('stRows').insertAdjacentHTML('beforeend', stockRowHTML(false));
      updateStockButton();
    }
  });
  $('stAddRow').addEventListener('click', () => {
    $('stRows').insertAdjacentHTML('beforeend', stockRowHTML(false));
    const inputs = document.querySelectorAll('#stRows input.stock-len');
    inputs[inputs.length - 1].focus();
  });
  $('stQuick').addEventListener('click', e => {
    const len = e.target.dataset.len;
    if (!len) return;
    const empty = [...document.querySelectorAll('#stRows input.stock-len')].find(i => !i.value.trim());
    if (empty) empty.value = len; else $('stRows').insertAdjacentHTML('beforeend', stockRowHTML(false, len));
    const row = (empty || [...document.querySelectorAll('#stRows input.stock-len')].pop()).closest('.stock-row');
    row.querySelector('.stock-count').focus();
    updateStockButton();
  });
  document.querySelectorAll('input[name="stMode"]').forEach(r => r.addEventListener('change', updateStockButton));

  $('stSave').addEventListener('click', async () => {
    const { size, rows, bad } = readStockRows();
    const name = getName('st');
    if (!rows.length || bad || !name || busy) return;
    const mode = document.querySelector('input[name="stMode"]:checked').value;
    if (mode === 'replace' && (S.stock || []).some(x => x.size === size && x.count > 0) &&
        !confirm(`Replace the ${size} count on file with this one? Use this when you've counted every ${size} on the rack.`)) return;
    busy = true; updateStockButton(); showError('stError', '');
    try {
      const res = await post({ action: 'stockCount', name, size, mode, boards: rows });
      if (!res.ok) throw Object.assign(new Error(res.error || 'The sheet rejected the count.'), { shown: true });
      C.store.set('name', name);
      $('stock').close();
      C.toast(`Saved the ${size} count. The cut plan is updated.`);
      await load();
    } catch (err) {
      showError('stError', err.shown ? err.message : "Couldn't reach the sheet. Your count is still here. Try again when you have signal.");
    }
    busy = false;
    updateStockButton();
  });

  function renderBanner() {
    const box = $('areaBanner');
    if (!S.current) { box.hidden = true; return; }
    box.hidden = false;
    if (S.current === ALL) {
      box.innerHTML = `<p>Each area has its own tape color.</p><div class="tapes">${S.sheets.map(s =>
        `<span>${C.swatch(S.tape[s.name])}${C.esc(s.name)}: ${C.esc(S.tape[s.name] || 'not set')}</span>`).join('')}</div>
        <button type="button" class="linkish" data-guide>How to label and bundle</button>`;
      return;
    }
    const color = S.tape[S.current];
    box.innerHTML = color
      ? `${C.swatch(color, 'lg')}<p><strong>${C.esc(S.current)}</strong> bundles get <strong>${C.esc(color.toLowerCase())}</strong> tape.</p>
         <button type="button" class="linkish" data-guide>How to label and bundle</button>`
      : `<p>No tape color is set for ${C.esc(S.current)} yet. Ask leadership before bundling.</p>`;
  }

  function rowHTML(sheet, it) {
    const key = keyOf(sheet, it.label);
    const opts = C.STATUSES.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    const qty = it.qty > 1
      ? `<div class="counter">
           <button type="button" class="dec" aria-label="One fewer ${C.esc(it.label)} bundled">−</button>
           <span class="count" aria-live="polite"><b>0</b> / ${it.qty}</span>
           <button type="button" class="inc" aria-label="One more ${C.esc(it.label)} bundled">+</button>
         </div>`
      : `<span class="count single">1 piece</span>`;
    return `<tr class="cut" data-key="${C.esc(key)}">
      <td class="c-status"><select class="status" aria-label="Status for ${C.esc(it.label)}, ${C.esc(it.use)}">${opts}</select><span class="unsaved-tag" hidden>Not saved yet</span></td>
      <td class="c-label"><b>${C.esc(it.label)}</b><small>${C.esc(C.pieceRange(it.label, it.qty))}</small></td>
      <td class="c-use">${C.esc(it.use)}<span class="meta"></span><span class="claim-slot"></span></td>
      <td class="c-dim">${C.esc(it.dim)}</td>
      <td class="c-len">${it.length ? C.esc(it.length) : '<span class="na">—</span>'}</td>
      <td class="c-qty">${qty}</td>
    </tr>`;
  }

  function refresh() {
    if (!S.current) return;
    const active = document.activeElement;

    document.querySelectorAll('#rows tr.cut').forEach(tr => {
      const ref = S.index.get(tr.dataset.key);
      if (!ref) return;
      const it = ref.item;
      const st = shown(tr.dataset.key, it);
      const cls = C.CLS[st.status] || 's-ns';
      const isStaged = staged.has(tr.dataset.key);
      tr.className = 'cut ' + cls + (isStaged ? ' staged' : '');
      const sel = tr.querySelector('select.status');
      if (sel !== active) sel.value = st.status;
      sel.className = 'status ' + cls;
      tr.querySelector('.unsaved-tag').hidden = !isStaged;
      const eff = C.effDone(st, it.qty);
      const b = tr.querySelector('.count b');
      if (b) {
        b.textContent = eff;
        tr.querySelector('.dec').disabled = eff <= 0;
        tr.querySelector('.inc').disabled = eff >= it.qty;
      }
      tr.querySelector('.meta').textContent = it.by ? `Last signed off by ${it.by}, ${C.timeAgo(it.updated)}` : '';
      const slot = tr.querySelector('.claim-slot');
      const html = claimHTML('cut', ref.sheet, it.label, st.status === 'Bundled');
      if (slot.dataset.html !== html) { slot.innerHTML = html; slot.dataset.html = html; }
      tr.hidden = !!S.filter && st.status !== S.filter;
    });

    // Hide headers with nothing visible below them
    let section = null, group = null, sHas = false, gHas = false;
    const closeS = () => { if (section) section.hidden = !sHas; };
    const closeG = () => { if (group) group.hidden = !gHas; };
    document.querySelectorAll('#rows tr').forEach(tr => {
      if (tr.classList.contains('group')) { closeS(); closeG(); group = tr; gHas = false; section = null; sHas = false; }
      else if (tr.classList.contains('section')) { closeS(); section = tr; sHas = false; }
      else if (!tr.hidden) { sHas = true; gHas = true; }
    });
    closeS(); closeG();

    let done = 0, total = 0;
    const counts = Object.fromEntries(C.STATUSES.map(s => [s.name, 0]));
    const perSheet = {};
    blocks().forEach(b => b.rows.forEach(r => {
      if (r.type !== 'cut') return;
      const st = shown(keyOf(b.sheet, r.label), r);
      const e = C.effDone(st, r.qty);
      done += e; total += r.qty;
      counts[st.status] = (counts[st.status] || 0) + 1;
      perSheet[b.sheet] = perSheet[b.sheet] || { d: 0, t: 0 };
      perSheet[b.sheet].d += e; perSheet[b.sheet].t += r.qty;
    }));
    document.querySelectorAll('#rows tr.group').forEach(tr => {
      const p = perSheet[tr.dataset.sheet] || { d: 0, t: 0 };
      tr.querySelector('.group-prog').textContent = `${p.d} of ${p.t} bundled`;
    });
    $('pDone').textContent = done;
    $('pTotal').textContent = total;
    C.setTape($('tape'), done, total);
    renderPlan();
    renderBuild();

    $('chips').innerHTML = C.STATUSES.map(s => {
      const pressed = S.filter === s.name;
      const n = counts[s.name] || 0;
      return `<button type="button" class="chip ${s.cls}" data-status="${s.name}" aria-pressed="${pressed}" ${n === 0 && !pressed ? 'disabled' : ''}>
        <i aria-hidden="true"></i>${s.name} <b>${n}</b></button>`;
    }).join('');
    const note = $('filterNote');
    note.hidden = !S.filter || S.view !== 'list';
    $('chips').hidden = S.view !== 'list';
    if (S.filter) note.innerHTML = `Showing only ${C.esc(S.filter)}. <button type="button" class="linkish" id="clearFilter">Show everything</button>`;
  }

  /* ================= Editing (staged until sign-off) ================= */
  function warnClaim(kind, area, item, key) {
    const c = claimOf(kind, area, item);
    if (!c || c.name === meName() || S.warned.has(key)) return true;
    if (!confirm(`${c.name} is working on ${item}. Make changes anyway?`)) return false;
    S.warned.add(key);
    return true;
  }

  function change(key, fn) {
    const ref = S.index.get(key);
    if (!ref) return;
    const it = ref.item;
    if (!staged.has(key) && !warnClaim('cut', ref.sheet, it.label, key)) { refresh(); return; }
    let s = staged.get(key);
    const cur = s ? Object.assign({}, s.to) : { status: it.status, done: it.done };
    fn(cur, it.qty);
    if (!s) s = { sheet: ref.sheet, label: it.label, row: it.row, from: { status: it.status, done: it.done } };
    s.to = cur;
    if (s.to.status === s.from.status && s.to.done === s.from.done) staged.delete(key);
    else staged.set(key, s);
    C.store.set('staged', Object.fromEntries(staged));
    refresh();
    updateBar();
  }

  $('rows').addEventListener('change', e => {
    if (!e.target.matches('select.status')) return;
    const v = e.target.value;
    change(e.target.closest('tr').dataset.key, cur => {
      cur.status = v;
      if (v === 'Not Started') cur.done = 0;
    });
  });

  $('rows').addEventListener('click', e => {
    const btn = e.target.closest('button.inc, button.dec');
    if (!btn) return;
    const delta = btn.classList.contains('inc') ? 1 : -1;
    change(btn.closest('tr').dataset.key, (cur, qty) => {
      const next = Math.min(qty, Math.max(0, C.effDone(cur, qty) + delta));
      cur.done = next;
      if (next === qty) cur.status = 'Bundled';
      else if (cur.status === 'Bundled' || (cur.status === 'Not Started' && next > 0)) cur.status = 'In Progress';
    });
  });

  $('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    S.filter = S.filter === chip.dataset.status ? null : chip.dataset.status;
    refresh();
  });
  $('filterNote').addEventListener('click', e => { if (e.target.id === 'clearFilter') { S.filter = null; refresh(); } });

  function updateBar() {
    const n = staged.size;
    $('savebar').hidden = n === 0;
    document.body.classList.toggle('has-savebar', n > 0);
    $('stagedCount').textContent = n;
    $('stagedWord').textContent = n === 1 ? 'change' : 'changes';
  }

  $('discardBtn').addEventListener('click', () => {
    if (!confirm(`Discard ${staged.size === 1 ? 'this change' : 'these ' + staged.size + ' changes'}? Nothing has been saved yet.`)) return;
    staged.clear();
    C.store.set('staged', {});
    refresh();
    updateBar();
  });

  /* ================= Identity: sign up / sign in with a 4-digit PIN ================= */
  const me = () => { const u = C.store.get('me', null); return u && u.name && u.pin ? u : null; };
  const meName = () => (me() || {}).name || '';
  const nameFields = {};
  let authThen = null, authMode = 'in';

  // Every crew write carries the signed-in name and PIN; the sheet checks them.
  async function post(payload) {
    const u = me();
    const res = await C.api.post(Object.assign({}, payload, u ? { name: u.name, userPin: u.pin } : {}));
    if (res && res.auth) { C.store.del('me'); refreshIdentity(); openAuth(res.error); }
    return res;
  }

  function renderNameField(prefix, onInput) {
    nameFields[prefix] = onInput;
    const box = $(prefix + 'NameField');
    if (!box) return;
    const u = me();
    box.innerHTML = u
      ? `<span class="field-label">Signed in as</span><p class="me-line"><strong>${C.esc(u.name)}</strong> <button type="button" class="linkish" data-switch>Not you? Switch</button></p>`
      : `<span class="field-label">Who's saving this?</span><button type="button" class="btn-quiet" data-signin>Sign in or join the crew</button>
         <p class="hint" style="margin-top:6px">Saving needs your name and 4-digit PIN.</p>`;
    box.querySelector('[data-switch], [data-signin]').addEventListener('click', e => {
      if (e.target.hasAttribute('data-switch')) { C.store.del('me'); refreshIdentity(); }
      openAuth('');
    });
    onInput();
  }
  const getName = () => meName();

  function refreshIdentity() {
    const u = me();
    $('whoLine').innerHTML = u
      ? `Signed in as <strong>${C.esc(u.name)}</strong>. <button type="button" class="linkish" id="signOutBtn">Sign out</button>`
      : `<button type="button" class="linkish" id="signInBtn">Sign in or join the crew</button> to save work.`;
    Object.keys(nameFields).forEach(prefix => {
      const dlg = $(prefix + 'NameField') && $(prefix + 'NameField').closest('dialog');
      if (dlg && dlg.open) renderNameField(prefix, nameFields[prefix]);
    });
    refresh();
  }
  $('whoLine').addEventListener('click', e => {
    if (e.target.id === 'signOutBtn') {
      if (!confirm('Sign out on this device? You\'ll need your PIN to sign back in.')) return;
      C.store.del('me'); refreshIdentity();
    }
    if (e.target.id === 'signInBtn') openAuth('');
  });

  function withUser(fn) {
    if (me()) return fn(meName());
    openAuth('', () => fn(meName()));
  }

  function openAuth(msg, then) {
    if (then) authThen = then;
    authMode = S.crew.length ? 'in' : 'new';
    renderAuth();
    showError('authError', msg || '');
    if (!$('auth').open) $('auth').showModal();
  }

  function renderAuth(newPin) {
    const last = C.store.get('name', '');
    $('authTitle').textContent = newPin ? "You're on the crew" : authMode === 'in' ? 'Sign in' : 'Join the crew';
    $('authTabs').hidden = !!newPin;
    document.querySelectorAll('input[name="authMode"]').forEach(r => { r.checked = r.value === authMode; });
    if (newPin) {
      $('authBody').innerHTML = `<p style="margin-top:0">Welcome, <strong>${C.esc(meName())}</strong>. Your PIN is:</p>
        <p class="big-pin" aria-label="Your PIN is ${newPin.split('').join(' ')}">${C.esc(newPin)}</p>
        <p><strong>Write it down or take a screenshot now.</strong> This phone remembers you, but you'll need the PIN on any other phone or if you sign out. If you forget it, the shop lead can give you a new one.</p>`;
      $('authGo').textContent = 'Continue';
      $('authGo').disabled = false;
      $('authGo').dataset.mode = 'done';
      return;
    }
    if (authMode === 'in') {
      $('authBody').innerHTML = S.crew.length
        ? `<div class="field"><label for="authName">Your name</label>
             <select id="authName"><option value="">Choose your name…</option>${S.crew.map(n => `<option value="${C.esc(n)}" ${n === last ? 'selected' : ''}>${C.esc(n)}</option>`).join('')}</select></div>
           <div class="field"><label for="authPin">Your 4-digit PIN</label>
             <input type="password" id="authPin" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>
           <p class="hint">Not on the list? Tap <strong>I'm new</strong>. Forgot your PIN? Ask the shop lead for a new one.${C.DEMO ? ' In demo mode, the sample crew PINs are 1234.' : ''}</p>`
        : `<p class="hint">Nobody has joined yet. Tap <strong>I'm new</strong> to be the first.</p>`;
      $('authGo').textContent = 'Sign in';
    } else {
      $('authBody').innerHTML = `<div class="field"><label for="authNew">First and last name</label>
          <input type="text" id="authNew" autocomplete="name" maxlength="60" placeholder="e.g. Sam Patel"></div>
        <p class="hint">You'll get a 4-digit PIN. It's how the crew knows a sign-off is really yours. If someone already has your name, add a middle initial or nickname.</p>`;
      $('authGo').textContent = 'Get my PIN';
    }
    $('authGo').dataset.mode = authMode;
    updateAuthButton();
  }

  function updateAuthButton() {
    const mode = $('authGo').dataset.mode;
    if (mode === 'done') return;
    $('authGo').disabled = busy || (mode === 'in'
      ? !($('authName') && $('authName').value && /^\d{4}$/.test(($('authPin') || {}).value || ''))
      : (($('authNew') || {}).value || '').trim().length < 2);
  }
  $('authBody').addEventListener('input', updateAuthButton);
  $('authBody').addEventListener('change', updateAuthButton);
  $('authBody').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('authGo').disabled) $('authGo').click(); });
  document.querySelectorAll('input[name="authMode"]').forEach(r => r.addEventListener('change', () => {
    authMode = r.value; showError('authError', ''); renderAuth();
    const first = $('authBody').querySelector('input, select'); if (first) first.focus();
  }));

  $('authGo').addEventListener('click', async () => {
    const mode = $('authGo').dataset.mode;
    if (mode === 'done') { finishAuth(); return; }
    if (busy) return;
    busy = true; $('authGo').disabled = true; showError('authError', '');
    try {
      if (mode === 'in') {
        const name = $('authName').value, pin = $('authPin').value.trim();
        const res = await C.api.post({ action: 'signin', name, userPin: pin });
        if (!res.ok) throw Object.assign(new Error(res.error), { shown: true });
        C.store.set('me', { name: res.name || name, pin });
        C.store.set('name', res.name || name);
        finishAuth();
      } else {
        const name = $('authNew').value.trim().replace(/\s+/g, ' ');
        const res = await C.api.post({ action: 'signup', name });
        if (!res.ok) throw Object.assign(new Error(res.error), { shown: true });
        C.store.set('me', { name: res.name, pin: res.userPin });
        C.store.set('name', res.name);
        if (!S.crew.includes(res.name)) S.crew.push(res.name);
        renderAuth(res.userPin);
      }
    } catch (err) {
      showError('authError', err.shown ? err.message : "Couldn't reach the sheet. Try again when you have signal.");
    }
    busy = false;
    updateAuthButton();
  });

  function finishAuth() {
    $('auth').close();
    refreshIdentity();
    const fn = authThen; authThen = null;
    if (fn && me()) fn(meName());
    else if (me()) C.toast(`Signed in as ${meName()}.`);
  }
  $('auth').addEventListener('close', () => { if (!me()) authThen = null; });

  function showError(id, msg) { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; }

  /* ================= Photos ================= */
  function wirePhoto(prefix, set) {
    $(prefix + 'Photo').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      $(prefix + 'PickText').textContent = 'Preparing photo…';
      try { set(await C.compressImage(f, C.DEMO ? 900 : 1600)); }
      catch (err) { set(null); showError(prefix + 'Error', err.message); }
    });
  }
  function showPhoto(prefix, data, emptyText) {
    $(prefix + 'Preview').src = data || '';
    $(prefix + 'Preview').hidden = !data;
    $(prefix + 'Pick').hidden = !!data;
    $(prefix + 'PhotoActions').hidden = !data;
    $(prefix + 'PickText').textContent = emptyText;
  }

  /* ================= Sign-off ================= */
  function describe(s) {
    if (s.kind === 'unit') {
      const u = S.units.find(x => x.area === s.sheet && x.unit === s.label);
      if (!u) return { use: s.label, text: 'This unit is no longer on the list and will be skipped.', conflict: true };
      return { use: s.label, text: `${s.from.status} → ${s.to.status}`, conflict: u.stage !== s.from.status, now: u.stage };
    }
    const ref = S.index.get(keyOf(s.sheet, s.label));
    if (!ref) return { use: '', text: 'This piece is no longer on the list and will be skipped.', conflict: true };
    const it = ref.item;
    const parts = [];
    if (s.from.status !== s.to.status) parts.push(`${s.from.status} → ${s.to.status}`);
    const a = C.effDone(s.from, it.qty), b = C.effDone(s.to, it.qty);
    if (it.qty > 1 && a !== b) parts.push(`${a} → ${b} of ${it.qty} bundled`);
    const conflict = it.status !== s.from.status || it.done !== s.from.done;
    return { use: it.use, text: parts.join(', ') || 'No change', conflict, now: `${it.status}, ${C.effDone(it, it.qty)} of ${it.qty} bundled` };
  }

  function renderChangeList() {
    const list = [...staged.values()];
    $('changeList').innerHTML = list.map(s => {
      const d = describe(s);
      return `<li><span class="lab">${s.kind === 'unit' ? '⌂' : C.esc(s.label)}</span><span class="what"><strong>${C.esc(d.use)}</strong> <span class="optional">(${C.esc(s.sheet)})</span><br>${C.esc(d.text)}</span>
        ${d.conflict && d.now ? `<span class="conflict">Someone else updated this line since you started. It now shows ${C.esc(d.now)}. Saving will skip it.</span>` : ''}</li>`;
    }).join('') || '<li>No changes left to save.</li>';
    updateSoButton();
  }

  function updateSoButton() {
    const name = getName('so');
    const ok = !!name && !!soPhoto && staged.size > 0 && !busy;
    $('soSave').disabled = !ok;
    $('soHint').textContent = busy ? 'Saving…'
      : !name && !soPhoto ? 'Sign in and add a photo to save.'
      : !name ? 'Sign in to save.'
      : !soPhoto ? 'Add a photo to save.'
      : `Signing off as ${name}.`;
  }

  $('reviewBtn').addEventListener('click', () => {
    showError('soError', '');
    renderNameField('so', updateSoButton);
    renderChangeList();
    renderSoSafety();
    showPhoto('so', soPhoto, 'Take or choose a photo');
    $('signoff').showModal();
  });
  wirePhoto('so', data => { soPhoto = data; showPhoto('so', data, 'Take or choose a photo'); updateSoButton(); });
  $('soRetake').addEventListener('click', () => $('soPhoto').click());

  $('soSave').addEventListener('click', async () => {
    const name = getName('so');
    if (!name || !soPhoto || busy) return;
    busy = true; updateSoButton(); showError('soError', '');
    const changes = [...staged.values()];
    try {
      const res = await post({ action: 'signoff', name, note: $('soNote').value.trim(), photo: { data: soPhoto }, changes });
      if (res.ok) {
        C.store.set('name', name);
        staged.clear(); C.store.set('staged', {});
        soPhoto = null; $('soNote').value = '';
        $('signoff').close();
        C.toast(`Saved ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}. Thanks, ${name.split(' ')[0]}.`);
        await load();
      } else if (res.conflicts && res.conflicts.length) {
        res.conflicts.forEach(c => staged.delete(c.kind === 'unit' ? unitKey(c.sheet, c.label) : keyOf(c.sheet, c.label)));
        C.store.set('staged', Object.fromEntries(staged));
        await load();
        const labels = res.conflicts.map(c => c.label).join(', ');
        showError('soError', staged.size
          ? `Someone else updated ${labels} while you were working, so ${res.conflicts.length === 1 ? 'that change was' : 'those changes were'} removed. Nothing was saved yet. Check the list below and save again; your photo is still attached.`
          : `Someone else updated ${labels} while you were working, so there's nothing left to save. Close this, check the list, and redo your changes if they're still needed.`);
        renderChangeList();
      } else {
        showError('soError', res.error || 'The sheet rejected this save.');
      }
    } catch (err) {
      console.error(err);
      showError('soError', "Couldn't reach the sheet. Your changes are still on this device. Try again when you have signal.");
    }
    busy = false;
    updateSoButton();
    updateBar();
  });

  /* ================= Message leadership ================= */
  function fillAskLabels() {
    const area = $('askArea').value;
    const sh = S.sheets.find(s => s.name === area);
    $('askLabel').innerHTML = '<option value="">Any piece</option>' + (sh ? sh.rows.filter(r => r.type === 'cut')
      .map(r => `<option value="${C.esc(r.label)}">${C.esc(r.label)}: ${C.esc(r.use)}</option>`).join('') : '');
    $('askLabel').disabled = !sh;
  }
  function updateAskButton() {
    const name = getName('ask');
    const msg = $('askMsg').value.trim();
    $('askSend').disabled = !name || !msg || busy;
    $('askHint').textContent = busy ? 'Sending…' : !name && !msg ? 'Sign in and write a message to send.'
      : !name ? 'Sign in to send.' : !msg ? 'Write a message to send.' : `Sending as ${name}.`;
  }
  function renderAnswers() {
    const list = S.messages || [];
    $('answers').hidden = !list.length;
    $('answerList').innerHTML = list.map(m => `<li>
      <p class="q">${C.esc(m.message)}</p>
      <p class="a">${C.esc(m.reply)}</p>
      <p class="who">Asked by ${C.esc(m.name)}${m.label ? ` about ${C.esc(m.label)}` : ''}${m.area ? ` (${C.esc(m.area)})` : ''}. Answered by ${C.esc(m.repliedBy || 'leadership')}, ${C.esc(C.timeAgo(m.repliedAt))}.</p>
    </li>`).join('');
  }

  $('openAsk').addEventListener('click', () => {
    showError('askError', '');
    $('askArea').innerHTML = '<option value="">Not about one area</option>' +
      S.sheets.map(s => `<option value="${C.esc(s.name)}">${C.esc(s.name)}</option>`).join('');
    $('askArea').value = S.current && S.current !== ALL ? S.current : '';
    fillAskLabels();
    renderNameField('ask', updateAskButton);
    showPhoto('ask', askPhoto, 'Add a photo');
    renderAnswers();
    updateAskButton();
    $('ask').showModal();
  });
  $('askArea').addEventListener('change', fillAskLabels);
  $('askMsg').addEventListener('input', updateAskButton);
  wirePhoto('ask', data => { askPhoto = data; showPhoto('ask', data, 'Add a photo'); });
  $('askRemove').addEventListener('click', () => { askPhoto = null; showPhoto('ask', null, 'Add a photo'); });

  $('askSend').addEventListener('click', async () => {
    const name = getName('ask');
    const message = $('askMsg').value.trim();
    if (!name || !message || busy) return;
    busy = true; updateAskButton(); showError('askError', '');
    const type = document.querySelector('input[name="askType"]:checked').value;
    try {
      const res = await post({ action: 'message', name, type, message, area: $('askArea').value, label: $('askLabel').value,
                                     photo: askPhoto ? { data: askPhoto } : null });
      if (!res.ok) throw Object.assign(new Error(res.error || 'The sheet rejected this message.'), { shown: true });
      C.store.set('name', name);
      $('askMsg').value = ''; askPhoto = null;
      $('ask').close();
      C.toast(type === 'Question' ? 'Question sent. Answers show up under Message leadership.' : 'Note sent to leadership.');
    } catch (err) {
      showError('askError', err.shown ? err.message : "Couldn't reach the sheet. Your message is still here. Try again when you have signal.");
    }
    busy = false;
    updateAskButton();
  });

  /* ================= Guide ================= */
  function bundleSVG(hex, tapeText, labels) {
    const ink = C.inkOn(hex);
    const boards = labels.map((l, i) => {
      const y = 44 + i * 30;
      return `<rect x="20" y="${y}" width="560" height="27" rx="2" fill="#E6C995" stroke="#B8955A"/>
        <path d="M60 ${y + 9} C 200 ${y + 5}, 320 ${y + 15}, 560 ${y + 10}" stroke="#CDA864" fill="none"/>
        <text x="34" y="${y + 19}" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="600" font-size="16" fill="#4A3A22">${C.esc(l)}</text>`;
    }).join('');
    const band = x => `<rect x="${x}" y="34" width="62" height="${labels.length * 30 + 18}" rx="4" fill="${hex}" stroke="rgba(28,35,43,.35)"/>`;
    const midY = 34 + (labels.length * 30 + 18) / 2;
    return `<svg viewBox="0 0 600 ${labels.length * 30 + 90}" role="img" aria-label="A bundle of labeled boards with two bands of tape, each band marked ${C.esc(tapeText)}">
      ${boards}${band(110)}${band(428)}
      <text x="141" y="${midY}" transform="rotate(-90 141 ${midY})" text-anchor="middle" dominant-baseline="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="20" fill="${ink}">${C.esc(tapeText)}</text>
      <text x="459" y="${midY}" transform="rotate(-90 459 ${midY})" text-anchor="middle" dominant-baseline="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="20" fill="${ink}">${C.esc(tapeText)}</text>
      <path d="M20 ${labels.length * 30 + 66} H110" stroke="#5B6570" stroke-width="1.5" marker-end="url(#ah)" marker-start="url(#ah)"/>
      <defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#5B6570"/></marker></defs>
      <text x="124" y="${labels.length * 30 + 71}" font-family="Barlow, sans-serif" font-size="15" fill="#5B6570">about 6" from each end</text>
    </svg>`;
  }

  function guideHTML() {
    const max = C.CFG.maxBundle;
    const area = S.current && S.current !== ALL ? S.current : (S.sheets[0] && S.sheets[0].name) || 'your area';
    const color = S.tape[area] || '';
    const colorWord = color ? color.toLowerCase() : "your area's";
    const hex = C.tapeHex(color);
    const sh = S.sheets.find(s => s.name === area);
    const cuts = sh ? sh.rows.filter(r => r.type === 'cut' && !C.isSheetGood(r.dim)) : [];
    const ex = cuts.find(r => r.qty > max) || cuts.find(r => r.qty > 1) || cuts[0] || { label: 'A', qty: 20, use: 'Wall Studs' };
    const bundles = C.bundlesFor(ex.label, ex.qty, max);
    const first = bundles[0];
    const shownLabels = [];
    for (let i = 1; i <= Math.min(4, ex.qty); i++) shownLabels.push(ex.label + i);
    const splitText = bundles.length > 1
      ? `${ex.label} has ${ex.qty} pieces, so it becomes ${bundles.length} bundles: ${bundles.map(b => b.range).join(', ')}.`
      : `${ex.label} has ${ex.qty} ${ex.qty === 1 ? 'piece' : 'pieces'}, so it fits in one bundle.`;

    return `
      <p>${S.current && S.current !== ALL ? `This guide uses ${C.esc(area)} as the example.` : 'Pick an area first to see its tape color here.'}
      Every piece gets its own number, every bundle gets its area's tape, and every bundle goes in its color's stack.</p>

      <figure class="guide-figure">
        ${bundleSVG(hex, first.tape, shownLabels)}
        <figcaption>A finished ${C.esc(ex.label)} bundle: each piece numbered, ${C.esc(colorWord)} tape at both ends, and the tape marked ${C.esc(first.tape)}.</figcaption>
      </figure>

      <ol class="guide-steps">
        <li><h3>Check the cut plan before you grab a board</h3>
          <p>Switch to Cut plan to see which pieces come out of each board. Use the spare wood boards first, then new 8' boards. Some boards hold pieces for more than one area; the colored stripe on each piece shows which stack it goes to.</p></li>
        <li><h3>Cut one, check it, then set a stop</h3>
          <p>Measure the first piece against the list. For repeats, clamp a stop block so every piece matches the first one.</p></li>
        <li><h3>Number every piece as it comes off the saw</h3>
          <p>Write the letter and piece number on the wide face, about 6" from one end: ${C.esc(ex.label)}1, ${C.esc(ex.label)}2, ${C.esc(ex.label)}3, and so on up to ${C.esc(ex.label + ex.qty)}. Use the same spot on every piece.</p></li>
        <li><h3>Group by letter</h3>
          <p>Gather all pieces with the same letter and line up the ends. A bundle holds up to ${max} pieces. ${C.esc(splitText)}</p></li>
        <li><h3>Tape with ${C.esc(area)}'s color</h3>
          <p>${C.esc(area)} uses ${C.esc(colorWord)} tape. Wrap it twice around the bundle about 6" in from each end. Pieces shorter than 2' get one wrap in the middle.</p></li>
        <li><h3>Write on the tape</h3>
          <p>Use a Sharpie to write the letter and piece numbers on each band of tape, facing out: ${C.esc(first.tape)}.</p></li>
        <li><h3>Stack by color</h3>
          <p>Put the bundle in the ${C.esc(colorWord)} stack with the rest of ${C.esc(area)}. Longest bundles go on the bottom, and tape labels face out.</p></li>
        <li><h3>Update the tracker and sign off</h3>
          <p>Tap + for each piece you bundled (or set the line to Bundled when it's all done). Then tap Sign off and save, pick your name, and take a photo with the tape label readable. Nothing saves without your name and a photo.</p></li>
      </ol>

      <div class="guide-box"><h3>What each status means</h3>
        <dl class="status-defs">
          <dt><span class="pill s-ns">Not Started</span></dt><dd>Nothing cut yet.</dd>
          <dt><span class="pill s-ip">In Progress</span></dt><dd>Some pieces are cut or bundled.</dd>
          <dt><span class="pill s-cut">Cut</span></dt><dd>All pieces are cut but not yet numbered and bundled.</dd>
          <dt><span class="pill s-tag">Bundled</span></dt><dd>Every piece is numbered, bundled, taped, and stacked.</dd>
          <dt><span class="pill s-buy">Need to Purchase</span></dt><dd>Not enough lumber to finish. Add a note saying what's missing.</dd>
        </dl>
      </div>

      <div class="guide-box"><h3>MDF sheets</h3>
        <p>The 4'x8' MDF sheets don't get bundled. Write the label in one corner of the face (for example O1, O2), put a strip of the area's tape on the edge next to it, and stack the sheets flat with that area. Keep MDF flat, dry, and off a bare concrete floor, since it swells if it gets damp. Carry sheets on edge with two people; the corners crush easily.</p>
      </div>

      <div class="guide-box"><h3>Mistakes and leftovers</h3>
        <ul>
          <li>Cut a piece wrong? Don't number it. Put it in scrap and cut a new one.</li>
          <li>Offcuts 2' or longer go on the scrap rack, sorted by size. Shorter pieces go in the scrap bin.</li>
          <li>Running out of boards? Set the line to Need to Purchase and send leadership a note.</li>
        </ul>
      </div>

      ${S.sheets.length ? `<div class="guide-box"><h3>Tape colors</h3><div class="area-banner" style="margin:0;border:0;padding:0;background:none"><div class="tapes">${S.sheets.map(s =>
        `<span>${C.swatch(S.tape[s.name])}${C.esc(s.name)}: ${C.esc(S.tape[s.name] || 'not set')}</span>`).join('')}</div></div></div>` : ''}
    `;
  }

  function openGuide() { if ($('tour').open) $('tour').close(); $('guideBody').innerHTML = guideHTML(); $('guide').showModal(); }

  /* ================= First-run tour: Tackle, Track, Complete ================= */
  const APP = C.CFG.appName, SHORT = C.CFG.appShort;
  let tourAt = 0;

  function tourSlides() {
    const areas = S.sheets.map(sh => sh.name);
    const areaList = areas.length > 1 ? areas.slice(0, -1).join(', ') + ', or ' + areas[areas.length - 1] : (areas[0] || 'your area');
    const swatches = areas.map(a => `<span class="mock-swatch">${C.swatch(S.tape[a], 'lg')}<span>${C.esc(a)}</span></span>`).join('');
    const red = C.tapeHex(S.tape[areas[0]] || 'Red');
    return [
      { title: `First time using ${APP} (${SHORT})?`,
        body: `Here's a quick tour of how the app works: how to pick up a task, keep track of it, and mark it complete. It takes about a minute.`,
        art: `<div class="mock-wordmark"><span>Tackle</span><span>Track</span><span>Complete</span></div>` },
      { title: 'Sign in once',
        body: `Tap <strong>Sign in or join the crew</strong>, then <strong>I'm new</strong>, and enter your name. You'll get a 4-digit PIN. Screenshot it; you'll need it on any other phone. This phone remembers you.`,
        art: `<div class="mock-stack"><p class="mock-line">Welcome, <strong>Sam</strong>. Your PIN is:</p><span class="big-pin mock-pin">4821</span></div>` },
      { title: 'Pick your area',
        body: `Use the menu at the top to choose ${C.esc(areaList)}. Each area has its own tape color. Scanning the sign on a stack opens that area, and you can switch anytime.`,
        art: `<div class="mock-stack"><div class="mock-picker">${C.esc(areas[0] || 'Framing')}</div><div class="mock-swatches">${swatches}</div></div>` },
      { kicker: 'Tackle', title: 'Claim a task, then cut',
        body: `Found something to work on? Tap <strong>I'm on it</strong>. Your name shows up for everyone, so two people don't cut the same pieces. The <strong>Cut plan</strong> tab shows which pieces come out of each board, spare wood first.`,
        art: `<div class="mock-stack"><div class="mock-row"><span class="claim-btn">I'm on it</span><span class="mock-arrow" aria-hidden="true">→</span><span class="claim mine">You're on it</span></div>
          <div class="board mock-board"><span class="seg" style="width:52%;--area:${red}">L 50"</span><span class="seg" style="width:25%;--area:${C.tapeHex(S.tape[areas[3]] || 'Green')}">AR</span><span class="seg" style="width:22%;--area:${C.tapeHex(S.tape[areas[2]] || 'Blue')}">AJ</span></div></div>` },
      { kicker: 'Tackle', title: 'Number it, bundle it',
        body: `Number every piece as you cut it: A1, A2, A3. Bundle up to ${C.CFG.maxBundle} of the same letter, tape both ends in your area's color, write the letter and numbers on the tape, and stack it with that color. The full steps are under <strong>How to label and bundle</strong>.`,
        art: `<div class="mock-bundle">${bundleSVG(red, 'A 1–10', ['A1', 'A2', 'A3'])}</div>` },
      { kicker: 'Track', title: 'Update as you go',
        body: `Tap <strong>+</strong> for each piece that's numbered and bundled, or change the status. Changes are marked <strong>Not saved yet</strong> until you sign off, so you can update several lines at once.`,
        art: `<div class="mock-stack"><div class="mock-row"><span class="mock-select s-ip">In Progress</span>
          <span class="counter mock-counter"><span class="mock-btn">−</span><span class="count"><b>4</b> / 8</span><span class="mock-btn">+</span></span></div>
          <div class="mock-row mock-pills">${C.STATUSES.map(st => `<span class="pill ${st.cls}">${st.name}</span>`).join('')}</div></div>` },
      { kicker: 'Complete', title: 'Sign off with a photo',
        body: `When you're done, tap <strong>Sign off and save</strong> at the bottom and take a photo with the tape label readable. Nothing saves without a photo. Leadership sees your work right away, and your claim clears once the line is Bundled.`,
        art: `<div class="mock-savebar"><p><strong>2</strong> changes not saved yet</p><span class="btn on-dark">Sign off and save</span></div>` },
      { kicker: 'Complete', title: 'Build it',
        body: `When every piece a unit needs is bundled, it shows up as <strong>Ready to build</strong> on the <strong>Build</strong> tab. Change its stage as you build and sign off with a photo, the same as cuts.`,
        art: `<div class="unit mock-unit"><div class="unit-head"><h4>4' door #1</h4><span class="pill s-tag">Ready to build</span></div>
          <p class="unit-parts"><span class="part ok">F 2/2</span><span class="part ok">G 2/2</span><span class="part ok">H 2/2</span></p></div>` },
      { title: 'Stuck or out of wood?',
        body: `Set the line to <strong>Need to Purchase</strong> so leadership knows what to buy. For anything else, tap <strong>Message leadership</strong>. Answers show up there for the whole crew.`,
        art: `<div class="mock-row"><span class="pill s-buy mock-big-pill">Need to Purchase</span><span class="btn-quiet mock-quiet">Message leadership</span></div>` },
      { title: 'Safety first, then go',
        body: `Each day the app offers a one-minute safety check-in: glasses on, hearing protection in, vacuum running, no gloves at the saw. You can replay this tour anytime from <strong>How to use ${SHORT}</strong>.`,
        art: `<ul class="checklist mock-check"><li><label><input type="checkbox" checked disabled><span><strong>Safety glasses on</strong></span></label></li>
          <li><label><input type="checkbox" checked disabled><span><strong>Hearing protection in</strong></span></label></li>
          <li><label><input type="checkbox" checked disabled><span><strong>No gloves at the saw</strong></span></label></li></ul>` }
    ];
  }

  function renderTour() {
    const slides = tourSlides();
    tourAt = Math.max(0, Math.min(tourAt, slides.length - 1));
    const sl = slides[tourAt];
    const last = tourAt === slides.length - 1;
    $('tourBody').innerHTML = `<div class="tour-slide" role="group" aria-roledescription="slide" aria-label="${tourAt + 1} of ${slides.length}">
      <div class="tour-art" aria-hidden="true">${sl.art}</div>
      ${sl.kicker ? `<p class="tour-kicker">${C.esc(sl.kicker)}</p>` : ''}
      <h2 id="tourTitle">${C.esc(sl.title)}</h2>
      <p class="tour-text">${sl.body}</p>
    </div>`;
    $('tourCount').textContent = `${tourAt + 1} of ${slides.length}`;
    $('tourBack').disabled = tourAt === 0;
    $('tourNext').textContent = last ? (me() ? 'Get started' : 'Join the crew') : tourAt === 0 ? 'Start' : 'Next';
    $('tourDots').innerHTML = slides.map((x, i) =>
      `<button type="button" class="tour-dot" data-go="${i}" aria-label="Slide ${i + 1}: ${C.esc(x.title)}" ${i === tourAt ? 'aria-current="step"' : ''}></button>`).join('');
  }

  function openTour() {
    tourAt = 0;
    renderTour();
    if (!$('tour').open) $('tour').showModal();
    $('tourNext').focus();
  }
  function closeTour() {
    C.store.set('tourSeen', true);
    if ($('tour').open) $('tour').close();
  }
  function tourGo(i) { tourAt = i; renderTour(); }

  $('openTour').addEventListener('click', openTour);
  $('tourSkip').addEventListener('click', closeTour);
  $('tourBack').addEventListener('click', () => tourGo(tourAt - 1));
  $('tourNext').addEventListener('click', () => {
    if (tourAt < tourSlides().length - 1) return tourGo(tourAt + 1);
    closeTour();
    if (!me()) openAuth('');
  });
  $('tourDots').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    tourGo(+b.dataset.go);
    const cur = $('tourDots').querySelector('[aria-current]'); if (cur) cur.focus();
  });
  $('tour').addEventListener('close', () => C.store.set('tourSeen', true));
  document.addEventListener('keydown', e => {
    if (!$('tour').open || e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); if (tourAt < tourSlides().length - 1) tourGo(tourAt + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (tourAt > 0) tourGo(tourAt - 1); }
  });
  // Swipe left/right on phones
  let swipeX = null;
  $('tourBody').addEventListener('pointerdown', e => { swipeX = e.clientX; });
  $('tourBody').addEventListener('pointerup', e => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX; swipeX = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && tourAt < tourSlides().length - 1) tourGo(tourAt + 1);
    if (dx > 0 && tourAt > 0) tourGo(tourAt - 1);
  });

  // First visit on this device: show the tour, unless the page was opened for something else (like the saw-station sign).
  function maybeFirstTour() {
    if (C.store.get('tourSeen', false)) return;
    if (decodeURIComponent(location.hash.slice(1)) === 'safety') return;
    if (document.querySelector('dialog[open]')) return;
    openTour();
  }
  $('openGuide').addEventListener('click', openGuide);
  $('areaBanner').addEventListener('click', e => { if (e.target.closest('[data-guide]')) openGuide(); });

  /* ================= Claims: "I'm on it" ================= */
  const claimOf = (kind, area, item) => S.claims.find(c => c.kind === kind && c.area === area && c.item === item);

  function claimHTML(kind, area, item, finished) {
    const c = claimOf(kind, area, item);
    const me = meName();
    const data = `data-kind="${kind}" data-area="${C.esc(area)}" data-item="${C.esc(item)}"`;
    if (!c) return finished ? '' : `<button type="button" class="claim-btn" data-claim ${data}>I'm on it</button>`;
    if (c.name === me) return `<span class="claim mine">You're on it</span> <button type="button" class="linkish claim-link" data-release ${data}>Done for now</button>`;
    return `<span class="claim other">${C.esc(c.name)} is on it, ${C.esc(C.timeAgo(c.since))}</span> <button type="button" class="linkish claim-link" data-takeover ${data}>Take over</button>`;
  }

  async function claimAction(el) {
    const kind = el.dataset.kind, area = el.dataset.area, item = el.dataset.item;
    if (el.hasAttribute('data-release')) {
      S.claims = S.claims.filter(c => !(c.kind === kind && c.area === area && c.item === item));
      refresh();
      try { await post({ action: 'release', kind, area, item }); } catch (e) { C.toast("Couldn't reach the sheet. Try again in a moment."); }
      return load();
    }
    const takeOver = el.hasAttribute('data-takeover');
    if (takeOver) {
      const c = claimOf(kind, area, item);
      if (c && !confirm(`Take over ${item} from ${c.name}? Do this if they've left or handed it off.`)) return;
    }
    withUser(async name => {
      const prev = S.claims.slice();
      S.claims = S.claims.filter(c => !(c.kind === kind && c.area === area && c.item === item))
        .concat({ kind, area, item, name, since: new Date().toISOString() });
      refresh();
      try {
        const res = await post({ action: 'claim', kind, area, item, name, takeOver });
        if (!res.ok) { S.claims = prev; C.toast(res.claimedBy ? `${res.claimedBy} just claimed ${item}. Check with them first.` : res.error); }
        else C.toast(`Everyone can see you're on ${item}. It clears when you sign off or after 6 hours.`);
      } catch (e) {
        S.claims = prev;
        C.toast("Couldn't reach the sheet. Try again in a moment.");
      }
      load();
    });
  }
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-claim], [data-release], [data-takeover]');
    if (el && !el.closest('dialog')) claimAction(el);
  });

  /* ================= Build (assembly units) ================= */
  const unitKey = (area, unit) => 'unit::' + area + '::' + unit;
  const unitShown = u => staged.has(unitKey(u.area, u.unit)) ? staged.get(unitKey(u.area, u.unit)).to.status : u.stage;
  const PHASES = [
    ['Ready', 'Ready to build', 's-tag'],
    ['Building', 'Being built', 's-ip'],
    ['Waiting', 'Waiting on parts', 's-ns'],
    ['Done', 'Built', 's-cut']
  ];

  function renderBuild() {
    if (S.view !== 'build' || !S.current) return;
    const stateOf = (sheet, r) => shown(keyOf(sheet, r.label), r);
    const units = S.units.map(u => Object.assign({}, u, { stage: unitShown(u) }));
    const status = C.unitStatus(S.sheets, units, stateOf);
    const list = units.map((u, i) => ({ u, st: status[i] })).filter(x => S.current === ALL || x.u.area === S.current);
    if (!list.length) {
      $('build').innerHTML = `<p class="empty">No units for ${S.current === ALL ? 'any area' : C.esc(S.current)} yet. Leadership adds them in the Units tab of the sheet.</p>`;
      return;
    }
    const bucket = x => x.st.phase === 'Ready' ? 'Ready' : x.st.phase === 'Building' ? 'Building' : x.st.phase === 'Waiting' ? 'Waiting' : 'Done';
    const html = PHASES.map(([key, title, cls]) => {
      const items = list.filter(x => bucket(x) === key);
      if (!items.length) return '';
      return `<section class="unit-group"><h3><span class="pill ${cls}">${title}</span> <span class="when">${items.length}</span></h3>
        <div class="units">${items.map(x => unitHTML(x.u, x.st, cls)).join('')}</div></section>`;
    }).join('');
    $('build').innerHTML = `<p class="plan-note">A unit is ready once every piece it needs is bundled. Change a unit's stage, then sign off with a photo, the same as cuts.</p>` + html;
  }

  function unitHTML(u, st, cls) {
    const key = unitKey(u.area, u.unit);
    const isStaged = staged.has(key);
    const parts = st.parts.map(p => {
      const ok = p.have >= p.need;
      return `<span class="part ${ok ? 'ok' : ''} ${p.known ? '' : 'bad'}" title="${p.known ? `${p.have} of ${p.need} bundled and set aside for this unit` : 'Not found in this area\'s cut list'}">${C.esc(p.label)} ${p.known ? `${p.have}/${p.need}` : '?'}</span>`;
    }).join('');
    const opts = C.UNIT_STAGES.map(sName => `<option value="${sName}" ${sName === u.stage ? 'selected' : ''}>${sName === 'Not started' ? (st.ready ? 'Not started (ready)' : 'Not started') : sName}</option>`).join('');
    const done = ['Built', 'Finished', 'Loaded in'].includes(u.stage);
    return `<article class="unit ${isStaged ? 'staged' : ''}" data-ukey="${C.esc(key)}">
      <div class="unit-head"><h4>${C.esc(u.unit)}</h4>${S.current === ALL ? `<span class="when">${C.esc(u.area)}</span>` : ''}</div>
      <p class="unit-parts">${parts || '<span class="when">No parts listed</span>'}</p>
      ${st.unknown.length ? `<p class="plan-note" style="margin:6px 0 0">Can't find ${st.unknown.map(p => C.esc(p.label)).join(', ')} in ${C.esc(u.area)}. Check the Units tab.</p>` : ''}
      <div class="unit-actions">
        <label class="sr-only" for="st-${C.esc(key)}">Stage for ${C.esc(u.unit)}</label>
        <select class="status unit-stage ${isStaged ? 's-ip' : cls}" id="st-${C.esc(key)}">${opts}</select>
        <span class="claim-slot">${claimHTML('unit', u.area, u.unit, done)}</span>
      </div>
      ${isStaged ? '<span class="unsaved-tag">Not saved yet</span>' : ''}
      ${u.by ? `<p class="when" style="margin:6px 0 0">Last signed off by ${C.esc(u.by)}, ${C.esc(C.timeAgo(u.updated))}</p>` : ''}
    </article>`;
  }

  $('build').addEventListener('change', e => {
    if (!e.target.matches('select.unit-stage')) return;
    const key = e.target.closest('[data-ukey]').dataset.ukey;
    const u = S.units.find(x => unitKey(x.area, x.unit) === key);
    if (!u) return;
    if (!staged.has(key) && !warnClaim('unit', u.area, u.unit, key)) { renderBuild(); return; }
    const to = e.target.value;
    if (to === u.stage) staged.delete(key);
    else staged.set(key, { kind: 'unit', sheet: u.area, label: u.unit, row: u.row, from: { status: u.stage, done: 0 }, to: { status: to, done: 0 } });
    C.store.set('staged', Object.fromEntries(staged));
    renderBuild();
    updateBar();
  });

  /* ================= Safety check-in (optional) ================= */
  const SAFETY_ITEMS = [
    ['eyes', 'Safety glasses on', 'ANSI Z87.1-rated, for anyone at or near the saw, not just the person cutting.'],
    ['ears', 'Hearing protection in while saws run', 'Earplugs or earmuffs. Saws are loud enough to damage hearing over a work session.'],
    ['dust', 'Dust collection on', "The saw's vacuum is connected and running before the first cut. Wear a dust mask or N95 when cutting MDF."],
    ['gloves', 'No gloves at the saw', "Gloves are for carrying lumber and MDF. Take them off before using a saw or drill, since a blade can catch a glove and pull your hand in."],
    ['dress', 'Dressed for the shop', 'Closed-toe shoes, no loose sleeves or dangling jewelry, long hair tied back.'],
    ['guards', 'Guards in place', "Blade guard and riving knife stay on. Keep hands out of the blade's path, and let the blade stop before clearing offcuts."],
    ['power', 'Unplug before changing a blade', 'Unplug the saw before changing a blade, adjusting it, or clearing a jam.'],
    ['trained', "I've been shown how to use today's tools", "If you haven't been checked out on a tool, ask the shop lead before using it."],
    ['area', 'Work area is clear', 'Cords, offcuts, and sawdust are out of walkways. I know where the first aid kit, fire extinguisher, and power shutoff are.']
  ];
  const checkedInToday = () => C.store.get('safetyDate', '') === C.today();

  function updateSafetyBanner() {
    $('safetyBanner').hidden = checkedInToday() || C.store.get('safetySkip', '') === C.today();
  }
  $('safetyStart').addEventListener('click', () => openSafety());
  $('safetyLater').addEventListener('click', () => { C.store.set('safetySkip', C.today()); updateSafetyBanner(); });

  function safetyHTML() {
    return `<p style="margin-top:0">A quick check before you start. It's optional, but it helps keep everyone safe and gives leadership a record of who's in the shop.</p>
      ${checkedInToday() ? '<p class="safety-line done">You already checked in today on this device. You can check in again if someone else is using it.</p>' : ''}
      <ul class="checklist">${SAFETY_ITEMS.map(([id, t, d]) => `<li><label><input type="checkbox" value="${id}" data-safety>
        <span><strong>${C.esc(t)}</strong><span>${C.esc(d)}</span></span></label></li>`).join('')}</ul>
      <div class="field" id="safetyNameField"></div>
      <section class="ref" aria-label="Safety reference">
        <h3>Why these rules</h3>
        <p class="hint">These follow OSHA's general industry standards. OSHA rules legally cover employers and employees, not always volunteers, but they're the standard this shop follows.</p>
        <details><summary>Eye protection</summary>
          <p>Saws throw chips and knots at high speed. Wear safety glasses marked Z87.1, and add a face shield for heavy ripping.</p>
          <p class="cite">OSHA 29 CFR 1910.133, Eye and face protection</p></details>
        <details><summary>Hearing protection</summary>
          <p>Miter saws, table saws, and circular saws commonly run well above the level where hearing damage builds up over a shift. Use earplugs or earmuffs whenever saws are running nearby, even if you aren't cutting.</p>
          <p class="cite">OSHA 29 CFR 1910.95, Occupational noise exposure</p></details>
        <details><summary>Wood dust</summary>
          <p>Fine wood dust irritates the lungs, and long-term exposure is linked to serious disease. MDF dust is especially fine and contains the resin glues that hold the sheet together, so it hangs in the air longer than sawdust from solid lumber. Keep the saw's vacuum or dust collector connected and running, sweep or vacuum instead of blowing dust around, and wear a dust mask or N95 whenever you cut or sand MDF.</p></details>
        <details><summary>Gloves: when yes and when no</summary>
          <ul><li>Yes: carrying lumber and MDF sheets, handling rough or splintery boards, cleanup.</li>
          <li>No: running a table saw, miter saw, circular saw, drill, or router. A spinning blade or bit can grab a glove and pull your hand in.</li></ul>
          <p class="cite">OSHA 29 CFR 1910.132 and 1910.138, Personal protective equipment and hand protection</p></details>
        <details><summary>Guards and saw safety</summary>
          <ul><li>Never remove or tie back a blade guard.</li>
          <li>On the table saw, use the riving knife and a push stick for narrow rips. Never cut freehand without the fence or miter gauge.</li>
          <li>On the miter saw, keep hands at least 6" from the blade and let it stop completely before lifting.</li>
          <li>Unplug before changing blades or clearing jams.</li></ul>
          <p class="cite">OSHA 29 CFR 1910.213, Woodworking machinery; 1910.242 and 1910.243, Hand and portable powered tools</p></details>
        <details><summary>Housekeeping and emergencies</summary>
          <p>Keep walkways clear of cords, offcuts, and sawdust. Know where the first aid kit, fire extinguisher, and main power shutoff are before you start. Report every injury to the shop lead, even a small cut.</p>
          <p class="cite">OSHA 29 CFR 1910.22, Walking-working surfaces</p></details>
      </section>`;
  }

  function updateSafetyButton() {
    const boxes = [...document.querySelectorAll('[data-safety]')];
    const all = boxes.length && boxes.every(b => b.checked);
    const name = getName('safety');
    $('safetySend').disabled = !all || !name || busy;
    const left = boxes.filter(b => !b.checked).length;
    $('safetyHint').textContent = busy ? 'Checking in…' : left ? `${left} ${left === 1 ? 'item' : 'items'} left to check.` : !name ? 'Sign in to check in.' : `Checking in as ${name}.`;
  }

  function openSafety() {
    $('safetyBody').innerHTML = safetyHTML();
    renderNameField('safety', updateSafetyButton);
    updateSafetyButton();
    $('safety').showModal();
  }
  $('openSafety').addEventListener('click', openSafety);
  $('safetyBody').addEventListener('change', updateSafetyButton);

  $('safetySend').addEventListener('click', async () => {
    const name = getName('safety');
    const items = [...document.querySelectorAll('[data-safety]:checked')].map(b => b.value);
    if (!name || items.length !== SAFETY_ITEMS.length || busy) return;
    busy = true; updateSafetyButton();
    try {
      const res = await post({ action: 'safety', name, items });
      if (!res.ok) throw new Error(res.error || 'The sheet rejected the check-in.');
      C.store.set('safetyDate', C.today());
      C.store.set('name', name);
      $('safety').close();
      updateSafetyBanner();
      renderSoSafety();
      C.toast(`You're checked in, ${name.split(' ')[0]}. Have a good shift.`);
    } catch (err) {
      C.toast(err.message && !/HTTP|fetch/i.test(err.message) ? err.message : "Couldn't reach the sheet. Try again when you have signal.");
    }
    busy = false;
    updateSafetyButton();
  });

  function renderSoSafety() {
    const el = $('soSafety');
    if (checkedInToday()) { el.className = 'safety-line done'; el.textContent = 'Safety check-in done today.'; return; }
    el.className = 'safety-line';
    el.innerHTML = 'No safety check-in today. It\'s optional. <button type="button" class="linkish" id="soSafetyBtn">Check in now</button>';
  }
  $('soSafety').addEventListener('click', e => { if (e.target.id === 'soSafetyBtn') openSafety(); });

  /* ================= Dialog plumbing + start ================= */
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  document.title = C.CFG.title;
  $('title').textContent = C.CFG.title;
  window.addEventListener('beforeunload', e => { if (staged.size) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) load(); });
  setInterval(() => { if (!document.hidden && !busy) load(); }, Math.max(10, C.CFG.pollSeconds) * 1000);
  updateBar();
  refreshIdentity();
  updateSafetyBanner();
  setView(S.view);
  load();
})();
