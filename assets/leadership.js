(function () {
  const C = window.Cut;
  const $ = id => document.getElementById(id);
  const L = {
    data: null, lastError: '', logShown: 15,
    pin: C.store.get('pin', ''), pinOk: false, leadName: C.store.get('leadName', ''),
    drafts: {}, open: new Set(), busy: false
  };

  async function load() {
    try {
      L.data = await C.api.get('lead');
      L.lastError = '';
      render();
    } catch (err) {
      console.error(err);
      L.lastError = "Can't reach the sheet. Retrying…";
    }
    updateSync();
  }

  function updateSync() {
    const el = $('sync');
    if (L.lastError) return C.setSync(el, 'err', L.lastError);
    if (!L.data) return C.setSync(el, 'busy', 'Loading…');
    C.setSync(el, C.DEMO ? 'demo' : 'ok', C.DEMO ? 'Demo data' : `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  }

  const cutsOf = sh => sh.rows.filter(r => r.type === 'cut');
  const pillFor = status => `<span class="pill ${C.CLS[status] || 's-ns'}">${C.esc(status)}</span>`;

  function render() {
    const d = L.data;
    renderOverall(d);
    renderAreas(d);
    renderLumber(d);
    renderFlagged(d);
    renderSafety(d);
    renderNow(d);
    renderUnits(d);
    if (!$('crewList').querySelector('.reset-result strong')) renderCrew(d);
    if (!$('inbox').contains(document.activeElement)) renderInbox(d);
    renderLog(d);
    renderAllCuts(d);
    const dups = C.duplicateLabels(d.sheets);
    $('notice').hidden = !dups.length;
    if (dups.length) {
      $('notice').innerHTML = '<strong>Duplicate labels:</strong> ' + dups.map(([l, w]) => `${C.esc(l)} is used in ${w.map(C.esc).join(' and ')}`).join('; ') +
        '. Bundles with these letters can get mixed up. Rename them in the sheet.';
    }
  }

  /* ---------- Overall ---------- */
  function renderOverall(d) {
    let done = 0, total = 0;
    const counts = Object.fromEntries(C.STATUSES.map(s => [s.name, 0]));
    d.sheets.forEach(sh => cutsOf(sh).forEach(r => { done += C.effDone(r, r.qty); total += r.qty; counts[r.status]++; }));
    $('pDone').textContent = done;
    $('pTotal').textContent = total;
    if (!$('tapeSlot').firstChild) $('tapeSlot').innerHTML = C.tapeMeasure('tape', 'Pieces labeled and bundled');
    C.setTape($('tape'), done, total);
    $('overallChips').innerHTML = C.STATUSES.map(s =>
      `<span class="chip ${s.cls}"><i aria-hidden="true"></i>${s.name} <b>${counts[s.name]}</b></span>`).join('') +
      `<span class="chip">Lines total <b>${Object.values(counts).reduce((a, b) => a + b, 0)}</b></span>`;
  }

  /* ---------- Areas ---------- */
  function renderAreas(d) {
    const rows = d.sheets.map(sh => {
      const cuts = cutsOf(sh);
      let done = 0, total = 0, left = 0;
      const counts = {};
      cuts.forEach(r => { done += C.effDone(r, r.qty); total += r.qty; left += C.leftToCut(r, r.qty); counts[r.status] = (counts[r.status] || 0) + 1; });
      const pct = total ? Math.floor(done / total * 100) : 0;
      const color = d.tape[sh.name];
      return `<tr>
        <th scope="row"><span class="area-name">${color ? C.swatch(color) : ''}${C.esc(sh.name)}</span><small>${C.esc(color ? color + ' tape' : 'No tape color set')}</small></th>
        <td>${C.miniBar(done, total)} <strong>${pct}%</strong></td>
        <td class="num">${done} of ${total}<small>bundled</small></td>
        <td class="num">${left}<small>left to cut</small></td>
        <td><div class="pills">${C.STATUSES.filter(s => counts[s.name]).map(s => `<span class="pill ${s.cls}">${s.name} ${counts[s.name]}</span>`).join('')}</div></td>
      </tr>`;
    }).join('');
    $('areasTable').innerHTML = `<thead><tr><th scope="col">Area</th><th scope="col">Progress</th><th scope="col" class="num">Pieces</th><th scope="col" class="num">Still to cut</th><th scope="col">Lines by status</th></tr></thead><tbody>${rows}</tbody>`;
  }

  /* ---------- Lumber ---------- */
  function renderLumber(d) {
    const report = C.lumberReport(d.sheets, d.lumber, d.stock || []);
    const money = n => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let totalCost = 0, anyBuy = false, missingPrice = false;
    const rows = report.map(r => {
      const unit = r.sheet ? 'sheets' : 'boards';
      const newName = r.sheet ? 'Full sheets' : (r.boardLength % 12 === 0 ? `New: ${r.boardLength / 12}' boards` : `New: ${C.fmtIn(r.boardLength)} boards`);
      if (r.toBuy > 0) anyBuy = true;
      if (r.toBuy > 0 && r.cost == null) missingPrice = true;
      if (r.cost) totalCost += r.cost;
      const proof = r.plan && r.plan.bound != null && r.newBoards
        ? (r.plan.newBoards === r.plan.bound ? 'proven minimum' : `at most ${r.plan.newBoards - r.plan.bound} over the minimum`) : '';
      return `<tr>
        <th scope="row"><span class="area-name">${C.esc(r.size)}</span><small>${newName}</small></th>
        <td class="num">${r.left}<small>pieces</small></td>
        <td class="num">${r.onHand ? `${r.onHand}<small>${r.countedAt ? `counted ${C.esc(C.timeAgo(r.countedAt))}` : ''}</small>` : '<small>Not counted</small>'}</td>
        <td class="num">${r.fromStock}<small>${unit} used</small></td>
        <td class="num"><strong>${r.newBoards}</strong><small>${proof || unit}</small></td>
        <td class="num">${r.spareBoards}<small>${r.spare}% spare</small></td>
        <td class="num">${r.toBuy ? `<span class="big">${r.toBuy}</span>` : '<span class="ok-text">Covered</span>'}${r.flagged ? `<small>${r.flagged} ${r.flagged === 1 ? 'line' : 'lines'} flagged</small>` : ''}</td>
        <td class="num">${r.toBuy === 0 ? '—' : r.cost != null ? money(r.cost) : '<small>Add a price in the sheet</small>'}</td>
      </tr>`;
    }).join('');
    $('lumberTable').innerHTML = `<thead><tr><th scope="col">Size</th><th scope="col" class="num">Left to cut</th><th scope="col" class="num">Spare on hand</th>
      <th scope="col" class="num">From spare</th><th scope="col" class="num">New needed</th><th scope="col" class="num">Extra</th>
      <th scope="col" class="num">To buy</th><th scope="col" class="num">Est. cost</th></tr></thead>
      <tbody>${rows}</tbody>
      ${anyBuy ? `<tfoot><tr><th scope="row" colspan="7">Estimated total${missingPrice && totalCost ? ' (some prices missing)' : ''}</th><td class="num">${totalCost ? money(totalCost) : '<small>Add prices to see a total</small>'}</td></tr></tfoot>` : ''}`;

    const notes = [`The plan fits every piece still to cut into the spare wood the crew has counted, mixing areas on boards, then covers the rest with new boards. Every cut allows ${C.fmtIn(C.CFG.kerf)} for the blade. <strong>Extra</strong> is a cushion on new boards for miscuts; set it to 0 in the Lumber tab to buy exactly the plan.`];
    // Staleness: sign-offs since each size was counted
    const dimOf = (area, label) => { const sh = d.sheets.find(x => x.name === area); const r = sh && sh.rows.find(x => x.type === 'cut' && x.label === label); return r && r.dim; };
    const stale = report.filter(r => r.onHand && r.countedAt).map(r => {
      const since = (d.log || []).filter(e => e.time > r.countedAt && dimOf(e.area, e.label) === r.size).length;
      return since ? `${C.esc(r.size)} was counted ${C.esc(C.timeAgo(r.countedAt))} by ${C.esc(r.countedBy)}, and ${since} ${r.size} ${since === 1 ? 'line has' : 'lines have'} been signed off since` : '';
    }).filter(Boolean);
    if (stale.length) notes.push(`<strong>Recount before buying:</strong> ${stale.join('; ')}. Pieces cut since then used some of that wood, so the spare count is probably high.`);
    const uncounted = report.filter(r => !r.onHand && r.left).map(r => C.esc(r.size));
    if (uncounted.length) notes.push(`No spare wood counted for ${uncounted.join(', ')}. Until someone counts, the plan assumes every piece needs new lumber.`);
    const tooLong = report.filter(r => r.plan && r.plan.tooLong.length);
    if (tooLong.length) notes.push(`<strong>${tooLong.map(r => `${r.plan.tooLong.length} ${C.esc(r.size)} ${r.plan.tooLong.length === 1 ? 'piece is' : 'pieces are'} longer than any board`).join('; ')}.</strong>`);
    const unusedStock = report.filter(r => r.plan && r.plan.stockLeft.length);
    if (unusedStock.length) notes.push(`Spare boards not needed by the plan: ${unusedStock.map(r => `${r.plan.stockLeft.length} ${C.esc(r.size)}`).join(', ')}.`);
    $('lumberNote').innerHTML = notes.join(' ');

    // What's on hand, by length
    const detail = report.filter(r => r.stockRows.length).map(r =>
      `<li><strong>${C.esc(r.size)}:</strong> ${r.stockRows.map(x => r.sheet ? `${x.count} sheets` : `${C.esc(C.fmtIn(x.length))} ×${x.count}`).join(', ')}</li>`).join('');
    $('stockDetail').hidden = !detail;
    $('stockDetail').innerHTML = detail ? `<summary><span class="grow">Spare wood on file, by length</span></summary><ul style="margin:0;padding:4px 14px 14px 34px">${detail}</ul>` : '';
  }

  /* ---------- Who's working on what ---------- */
  function renderNow(d) {
    const claims = d.claims || [];
    const nPeople = new Set(claims.map(c => c.name)).size;
    $('nowCount').textContent = claims.length ? `${nPeople} ${nPeople === 1 ? 'person' : 'people'} right now` : '';
    if (!claims.length) {
      $('nowList').innerHTML = '<p class="empty" style="margin:0">Nobody has tapped "I\'m on it" on anything right now. Claims clear when someone signs off, or after 6 hours.</p>';
      return;
    }
    const byName = {};
    claims.forEach(c => { (byName[c.name] = byName[c.name] || []).push(c); });
    const useOf = c => {
      if (c.kind === 'unit') return c.item;
      const sh = d.sheets.find(x => x.name === c.area);
      const r = sh && sh.rows.find(x => x.type === 'cut' && x.label === c.item);
      return r ? `${c.item}, ${r.use}` : c.item;
    };
    $('nowList').innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Person</th><th scope="col">Working on</th></tr></thead><tbody>
      ${Object.keys(byName).sort().map(n => `<tr><th scope="row">${C.esc(n)}</th><td>${byName[n].map(c =>
        `${C.esc(useOf(c))} <span class="when">(${C.esc(c.area)}, ${C.esc(C.timeAgo(c.since))})</span>`).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  /* ---------- Assembly ---------- */
  function renderUnits(d) {
    const units = d.units || [];
    if (!units.length) { $('unitList').innerHTML = '<p class="empty" style="margin:0">No units yet. Add them in the Units tab of the sheet.</p>'; $('unitCount').textContent = ''; return; }
    const st = C.unitStatus(d.sheets, units);
    const label = { Ready: ['Ready to build', 's-tag'], Waiting: ['Waiting on parts', 's-ns'], Building: ['Building', 's-ip'], Built: ['Built', 's-cut'], Finished: ['Finished', 's-cut'], 'Loaded in': ['Loaded in', 's-cut'] };
    const ready = st.filter(x => x.phase === 'Ready').length;
    const doneN = st.filter(x => ['Built', 'Finished', 'Loaded in'].includes(x.phase)).length;
    $('unitCount').textContent = `${doneN} of ${units.length} built, ${ready} ready to start`;
    $('unitList').innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Unit</th><th scope="col">Stage</th><th scope="col">Parts</th><th scope="col">Last sign-off</th></tr></thead><tbody>
      ${units.map((u, i) => {
        const x = st[i], [txt, cls] = label[x.phase] || [x.phase, 's-ns'];
        const parts = x.missing.length
          ? 'Missing ' + x.missing.map(p => `${C.esc(p.label)} ${p.known ? `(${p.need - p.have} more)` : '(not in cut list)'}`).join(', ')
          : '<span class="ok-text">All parts bundled</span>';
        const claim = (d.claims || []).find(c => c.kind === 'unit' && c.area === u.area && c.item === u.unit);
        return `<tr><th scope="row">${C.esc(u.unit)}<small>${C.esc(u.area)}${claim ? `, ${C.esc(claim.name)} is on it` : ''}</small></th>
          <td><span class="pill ${cls}">${C.esc(txt)}</span></td><td>${parts}</td>
          <td>${u.by ? `${C.esc(u.by)}<small>${C.esc(C.timeAgo(u.updated))}${u.photo ? `, <a href="${C.esc(u.photo)}" target="_blank" rel="noopener">photo</a>` : ''}</small>` : '<small>—</small>'}</td></tr>`;
      }).join('')}
    </tbody></table></div>`;
  }

  /* ---------- Crew and PIN resets ---------- */
  function renderCrew(d) {
    const crew = (d.crewInfo || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const active = crew.filter(c => c.active).length;
    $('crewCount').textContent = crew.length ? `${active} active` : '';
    if (!crew.length) { $('crewList').innerHTML = '<p class="empty" style="margin:0">Nobody has joined yet.</p>'; return; }
    $('crewList').innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Name</th><th scope="col">Joined</th><th scope="col">PIN</th></tr></thead><tbody>
      ${crew.map(c => `<tr><th scope="row">${C.esc(c.name)}${c.active ? '' : '<small>Turned off</small>'}</th>
        <td>${c.joined ? C.esc(new Date(c.joined).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : '—'}</td>
        <td>${L.pinOk ? `<button type="button" class="btn-quiet" data-reset="${C.esc(c.name)}" style="min-height:36px;padding:6px 12px">Reset PIN</button>` : '<small>Unlock with the leadership PIN to reset</small>'}
          <span class="reset-result" data-for="${C.esc(c.name)}"></span></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  $('crewList').addEventListener('click', async e => {
    const name = e.target.dataset.reset;
    if (!name) return;
    if (!confirm(`Give ${name} a new PIN? Their old PIN stops working on every device.`)) return;
    e.target.disabled = true;
    try {
      const res = await C.api.post({ action: 'resetPin', pin: L.pin, name });
      if (!res.ok) throw new Error(res.error);
      const out = [...document.querySelectorAll('.reset-result')].find(x => x.dataset.for === name);
      if (out) out.innerHTML = ` <strong class="big" style="margin-left:10px">${C.esc(res.userPin)}</strong> <small>Tell ${C.esc(name.split(' ')[0])} in person.</small>`;
    } catch (err) {
      C.toast(err.message || "Couldn't reset the PIN.");
    }
    e.target.disabled = false;
  });

  /* ---------- Safety ---------- */
  function renderSafety(d) {
    const list = d.safety || [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = list.filter(x => new Date(x.time) >= start);
    const week = list.filter(x => new Date(x.time) >= new Date(Date.now() - 7 * 86400000));
    const people = new Set(week.map(x => x.name));
    $('safetyCount').textContent = week.length ? `${people.size} ${people.size === 1 ? 'person' : 'people'} this week` : '';
    $('safetyList').innerHTML = today.length
      ? `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Checked in today</th><th scope="col">Time</th></tr></thead><tbody>
          ${today.map(x => `<tr><td>${C.esc(x.name)}</td><td>${C.esc(new Date(x.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</td></tr>`).join('')}
        </tbody></table></div>`
      : `<p class="empty" style="margin:0">No check-ins yet today. Check-ins are optional; the crew page offers one at the start of each day.</p>`;
  }

  /* ---------- Flagged ---------- */
  function renderFlagged(d) {
    const rows = [];
    d.sheets.forEach(sh => cutsOf(sh).forEach(r => { if (r.status === 'Need to Purchase') rows.push({ area: sh.name, r }); }));
    if (!rows.length) { $('flagged').innerHTML = '<p class="empty" style="margin:0">Nothing is flagged as Need to Purchase.</p>'; return; }
    $('flagged').innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Area</th><th scope="col">Label</th><th scope="col">Use</th>
      <th scope="col">Size</th><th scope="col">Length</th><th scope="col" class="num">Left to cut</th><th scope="col">Flagged by</th></tr></thead><tbody>
      ${rows.map(({ area, r }) => `<tr><td>${C.esc(area)}</td><td><span class="area-name">${C.esc(r.label)}</span></td><td>${C.esc(r.use)}</td><td>${C.esc(r.dim)}</td>
        <td>${C.esc(r.length || '—')}</td><td class="num">${C.leftToCut(r, r.qty)} of ${r.qty}</td><td>${r.by ? `${C.esc(r.by)}<small>${C.esc(C.timeAgo(r.updated))}</small>` : '<small>Set in the sheet</small>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* ---------- Inbox ---------- */
  function renderPinbar() {
    if (L.pinOk) {
      $('pinbar').innerHTML = `<p class="hint" style="margin:0">Replying as <strong>${C.esc(L.leadName || 'Leadership')}</strong>. <button type="button" class="linkish" id="lockBtn">Lock replies</button></p>`;
      return;
    }
    $('pinbar').innerHTML = `<div class="pinbar">
      <div class="field"><label for="leadName">Your name</label><input type="text" id="leadName" autocomplete="name" value="${C.esc(L.leadName)}"></div>
      <div class="field"><label for="pinInput">Leadership PIN</label><input type="password" id="pinInput" inputmode="numeric" autocomplete="off"></div>
      <button type="button" class="btn" id="unlockBtn">Unlock replies</button>
      <p class="hint">Anyone with this page can read messages. The PIN is only needed to reply.${C.DEMO ? ' In demo mode the PIN is 1234.' : ''}</p>
      <p class="form-error" id="pinError" hidden style="flex-basis:100%;margin:0"></p>
    </div>`;
  }

  function msgHTML(m) {
    const photo = m.photo ? `<a class="thumb" href="${C.esc(C.photoLink(m.photo) || C.photoThumb(m.photo, 1600))}" target="_blank" rel="noopener"><img src="${C.esc(C.photoThumb(m.photo))}" alt="Photo attached by ${C.esc(m.name)}" loading="lazy"></a>` : '';
    const about = [m.area, m.label].filter(Boolean).map(C.esc).join(', ');
    const open = m.status === 'Open';
    return `<li class="${photo ? '' : 'no-photo'}" data-id="${C.esc(m.id)}">${photo}<div>
      <p class="who"><span class="pill ${m.type === 'Question' ? 's-cut' : 's-ns'}">${C.esc(m.type)}</span> <strong>${C.esc(m.name)}</strong>
        <span class="when">${C.esc(C.timeAgo(m.time))}${about ? `, about ${about}` : ''}</span></p>
      <p class="body">${C.esc(m.message)}</p>
      ${m.reply ? `<p class="reply"><strong>${C.esc(m.repliedBy || 'Leadership')}:</strong> ${C.esc(m.reply)}</p>` : ''}
      ${!open && !m.reply ? `<p class="when" style="margin-top:6px">Closed by ${C.esc(m.repliedBy || 'leadership')}</p>` : ''}
      ${open && L.pinOk ? `<label class="sr-only" for="r-${C.esc(m.id)}">Reply to ${C.esc(m.name)}</label>
        <textarea id="r-${C.esc(m.id)}" data-draft="${C.esc(m.id)}" placeholder="${m.type === 'Question' ? 'Write an answer. The whole crew will see it.' : 'Optional reply'}">${C.esc(L.drafts[m.id] || '')}</textarea>
        <div class="msg-actions"><button type="button" class="btn" data-reply="${C.esc(m.id)}">Send reply</button>
        <button type="button" class="btn-quiet" data-close-msg="${C.esc(m.id)}">${m.type === 'Question' ? 'Close without replying' : 'Mark as read'}</button></div>` : ''}
    </div></li>`;
  }

  function renderInbox(d) {
    renderPinbar();
    const msgs = d.messages || [];
    const open = msgs.filter(m => m.status === 'Open');
    const done = msgs.filter(m => m.status !== 'Open');
    $('inboxCount').textContent = open.length ? `${open.length} open` : '';
    $('inbox').innerHTML =
      (open.length ? `<ul class="feed">${open.map(msgHTML).join('')}</ul>` : '<p class="empty" style="margin:0">No open questions or notes.</p>') +
      (done.length ? `<details class="area-detail" style="margin-top:12px" ${L.open.has('__answered') ? 'open' : ''} data-key="__answered"><summary><span class="grow">Answered and closed</span><span class="when">${done.length}</span></summary>
        <ul class="feed" style="border:0;border-top:1px solid var(--line);border-radius:0">${done.map(msgHTML).join('')}</ul></details>` : '');
  }

  $('pinbar').addEventListener('click', async e => {
    if (e.target.id === 'lockBtn') { L.pinOk = false; L.pin = ''; C.store.del('pin'); renderInbox(L.data); renderCrew(L.data); return; }
    if (e.target.id !== 'unlockBtn') return;
    const pin = $('pinInput').value.trim();
    const name = $('leadName').value.trim();
    const err = $('pinError');
    if (!name) { err.textContent = 'Add your name so the crew knows who answered.'; err.hidden = false; return; }
    try {
      const res = await C.api.post({ action: 'checkPin', pin });
      if (!res.ok) throw new Error(res.error);
      L.pin = pin; L.pinOk = true; L.leadName = name;
      C.store.set('pin', pin); C.store.set('leadName', name);
      renderInbox(L.data);
      renderCrew(L.data);
    } catch (e2) {
      err.textContent = e2.message || "Couldn't check the PIN."; err.hidden = false;
    }
  });
  $('pinbar').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pinInput') $('unlockBtn').click(); });

  $('inbox').addEventListener('input', e => { if (e.target.dataset.draft) L.drafts[e.target.dataset.draft] = e.target.value; });
  $('inbox').addEventListener('click', async e => {
    const replyId = e.target.dataset.reply;
    const closeId = e.target.dataset.closeMsg;
    if (!replyId && !closeId) return;
    const id = replyId || closeId;
    const reply = replyId ? (L.drafts[id] || '').trim() : '';
    if (replyId && !reply) { C.toast('Write a reply first, or close it without replying.'); return; }
    e.target.disabled = true;
    try {
      const res = await C.api.post({ action: 'reply', pin: L.pin, id, reply, name: L.leadName });
      if (!res.ok) throw new Error(res.error);
      delete L.drafts[id];
      C.toast(replyId ? 'Reply sent. The crew can see it now.' : 'Closed.');
      document.activeElement && document.activeElement.blur();
      await load();
    } catch (err) {
      e.target.disabled = false;
      C.toast(err.message || "Couldn't send. Try again.");
      if (/PIN/.test(err.message || '')) { L.pinOk = false; C.store.del('pin'); renderInbox(L.data); }
    }
  });

  /* ---------- Sign-off feed ---------- */
  function renderLog(d) {
    const batches = [];
    const byId = new Map();
    (d.log || []).forEach(e => {
      const k = e.batch || e.time + e.name;
      if (!byId.has(k)) { const b = { time: e.time, name: e.name, note: e.note, photo: e.photo, changes: [] }; byId.set(k, b); batches.push(b); }
      byId.get(k).changes.push(e);
    });
    if (!batches.length) { $('log').innerHTML = '<p class="empty" style="margin:0">No sign-offs yet. They show up here with the crew member\'s photo.</p>'; return; }
    const qtyOf = e => {
      const sh = d.sheets.find(s => s.name === e.area);
      const r = sh && sh.rows.find(x => x.type === 'cut' && x.label === e.label);
      return r ? r.qty : null;
    };
    const line = e => {
      const q = qtyOf(e);
      const parts = [];
      if (e.statusFrom !== e.statusTo) parts.push(`${C.esc(e.statusFrom)} → ${C.esc(e.statusTo)}`);
      if (q) {
        const a = C.effDone({ status: e.statusFrom, done: e.doneFrom }, q), b = C.effDone({ status: e.statusTo, done: e.doneTo }, q);
        if (a !== b && q > 1) parts.push(`${a} → ${b} of ${q} bundled`);
      }
      return `<li><strong>${C.esc(e.label)}</strong> <span class="when">(${C.esc(e.area)})</span> ${parts.join(', ')}</li>`;
    };
    $('log').innerHTML = `<ul class="feed">${batches.slice(0, L.logShown).map(b => {
      const img = b.photo ? `<a class="thumb" href="${C.esc(C.photoLink(b.photo) || '#')}" target="_blank" rel="noopener"><img src="${C.esc(C.photoThumb(b.photo))}" alt="Sign-off photo from ${C.esc(b.name)}" loading="lazy"></a>` : '';
      return `<li class="${img ? '' : 'no-photo'}">${img}<div>
        <p class="who"><strong>${C.esc(b.name)}</strong> <span class="when">${C.esc(C.timeAgo(b.time))}</span></p>
        <ul class="changes">${b.changes.map(line).join('')}</ul>
        ${b.note ? `<p class="note">${C.esc(b.note)}</p>` : ''}
      </div></li>`;
    }).join('')}</ul>` + (batches.length > L.logShown ? `<button type="button" class="btn-quiet more" id="moreLog">Show more sign-offs</button>` : '');
  }
  $('log').addEventListener('click', e => { if (e.target.id === 'moreLog') { L.logShown += 20; renderLog(L.data); } });

  /* ---------- Every cut ---------- */
  function renderAllCuts(d) {
    $('allCuts').innerHTML = d.sheets.map(sh => {
      const cuts = cutsOf(sh);
      let done = 0, total = 0;
      cuts.forEach(r => { done += C.effDone(r, r.qty); total += r.qty; });
      const rows = sh.rows.map(r => r.type === 'section'
        ? `<tr class="section"><th colspan="7" scope="rowgroup">${C.esc(r.text)}</th></tr>`
        : `<tr class="cut ${C.CLS[r.status] || 's-ns'}">
            <td>${pillFor(r.status)}</td>
            <td><span class="area-name">${C.esc(r.label)}</span><small>${C.esc(C.pieceRange(r.label, r.qty))}</small></td>
            <td>${C.esc(r.use)}</td><td>${C.esc(r.dim)}</td><td>${C.esc(r.length || '—')}</td>
            <td class="num">${C.effDone(r, r.qty)} / ${r.qty}</td>
            <td>${r.by ? `${C.esc(r.by)}<small>${C.esc(C.timeAgo(r.updated))}${r.photo ? `, <a href="${C.esc(r.photo)}" target="_blank" rel="noopener">photo</a>` : ''}</small>` : '<small>—</small>'}</td>
          </tr>`).join('');
      return `<details class="area-detail" data-key="${C.esc(sh.name)}" ${L.open.has(sh.name) ? 'open' : ''}>
        <summary><span class="area-name">${d.tape[sh.name] ? C.swatch(d.tape[sh.name]) : ''}${C.esc(sh.name)}</span>
          <span class="grow">${C.miniBar(done, total)}</span><span class="when">${done} of ${total} bundled</span></summary>
        <div class="table-scroll"><table class="data"><thead><tr><th scope="col">Status</th><th scope="col">Label</th><th scope="col">Use</th><th scope="col">Size</th>
          <th scope="col">Length</th><th scope="col" class="num">Bundled</th><th scope="col">Last sign-off</th></tr></thead><tbody>${rows}</tbody></table></div>
      </details>`;
    }).join('');
  }
  document.addEventListener('toggle', e => {
    const el = e.target;
    if (!(el instanceof HTMLDetailsElement) || !el.dataset.key) return;
    if (el.open) L.open.add(el.dataset.key); else L.open.delete(el.dataset.key);
  }, true);

  /* ---------- Summary email ---------- */
  $('emailBtn').addEventListener('click', async () => {
    if (!L.pinOk) {
      C.toast('Unlock with your leadership PIN under Questions and notes first.');
      const pin = document.getElementById('pinInput');
      if (pin) { pin.scrollIntoView({ behavior: 'smooth', block: 'center' }); pin.focus({ preventScroll: true }); }
      return;
    }
    const btn = $('emailBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await C.api.post({ action: 'sendSummary', pin: L.pin });
      if (!res.ok) throw new Error(res.error);
      C.toast(`Summary sent to ${res.to}. Edit it and forward it to the directors.`);
    } catch (err) {
      C.toast(err.message || "Couldn't send the summary.");
    }
    btn.disabled = false; btn.textContent = 'Email me a summary';
  });

  /* ---------- Start ---------- */
  const proj = /^cut list$/i.test(C.projectTitle('')) ? '' : C.projectTitle('');
  document.title = `${proj ? proj + ' build overview' : 'Build overview'} | ${C.CFG.appName || 'SawHorse'}`;
  $('title').textContent = proj ? proj + ' build overview' : 'Build overview';
  if (C.CFG.sheetUrl) { $('sheetLink').href = C.CFG.sheetUrl; $('sheetLink').hidden = false; }
  if (L.pin) C.api.post({ action: 'checkPin', pin: L.pin }).then(r => { L.pinOk = !!(r && r.ok); if (L.data) { renderInbox(L.data); renderCrew(L.data); } }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, Math.max(20, C.CFG.pollSeconds * 2) * 1000);
  load();
})();
