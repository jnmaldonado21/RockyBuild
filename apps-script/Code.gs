/**
 * Cut list tracker: Google Apps Script backend (v2)
 *
 * Paste into Extensions > Apps Script from inside the Google Sheet.
 * Run setup() once, then deploy as a web app. See README.md.
 *
 * Tabs this script reads:
 *   Cut tabs     Any visible tab with a "Label/ID" header (Framing, Mausoleum, ...).
 *                Rows with Use but no Label/ID are section dividers.
 *   Crew         One row per person: name, 4-digit PIN, when they joined, and Active (Yes/No).
 *                People add themselves from the crew page; setup() gives a PIN to any row without one.
 *   Tape Colors  Area name + tape color for bundling.
 *   Lumber       New-board length, price, and extra % per size.
 *   Stock        Spare wood on hand: size, length, count. Written by the crew's count form.
 *   Units        Things that get built (wall, doors, roofs, platform...), the pieces each uses, and its stage.
 *   Claims       Written by the tool: who's working on which line or unit right now.
 *   Log          Written by the tool: one row per signed-off change.
 *   Messages     Written by the tool: notes and questions for leadership.
 *   Safety       Written by the tool: optional daily safety check-ins.
 *   Settings     Summary email address, send time, and the leadership page link.
 *
 * Script properties (Project Settings > Script properties):
 *   LEAD_PIN         PIN leadership uses to reply to messages. setup() creates one.
 *   PHOTO_FOLDER_ID  Drive folder for sign-off photos. setup() creates it.
 */

const HEADER_CELL = 'Label/ID';
const STATUSES = ['Not Started', 'In Progress', 'Cut', 'Bundled', 'Need to Purchase'];
const LEGACY_STATUS = { 'Tagged': 'Bundled' };
const STATUS_COLORS = {
  'Not Started': '#E6E9EC',
  'In Progress': '#FED7AA',
  'Cut': '#BFDBFE',
  'Bundled': '#BBF7D0',
  'Need to Purchase': '#FECACA'
};
const TRACK_COLS = ['Status', 'Done', 'Updated', 'Updated By', 'Photo'];
const MESSAGE_TYPES = ['Question', 'Note'];
const DEFAULT_TAPE = ['Red', 'Yellow', 'Blue', 'Green'];
const KERF = 0.125;

const TABS = {
  crew:     { name: 'Crew',        headers: ['Name', 'PIN', 'Joined', 'Active'] },
  tape:     { name: 'Tape Colors', headers: ['Area', 'Tape color'] },
  lumber:   { name: 'Lumber',      headers: ['Size', 'Board length (in)', 'Price each', 'Spare %'] },
  stock:    { name: 'Stock',       headers: ['Size', 'Length (in)', 'Count', 'Counted by', 'Counted at', 'Note'] },
  log:      { name: 'Log',         headers: ['Time', 'Batch', 'Name', 'Area', 'Label', 'Status before', 'Status after', 'Tagged before', 'Tagged after', 'Photo', 'Note'] },
  messages: { name: 'Messages',    headers: ['Time', 'ID', 'Name', 'Type', 'Area', 'Label', 'Message', 'Photo', 'Status', 'Reply', 'Replied by', 'Replied at'] },
  safety:   { name: 'Safety',      headers: ['Time', 'Name', 'Items confirmed'] },
  units:    { name: 'Units',       headers: ['Area', 'Unit', 'Parts', 'Stage', 'Updated', 'Updated By', 'Photo', 'Notes'] },
  claims:   { name: 'Claims',      headers: ['Kind', 'Area', 'Item', 'Name', 'Since'] },
  settings: { name: 'Settings',    headers: ['Setting', 'Value', 'Notes'] }
};
const SETTINGS_DEFAULTS = [
  ['Summary email', '', 'Where the daily summary goes. Blank = the sheet owner.'],
  ['Summary hour', 20, 'Hour of day to send, 0-23 (20 = 8 PM), in the sheet\'s time zone. Rerun setup() after changing.'],
  ['Send when nothing changed', 'No', 'Yes = send every day, even with no new sign-offs or messages.'],
  ['Leadership page URL', '', 'Your GitHub Pages leadership.html link, shown in the email.']
];
const HELPER_TAB_NAMES = Object.keys(TABS).map(function (k) { return TABS[k].name; });
const CACHE_KEY = 'crew-view-v3';
const UNIT_STAGES = ['Not started', 'Building', 'Built', 'Finished', 'Loaded in'];
const CLAIM_HOURS = 6;   // a claim quietly expires after this long
// Starting unit list, written by setup() only if the Units tab is empty. Edit freely in the sheet.
const DEFAULT_UNITS = [
  ["Framing", "Front wall framing", "A×20, B×8, C×13, D×4, E×2"],
  ["Framing", "Front wall MDF", "P×9"],
  ["Framing", "Upper back wall MDF", "P×9"],
  ["Framing", "4' door #1", "F×2, G×2, H×2"],
  ["Framing", "4' door #2", "F×2, G×2, H×2"],
  ["Framing", "2' door #1", "I×2, J×2, K×2"],
  ["Framing", "2' door #2", "I×2, J×2, K×2"],
  ["Framing", "2' door #3", "I×2, J×2, K×2"],
  ["Framing", "2' door #4", "I×2, J×2, K×2"],
  ["Framing", "Lower roof", "L×9, N×9, O×7"],
  ["Framing", "Upper roof", "M×9, N×9, O×7"],
  ["Framing", "Railing", "Q×12"],
  ["Mausoleum", "Mausoleum", "R×5, S×2, T×2, U×5, V×1, W×2, X×5, Y×3, Z×1, AA×2, AB×4, AC×2"],
  ["King Cake", "Rolling platform", "AD×3, AE×11, AF×4, AG×2, AH×3, AI×2"],
  ["King Cake", "King cake frame", "AJ×7, AK×7, AL×4, AM×2, AN×1, AO×6, AP×2, AQ×6"],
  ["Frank Float", "Jaw frame", "AR×2, AS×4, AT×15"]
];

/* =================== Web app =================== */

function doGet(e) {
  const view = (e && e.parameter && e.parameter.view) || 'crew';
  try {
    if (view === 'lead') return json_(buildView_(true));
    const cache = CacheService.getScriptCache();
    const hit = cache.get(CACHE_KEY);
    if (hit) return text_(hit);
    const out = JSON.stringify(buildView_(false));
    if (out.length < 95000) cache.put(CACHE_KEY, out, 15);
    return text_(out);
  } catch (err) {
    return json_({ ok: false, error: msg_(err) });
  }
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    let result;
    switch (req.action) {
      case 'signup':   result = signup_(req); break;
      case 'signin':   verifyUser_(req); result = { ok: true, name: req.name }; break;
      case 'resetPin': checkPin_(req.pin); result = resetPin_(req); break;
      case 'signoff':  verifyUser_(req); result = signoff_(req); break;
      case 'message':  verifyUser_(req); result = message_(req); break;
      case 'reply':    result = reply_(req); break;
      case 'safety':   verifyUser_(req); result = safety_(req); break;
      case 'stockCount': verifyUser_(req); result = stockCount_(req); break;
      case 'claim':    verifyUser_(req); result = claim_(req); break;
      case 'release':  verifyUser_(req); result = release_(req); break;
      case 'sendSummary': checkPin_(req.pin); sendSummary_(true); result = { ok: true, to: summaryRecipient_() }; break;
      case 'checkPin': checkPin_(req.pin); result = { ok: true }; break;
      default: throw new Error('Unknown action: ' + req.action);
    }
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: msg_(err), auth: !!(err && err.auth) });
  }
}

/* =================== Reading =================== */

function buildView_(lead) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.isSheetHidden() || HELPER_TAB_NAMES.indexOf(sh.getName()) !== -1) return;
    const parsed = parseSheet_(sh);
    if (parsed) sheets.push(parsed);
  });
  const out = {
    ok: true,
    sheets: sheets,
    crew: readCrew_(ss).filter(function (c) { return c.active; }).map(function (c) { return c.name; }),
    tape: readTape_(ss),
    lumber: readLumber_(ss),
    stock: readStock_(ss),
    units: readUnits_(ss),
    claims: readClaims_(ss),
    messages: readMessages_(ss, lead),
    serverTime: new Date().toISOString()
  };
  if (lead) {
    out.log = readLog_(ss, 400);
    out.safety = readSafety_(ss, 300);
    out.crewInfo = readCrew_(ss).map(function (c) { return { name: c.name, joined: c.joined, active: c.active, hasPin: !!c.pin }; });
  }
  return out;
}

function locate_(sh) {
  const range = sh.getDataRange();
  const display = range.getDisplayValues();
  const scan = Math.min(display.length, 15);
  for (let r = 0; r < scan; r++) {
    if (!display[r].some(function (v) { return String(v).trim() === HEADER_CELL; })) continue;
    const cols = {};
    display[r].forEach(function (h, i) {
      const k = String(h).trim().toLowerCase();
      if (k && cols[k] === undefined) cols[k] = i;
    });
    return { values: display, raw: range.getValues(), headerRow: r, cols: cols };
  }
  return null;
}

function cell_(loc, r, key) {
  const i = loc.cols[key];
  const row = loc.values[r];
  return i === undefined || !row || i >= row.length ? '' : String(row[i]).trim();
}

function rowState_(loc, r) {
  const qty = Math.max(1, Math.round(parseFloat(cell_(loc, r, 'quantity'))) || 1);
  return {
    qty: qty,
    status: normStatus_(cell_(loc, r, 'status')),
    done: clamp_(parseInt(cell_(loc, r, 'done'), 10) || 0, 0, qty)
  };
}

function parseSheet_(sh) {
  const loc = locate_(sh);
  if (!loc) return null;
  const rows = [];
  for (let r = loc.headerRow + 1; r < loc.values.length; r++) {
    const label = cell_(loc, r, 'label/id');
    const use = cell_(loc, r, 'use');
    if (!label && !use) continue;
    if (!label) { rows.push({ type: 'section', text: use }); continue; }
    const st = rowState_(loc, r);
    const upIdx = loc.cols['updated'];
    const up = upIdx === undefined ? '' : loc.raw[r][upIdx];
    rows.push({
      type: 'cut',
      row: r + 1,
      label: label,
      use: use,
      dim: cell_(loc, r, 'dimension'),
      length: cleanLength_(cell_(loc, r, 'length')),
      qty: st.qty,
      status: st.status,
      done: st.done,
      updated: up instanceof Date ? up.toISOString() : '',
      by: cell_(loc, r, 'updated by'),
      photo: cell_(loc, r, 'photo')
    });
  }
  return { name: sh.getName(), rows: rows };
}

function readTable_(ss, def) {
  const sh = ss.getSheetByName(def.name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), def.headers.length)).getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const obj = { _row: r + 1 };
    let any = false;
    head.forEach(function (h, i) {
      if (!h) return;
      let v = values[r][i];
      if (v instanceof Date) v = v.toISOString();
      else v = typeof v === 'string' ? v.trim() : v;
      if (v !== '' && v !== null) any = true;
      obj[h] = v;
    });
    if (any) out.push(obj);
  }
  return out;
}

function readTape_(ss) {
  const map = {};
  readTable_(ss, TABS.tape).forEach(function (r) {
    if (r['Area']) map[String(r['Area'])] = String(r['Tape color'] || '');
  });
  return map;
}

function readLumber_(ss) {
  return readTable_(ss, TABS.lumber).filter(function (r) { return r['Size']; }).map(function (r) {
    return {
      size: String(r['Size']),
      boardLength: num_(r['Board length (in)']),
      price: num_(r['Price each']),
      spare: pickSpare_(r, String(r['Size']))
    };
  });
}

function readLog_(ss, limit) {
  return readTable_(ss, TABS.log).slice(-limit).reverse().map(function (r) {
    return {
      time: r['Time'], batch: r['Batch'], name: r['Name'], area: r['Area'], label: r['Label'],
      statusFrom: legacy_(r['Status before']), statusTo: legacy_(r['Status after']),
      doneFrom: num_(r['Tagged before']) || 0, doneTo: num_(r['Tagged after']) || 0,
      photo: r['Photo'], note: r['Note']
    };
  });
}

function readMessages_(ss, lead) {
  let rows = readTable_(ss, TABS.messages).map(function (r) {
    return {
      time: r['Time'], id: r['ID'], name: r['Name'], type: r['Type'], area: r['Area'], label: r['Label'],
      message: r['Message'], photo: r['Photo'], status: r['Status'] || 'Open',
      reply: r['Reply'], repliedBy: r['Replied by'], repliedAt: r['Replied at']
    };
  }).reverse();
  if (!lead) {
    // The crew only sees answered questions, so everyone benefits from the answer.
    rows = rows.filter(function (m) { return m.type === 'Question' && m.status === 'Answered' && m.reply; })
      .slice(0, 40)
      .map(function (m) { return { time: m.time, name: m.name, area: m.area, label: m.label, message: m.message, reply: m.reply, repliedBy: m.repliedBy, repliedAt: m.repliedAt }; });
  }
  return rows.slice(0, 300);
}

/* =================== Writing =================== */

function signoff_(req) {
  const name = clean_(req.name, 80);
  if (!name) throw new Error('Add your name before saving.');
  if (!req.photo || !req.photo.data) throw new Error('Add a photo of the finished work before saving.');
  const changes = Array.isArray(req.changes) ? req.changes : [];
  if (!changes.length) throw new Error('There are no changes to save.');
  if (changes.length > 300) throw new Error('Too many changes in one sign-off. Save in smaller batches.');
  const note = clean_(req.note, 2000);
  const batch = Utilities.getUuid().slice(0, 8);

  // Save the photo before taking the lock so the lock is held briefly.
  const photo = savePhoto_(req.photo, 'signoff ' + batch + ' ' + name);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const locs = {};
    const plan = [];
    const conflicts = [];

    let unitSheet = null, unitRows = null, unitCols = null;
    changes.forEach(function (c) {
      if (c.kind === 'unit') {
        if (!unitSheet) {
          unitSheet = ensureTab_(ss, TABS.units);
          unitRows = readTable_(ss, TABS.units);
          const head = unitSheet.getRange(1, 1, 1, unitSheet.getLastColumn()).getValues()[0].map(String);
          unitCols = function (h) { return head.indexOf(h) + 1; };
        }
        const hit = unitRows.filter(function (r) { return r._row === Number(c.row) && String(r['Unit']) === String(c.label) && String(r['Area']) === String(c.sheet); })[0] ||
                    unitRows.filter(function (r) { return String(r['Unit']) === String(c.label) && String(r['Area']) === String(c.sheet); })[0];
        if (!hit) { conflicts.push({ kind: 'unit', sheet: c.sheet, label: c.label, reason: 'unit not found' }); return; }
        const curStage = UNIT_STAGES.indexOf(String(hit['Stage'])) === -1 ? 'Not started' : String(hit['Stage']);
        if (curStage !== (c.from || {}).status) { conflicts.push({ kind: 'unit', sheet: c.sheet, label: c.label, reason: 'changed by someone else', current: { status: curStage } }); return; }
        if (UNIT_STAGES.indexOf((c.to || {}).status) === -1) throw new Error('Unknown stage: ' + (c.to || {}).status);
        plan.push({ kind: 'unit', sheet: c.sheet, label: String(c.label), rowNum: hit._row, cur: { status: curStage, done: 0 }, to: { status: c.to.status, done: 0 } });
        return;
      }
      const sh = ss.getSheetByName(String(c.sheet));
      if (!sh) { conflicts.push({ sheet: c.sheet, label: c.label, reason: 'area not found' }); return; }
      if (!locs[c.sheet]) {
        const loc = locate_(sh);
        if (!loc) { conflicts.push({ sheet: c.sheet, label: c.label, reason: 'area has no Label/ID header' }); return; }
        locs[c.sheet] = { sh: sh, loc: ensureColumns_(sh, loc) };
      }
      const L = locs[c.sheet];
      const r0 = findRow_(L.loc, String(c.label), Number(c.row));
      if (r0 === -1) { conflicts.push({ sheet: c.sheet, label: c.label, reason: 'label not found' }); return; }
      const cur = rowState_(L.loc, r0);
      const from = c.from || {};
      if (cur.status !== from.status || cur.done !== Number(from.done)) {
        conflicts.push({ sheet: c.sheet, label: c.label, reason: 'changed by someone else', current: cur });
        return;
      }
      const to = c.to || {};
      if (STATUSES.indexOf(to.status) === -1) throw new Error('Unknown status: ' + to.status);
      plan.push({ sheet: c.sheet, label: String(c.label), sh: L.sh, loc: L.loc, r0: r0, cur: cur,
                  to: { status: to.status, done: clamp_(parseInt(to.done, 10) || 0, 0, cur.qty) } });
    });

    if (conflicts.length) {
      try { photo.file.setTrashed(true); } catch (ignored) {}
      return { ok: false, conflicts: conflicts, error: 'Some lines changed while you were working.' };
    }

    const now = new Date();
    plan.forEach(function (p) {
      if (p.kind === 'unit') {
        unitSheet.getRange(p.rowNum, unitCols('Stage'), 1, 4).setValues([[p.to.status, now, name, photo.url]]);
      } else {
        writeTracking_(p.sh, p.loc, p.r0 + 1, [p.to.status, p.to.done, now, name, photo.url]);
      }
    });
    // Finished work releases the signer's claim on it.
    releaseWhere_(function (c) {
      return plan.some(function (p) {
        const finished = p.kind === 'unit' ? ['Built', 'Finished', 'Loaded in'].indexOf(p.to.status) !== -1
                                           : ['Bundled', 'Need to Purchase'].indexOf(p.to.status) !== -1;
        return finished && c.kind === (p.kind === 'unit' ? 'unit' : 'cut') && c.area === p.sheet && c.item === p.label;
      });
    });

    const logSheet = ensureTab_(ss, TABS.log);
    const logRows = plan.map(function (p) {
      return [now, batch, name, p.sheet, p.label, p.cur.status, p.to.status, p.cur.done, p.to.done, photo.url, note];
    });
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);

    return {
      ok: true, batch: batch, photo: photo.url,
      rows: plan.map(function (p) { return { sheet: p.sheet, label: p.label, row: p.kind === 'unit' ? p.rowNum : p.r0 + 1, status: p.to.status, done: p.to.done }; })
    };
  } finally {
    lock.releaseLock();
  }
}

function message_(req) {
  const name = clean_(req.name, 80);
  const text = clean_(req.message, 3000);
  if (!name) throw new Error('Add your name before sending.');
  if (!text) throw new Error('Write a message before sending.');
  const type = MESSAGE_TYPES.indexOf(req.type) === -1 ? 'Note' : req.type;
  const id = Utilities.getUuid().slice(0, 8);
  const photoUrl = req.photo && req.photo.data ? savePhoto_(req.photo, 'message ' + id + ' ' + name).url : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), TABS.messages);
    sh.appendRow([new Date(), id, name, type, clean_(req.area, 100), clean_(req.label, 20), text, photoUrl, 'Open', '', '', '']);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, id: id };
}

function reply_(req) {
  checkPin_(req.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), TABS.messages);
    const rows = readTable_(SpreadsheetApp.getActiveSpreadsheet(), TABS.messages);
    const hit = rows.filter(function (r) { return String(r['ID']) === String(req.id); })[0];
    if (!hit) throw new Error('That message no longer exists.');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const col = function (h) { return head.indexOf(h) + 1; };
    const reply = clean_(req.reply, 3000);
    sh.getRange(hit._row, col('Status')).setValue(reply ? 'Answered' : 'Closed');
    sh.getRange(hit._row, col('Reply')).setValue(reply);
    sh.getRange(hit._row, col('Replied by')).setValue(clean_(req.name, 80) || 'Leadership');
    sh.getRange(hit._row, col('Replied at')).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function checkPin_(pin) {
  const real = PropertiesService.getScriptProperties().getProperty('LEAD_PIN');
  if (!real) throw new Error('No leadership PIN is set. Run setup() in Apps Script.');
  if (String(pin || '').trim() !== String(real).trim()) throw new Error('That PIN is not right.');
}

function findRow_(loc, label, rowHint) {
  const labelCol = loc.cols['label/id'];
  const matches = function (i) {
    return i > loc.headerRow && loc.values[i] && String(loc.values[i][labelCol]).trim() === label;
  };
  if (matches(rowHint - 1)) return rowHint - 1;
  for (let i = loc.headerRow + 1; i < loc.values.length; i++) if (matches(i)) return i;
  return -1;
}

function writeTracking_(sh, loc, rowNum, vals) {
  const idx = TRACK_COLS.map(function (c) { return loc.cols[c.toLowerCase()]; });
  const contiguous = idx.every(function (v, i) { return i === 0 || v === idx[i - 1] + 1; });
  if (contiguous) {
    sh.getRange(rowNum, idx[0] + 1, 1, vals.length).setValues([vals]);
  } else {
    idx.forEach(function (c, i) { sh.getRange(rowNum, c + 1).setValue(vals[i]); });
  }
}

function ensureColumns_(sh, loc) {
  const missing = TRACK_COLS.filter(function (c) { return loc.cols[c.toLowerCase()] === undefined; });
  if (!missing.length) return loc;
  let last = -1;
  loc.values[loc.headerRow].forEach(function (h, i) { if (String(h).trim()) last = i; });
  missing.forEach(function (name, n) {
    sh.getRange(loc.headerRow + 1, last + 2 + n).setValue(name).setFontWeight('bold');
  });
  SpreadsheetApp.flush();
  return locate_(sh);
}

function ensureTab_(ss, def) {
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function savePhoto_(photo, name) {
  const m = String(photo.data).match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
  const type = m ? m[1] : 'image/jpeg';
  const b64 = m ? m[2] : String(photo.data);
  if (b64.length > 10000000) throw new Error('That photo is too large. Try again with a smaller one.');
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), type, name.replace(/[^\w .-]/g, '') + '.jpg');
  const file = photoFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (ignored) {}
  return { file: file, url: file.getUrl() };
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (ignored) {}
  }
  const folder = DriveApp.createFolder('Cut list photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function readSafety_(ss, limit) {
  return readTable_(ss, TABS.safety).slice(-limit).reverse().map(function (r) {
    return { time: r['Time'], name: r['Name'], items: num_(r['Items confirmed']) || 0 };
  });
}

function safety_(req) {
  const name = clean_(req.name, 80);
  if (!name) throw new Error('Add your name to check in.');
  const items = Array.isArray(req.items) ? req.items.length : 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), TABS.safety).appendRow([new Date(), name, items]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function readStock_(ss) {
  return readTable_(ss, TABS.stock).map(function (r) {
    return { size: String(r['Size'] || ''), length: num_(r['Length (in)']) || 0, count: Math.max(0, parseInt(r['Count'], 10) || 0),
             by: r['Counted by'] || '', at: r['Counted at'] || '' };
  }).filter(function (r) { return r.size && r.count > 0; });
}

function stockCount_(req) {
  const name = clean_(req.name, 80);
  const size = clean_(req.size, 40);
  if (!name) throw new Error('Add your name before saving the count.');
  if (!size) throw new Error('Pick a size.');
  const boards = (Array.isArray(req.boards) ? req.boards : []).map(function (b) {
    return { length: Math.max(0, num_(b.length) || 0), count: parseInt(b.count, 10) || 0 };
  }).filter(function (b) { return b.count > 0; });
  if (!boards.length) throw new Error('Add at least one length and count.');
  const replace = req.mode === 'replace';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), TABS.stock);
    if (replace && sh.getLastRow() > 1) {
      const sizes = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (let i = sizes.length - 1; i >= 0; i--) if (String(sizes[i][0]).trim() === size) sh.deleteRow(i + 2);
    }
    const now = new Date();
    const rows = boards.map(function (b) { return [size, b.length || '', b.count, name, now, replace ? 'Recount' : 'Added']; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/* =================== Crew sign-up and PINs =================== */

function readCrew_(ss) {
  return readTable_(ss, TABS.crew).filter(function (r) { return String(r['Name'] || '').trim(); }).map(function (r) {
    return {
      row: r._row, name: String(r['Name']).trim(), pin: String(r['PIN'] === undefined ? '' : r['PIN']).trim(),
      joined: r['Joined'] || '', active: !/^no$/i.test(String(r['Active'] || '').trim())
    };
  });
}

const sameName_ = function (a, b) { return String(a).trim().replace(/\s+/g, ' ').toLowerCase() === String(b).trim().replace(/\s+/g, ' ').toLowerCase(); };
const newPin_ = function () { return String(Math.floor(1000 + Math.random() * 9000)); };

function signup_(req) {
  const name = clean_(req.name, 60).replace(/\s+/g, ' ');
  if (name.length < 2) throw new Error('Enter your first and last name.');
  if (!/[A-Za-z]/.test(name)) throw new Error('Enter your name using letters.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const crew = readCrew_(ss);
    if (crew.length >= 300) throw new Error('The crew list is full. Ask the shop lead.');
    if (crew.some(function (c) { return sameName_(c.name, name); })) {
      throw new Error('Someone named ' + name + ' already signed up. If that\'s you, sign in with your PIN. If not, add a middle initial or nickname.');
    }
    const pin = newPin_();
    const sh = ensureTab_(ss, TABS.crew);
    ensureHeaders_(sh, TABS.crew);
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 2).setNumberFormat('@');
    sh.getRange(row, 1, 1, 4).setValues([[name, pin, new Date(), 'Yes']]);
    return { ok: true, name: name, userPin: pin };
  } finally {
    lock.releaseLock();
  }
}

// Checks name + PIN on every crew write. Five misses locks that name for 15 minutes.
function verifyUser_(req) {
  const name = clean_(req.name, 60);
  const pin = String(req.userPin || '').trim();
  const fail = function (msg) { const e = new Error(msg); e.auth = true; throw e; };
  if (!name || !pin) fail('Sign in with your name and PIN first.');
  const cache = CacheService.getScriptCache();
  const key = 'pinfail:' + name.toLowerCase();
  const misses = parseInt(cache.get(key) || '0', 10);
  if (misses >= 5) fail('Too many wrong PINs for ' + name + '. Wait 15 minutes, or ask the shop lead to reset your PIN.');
  const me = readCrew_(SpreadsheetApp.getActiveSpreadsheet()).filter(function (c) { return sameName_(c.name, name); })[0];
  if (!me) fail('No one named ' + name + ' is signed up. Tap "I\'m new" to join.');
  if (!me.active) fail(me.name + ' is turned off in the crew list. Ask the shop lead.');
  if (!me.pin || me.pin !== pin) {
    cache.put(key, String(misses + 1), 900);
    fail('That PIN doesn\'t match ' + me.name + '. Forgot it? Ask the shop lead to reset it.');
  }
  cache.remove(key);
  req.name = me.name;   // use the spelling on file
  return me.name;
}

function resetPin_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const me = readCrew_(ss).filter(function (c) { return sameName_(c.name, req.name); })[0];
    if (!me) throw new Error('No one by that name is on the crew list.');
    const pin = newPin_();
    const sh = ss.getSheetByName(TABS.crew.name);
    sh.getRange(me.row, 2).setNumberFormat('@').setValue(pin);
    CacheService.getScriptCache().remove('pinfail:' + me.name.toLowerCase());
    return { ok: true, name: me.name, userPin: pin };
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders_(sh, def) {
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  def.headers.forEach(function (h) {
    if (head.indexOf(h) === -1) {
      const col = head.filter(Boolean).length + 1;
      sh.getRange(1, col).setValue(h).setFontWeight('bold');
      head[col - 1] = h;
    }
  });
}

/* =================== Units (assembly) =================== */

function readUnits_(ss) {
  return readTable_(ss, TABS.units).filter(function (r) { return r['Unit']; }).map(function (r) {
    const stage = String(r['Stage'] || '');
    return {
      row: r._row, area: String(r['Area'] || ''), unit: String(r['Unit']), parts: String(r['Parts'] || ''),
      stage: UNIT_STAGES.indexOf(stage) === -1 ? 'Not started' : stage,
      updated: r['Updated'] || '', by: r['Updated By'] || '', photo: r['Photo'] || '', notes: r['Notes'] || ''
    };
  });
}

/* =================== Claims ("I'm on it") =================== */

function readClaims_(ss) {
  const cutoff = Date.now() - CLAIM_HOURS * 3600000;
  return readTable_(ss, TABS.claims).filter(function (r) {
    return r['Name'] && r['Since'] && new Date(r['Since']).getTime() > cutoff;
  }).map(function (r) {
    return { kind: String(r['Kind'] || 'cut'), area: String(r['Area']), item: String(r['Item']), name: String(r['Name']), since: r['Since'] };
  });
}

function claim_(req) {
  const name = clean_(req.name, 80);
  if (!name) throw new Error('Add your name first.');
  const kind = req.kind === 'unit' ? 'unit' : 'cut';
  const area = clean_(req.area, 100), item = clean_(req.item, 100);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const current = readClaims_(ss).filter(function (c) { return c.kind === kind && c.area === area && c.item === item; })[0];
    if (current && current.name !== name && !req.takeOver) {
      return { ok: false, claimedBy: current.name, since: current.since, error: current.name + ' is already on this.' };
    }
    releaseWhere_(function (c) { return c.kind === kind && c.area === area && c.item === item; });
    ensureTab_(ss, TABS.claims).appendRow([kind, area, item, name, new Date()]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function release_(req) {
  const kind = req.kind === 'unit' ? 'unit' : 'cut';
  const area = clean_(req.area, 100), item = clean_(req.item, 100);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    releaseWhere_(function (c) { return c.kind === kind && c.area === area && c.item === item; });
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// Deletes matching claim rows, plus any expired ones. Call while holding the lock.
function releaseWhere_(match) {
  const sh = ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), TABS.claims);
  if (sh.getLastRow() < 2) return;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const cutoff = Date.now() - CLAIM_HOURS * 3600000;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    const c = { kind: String(v[0]), area: String(v[1]), item: String(v[2]), name: String(v[3]) };
    const expired = !(v[4] instanceof Date) || v[4].getTime() < cutoff;
    if (expired || match(c)) sh.deleteRow(i + 2);
  }
}

/* =================== Settings =================== */

function readSettings_(ss) {
  const map = {};
  readTable_(ss, TABS.settings).forEach(function (r) { if (r['Setting']) map[String(r['Setting'])] = r['Value']; });
  return map;
}

function summaryRecipient_() {
  const set = readSettings_(SpreadsheetApp.getActiveSpreadsheet());
  return String(set['Summary email'] || '').trim() || Session.getEffectiveUser().getEmail();
}

/* =================== Daily summary email =================== */

// Runs from the daily trigger that setup() installs.
function dailySummary() {
  sendSummary_(false);
}

// Run this from the editor to get a summary right now (useful for testing).
function sendSummaryNow() {
  sendSummary_(true);
}

function sendSummary_(force) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const settings = readSettings_(ss);
  const since = props.getProperty('LAST_SUMMARY_AT') ? new Date(props.getProperty('LAST_SUMMARY_AT')) : new Date(Date.now() - 86400000);
  const data = buildView_(true);
  const summary = summaryHtml_(data, since, {
    tz: ss.getSpreadsheetTimeZone(),
    leadUrl: String(settings['Leadership page URL'] || '').trim(),
    sheetUrl: ss.getUrl(),
    title: ss.getName()
  });
  const quiet = !summary.activity;
  const sendAnyway = /^y/i.test(String(settings['Send when nothing changed'] || ''));
  if (!force && quiet && !sendAnyway) return;
  MailApp.sendEmail({ to: summaryRecipient_(), subject: summary.subject, htmlBody: summary.html, body: summary.text });
  if (!force) props.setProperty('LAST_SUMMARY_AT', new Date().toISOString());
}

/*
 * Builds the email from the same data the leadership page uses.
 * Pure function (no Spreadsheet calls) so it's easy to test.
 */
function summaryHtml_(d, since, opt) {
  const esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const effDone = function (st, qty) { return st.status === 'Bundled' ? qty : Math.min(st.done || 0, qty); };
  const left = function (st, qty) { return (st.status === 'Cut' || st.status === 'Bundled') ? 0 : qty - Math.min(st.done || 0, qty); };
  const sinceMs = since.getTime();
  const fmtDate = function (dt) { return Utilities.formatDate(dt, opt.tz || 'America/Chicago', 'EEE, MMM d'); };
  const fmtTime = function (iso) { return Utilities.formatDate(new Date(iso), opt.tz || 'America/Chicago', 'EEE h:mm a'); };

  let done = 0, total = 0;
  const areaRows = d.sheets.map(function (sh) {
    let ad = 0, at = 0, al = 0;
    sh.rows.forEach(function (r) { if (r.type !== 'cut') return; ad += effDone(r, r.qty); at += r.qty; al += left(r, r.qty); });
    done += ad; total += at;
    return { name: sh.name, tape: d.tape[sh.name] || '', done: ad, total: at, left: al, pct: at ? Math.floor(ad / at * 100) : 0 };
  });
  const pct = total ? Math.floor(done / total * 100) : 0;

  const recent = (d.log || []).filter(function (e) { return new Date(e.time).getTime() > sinceMs; });
  let gained = 0;
  const people = {};
  recent.forEach(function (e) {
    const sh = d.sheets.filter(function (s) { return s.name === e.area; })[0];
    const r = sh && sh.rows.filter(function (x) { return x.type === 'cut' && x.label === e.label; })[0];
    const q = r ? r.qty : 1;
    const delta = effDone({ status: e.statusTo, done: e.doneTo }, q) - effDone({ status: e.statusFrom, done: e.doneFrom }, q);
    gained += delta;
    people[e.name] = (people[e.name] || 0) + Math.max(0, delta);
  });
  const batches = {};
  recent.forEach(function (e) { batches[e.batch || e.time] = true; });
  const signoffs = Object.keys(batches).length;

  const flagged = [];
  d.sheets.forEach(function (sh) { sh.rows.forEach(function (r) { if (r.type === 'cut' && r.status === 'Need to Purchase') flagged.push({ area: sh.name, r: r }); }); });
  const open = (d.messages || []).filter(function (m) { return m.status === 'Open'; });
  const newMsgs = (d.messages || []).filter(function (m) { return new Date(m.time).getTime() > sinceMs; });
  const safetyToday = (d.safety || []).filter(function (s) { return new Date(s.time).getTime() > sinceMs; });

  const lumber = CutPlanner.report(d.sheets, d.lumber || [], d.stock || [], KERF);
  const activity = recent.length > 0 || newMsgs.length > 0;

  const th = 'style="text-align:left;padding:6px 10px;border-bottom:1px solid #D6DADF;font-size:13px;color:#5B6570"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #D6DADF"';
  const tdr = 'style="padding:6px 10px;border-bottom:1px solid #D6DADF;text-align:right"';
  const thr = 'style="text-align:right;padding:6px 10px;border-bottom:1px solid #D6DADF;font-size:13px;color:#5B6570"';
  const h2 = 'style="font-size:18px;margin:24px 0 8px"';
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1C232B;font-size:15px;line-height:1.45;max-width:640px">';
  html += '<p style="margin:0 0 4px;color:#5B6570">' + esc(opt.title || 'Build') + ' update, ' + esc(fmtDate(new Date())) + '</p>';
  html += '<h1 style="font-size:24px;margin:0 0 12px">' + pct + '% of pieces bundled (' + done + ' of ' + total + ')</h1>';
  html += '<p style="margin:0 0 12px">' + (recent.length
    ? 'Since the last update: <b>' + (gained >= 0 ? '+' : '') + gained + ' pieces</b> bundled across ' + signoffs + ' sign-off' + (signoffs === 1 ? '' : 's') + '.'
    : 'No sign-offs since the last update.') + '</p>';
  const names = Object.keys(people);
  if (names.length) {
    html += '<p style="margin:0 0 12px">Thanks to ' + esc(names.sort(function (a, b) { return people[b] - people[a]; })
      .map(function (n) { return n + (people[n] ? ' (' + people[n] + ')' : ''); }).join(', ')) + '.</p>';
  }

  html += '<h2 ' + h2 + '>Areas</h2><table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Area</th><th ' + th + '>Tape</th><th ' + thr + '>Bundled</th><th ' + thr + '>Left to cut</th></tr>';
  areaRows.forEach(function (a) {
    html += '<tr><td ' + td + '><b>' + esc(a.name) + '</b></td><td ' + td + '>' + esc(a.tape) + '</td><td ' + tdr + '>' + a.pct + '% (' + a.done + ' of ' + a.total + ')</td><td ' + tdr + '>' + a.left + '</td></tr>';
  });
  html += '</table>';

  html += '<h2 ' + h2 + '>Needs attention</h2>';
  if (!flagged.length && !open.length) html += '<p style="margin:0">Nothing flagged and no open questions.</p>';
  if (flagged.length) {
    html += '<p style="margin:0 0 6px"><b>Flagged Need to Purchase:</b></p><ul style="margin:0 0 10px;padding-left:20px">';
    flagged.forEach(function (f) { html += '<li>' + esc(f.area) + ' ' + esc(f.r.label) + ', ' + esc(f.r.use) + ' (' + esc(f.r.dim) + (f.r.length ? ' at ' + esc(f.r.length) : '') + '): ' + left(f.r, f.r.qty) + ' of ' + f.r.qty + ' still to cut' + (f.r.by ? ', flagged by ' + esc(f.r.by) : '') + '</li>'; });
    html += '</ul>';
  }
  if (open.length) {
    html += '<p style="margin:0 0 6px"><b>Open questions and notes (' + open.length + '):</b></p><ul style="margin:0 0 10px;padding-left:20px">';
    open.slice(0, 15).forEach(function (m) { html += '<li><b>' + esc(m.name) + '</b>' + (m.label || m.area ? ' about ' + esc([m.area, m.label].filter(Boolean).join(' ')) : '') + ': ' + esc(m.message) + '</li>'; });
    html += '</ul>';
  }

  html += '<h2 ' + h2 + '>Lumber</h2><table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Size</th><th ' + thr + '>Left to cut</th><th ' + thr + '>From spare</th><th ' + thr + '>New needed</th><th ' + thr + '>To buy</th><th ' + thr + '>Est. cost</th></tr>';
  let cost = 0;
  const staleSizes = [];
  lumber.forEach(function (l) {
    if (l.cost) cost += l.cost;
    if (l.countedAt && (d.log || []).some(function (e) { return e.time > l.countedAt; })) staleSizes.push(l.size);
    html += '<tr><td ' + td + '><b>' + esc(l.size) + '</b></td><td ' + tdr + '>' + l.left + '</td><td ' + tdr + '>' + (l.onHand ? l.fromStock + ' of ' + l.onHand : 'not counted') + '</td><td ' + tdr + '>' + l.newBoards + '</td><td ' + tdr + '><b>' + l.toBuy + '</b></td><td ' + tdr + '>' + (l.toBuy ? (l.cost != null ? '$' + l.cost.toFixed(2) : 'no price') : '') + '</td></tr>';
  });
  html += '</table>' + (cost ? '<p style="margin:6px 0 0">Estimated total still to buy: <b>$' + cost.toFixed(2) + '</b></p>' : '') +
    '<p style="margin:6px 0 0;color:#5B6570;font-size:13px">"To buy" includes the extra % from the Lumber tab.' +
    (staleSizes.length ? ' Spare wood for ' + esc(staleSizes.join(', ')) + ' was counted before some of the latest cuts; recount before buying.' : '') + '</p>';

  const units = d.units || [];
  if (units.length) {
    const st = CutPlanner.unitStatus(d.sheets, units);
    const pick = function (ph) { return units.filter(function (u, i) { return st[i].phase === ph; }).map(function (u) { return u.unit; }); };
    const built = units.filter(function (u) { return ['Built', 'Finished', 'Loaded in'].indexOf(u.stage) !== -1; }).length;
    html += '<h2 ' + h2 + '>Assembly</h2><p style="margin:0 0 6px">' + built + ' of ' + units.length + ' units built.</p><ul style="margin:0;padding-left:20px">';
    [['Ready to build', pick('Ready')], ['Being built', pick('Building')], ['Waiting on parts', pick('Waiting')]].forEach(function (g) {
      if (g[1].length) html += '<li><b>' + g[0] + ':</b> ' + esc(g[1].join(', ')) + '</li>';
    });
    html += '</ul>';
  }

  html += '<h2 ' + h2 + '>Safety check-ins</h2><p style="margin:0">' + (safetyToday.length
    ? safetyToday.length + ' since the last update: ' + esc(safetyToday.map(function (s) { return s.name; }).filter(function (n, i, a) { return a.indexOf(n) === i; }).join(', ')) + '.'
    : 'None since the last update.') + '</p>';

  if (recent.length) {
    html += '<h2 ' + h2 + '>Sign-offs</h2><ul style="margin:0;padding-left:20px">';
    const seen = {};
    recent.forEach(function (e) {
      const k = e.batch || e.time;
      if (seen[k]) return;
      seen[k] = true;
      const lines = recent.filter(function (x) { return (x.batch || x.time) === k; });
      html += '<li>' + esc(fmtTime(e.time)) + ', <b>' + esc(e.name) + '</b>: ' + esc(lines.map(function (x) { return x.area + ' ' + x.label + ' ' + x.statusTo; }).join('; ')) +
        (e.photo ? ' (<a href="' + esc(e.photo) + '">photo</a>)' : '') + (e.note ? '<br><i>' + esc(e.note) + '</i>' : '') + '</li>';
    });
    html += '</ul>';
  }

  html += '<p style="margin:24px 0 0;color:#5B6570;font-size:13px">' +
    (opt.leadUrl ? '<a href="' + esc(opt.leadUrl) + '">Open the leadership page</a> for photos and details. ' : '') +
    '<a href="' + esc(opt.sheetUrl) + '">Open the Google Sheet</a>.</p></div>';

  const text = pct + '% of pieces bundled (' + done + ' of ' + total + '). ' +
    (recent.length ? gained + ' pieces bundled since the last update. ' : 'No sign-offs since the last update. ') +
    flagged.length + ' lines flagged Need to Purchase. ' + open.length + ' open questions or notes.';
  return { subject: (opt.title || 'Build') + ' update: ' + pct + '% bundled, ' + fmtDate(new Date()), html: html, text: text, activity: activity };
}

/* =================== One-time setup =================== */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const areas = [];
  const sizes = {};

  ss.getSheets().forEach(function (sh) {
    if (HELPER_TAB_NAMES.indexOf(sh.getName()) !== -1) return;
    let loc = locate_(sh);
    if (!loc) return;
    loc = ensureColumns_(sh, loc);
    areas.push(sh.getName());

    const statusCol = loc.cols['status'] + 1;
    const doneCol = loc.cols['done'] + 1;
    const firstRow = loc.headerRow + 2;
    const numRows = Math.max(sh.getMaxRows() - firstRow + 1, 1);

    sh.getRange(firstRow, statusCol, numRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
    sh.getRange(firstRow, doneCol, numRows, 1).setNumberFormat('0');
    sh.getRange(firstRow, loc.cols['updated'] + 1, numRows, 1).setNumberFormat('m/d h:mm am/pm');

    for (let r = loc.headerRow + 1; r < loc.values.length; r++) {
      const label = cell_(loc, r, 'label/id');
      if (!label) continue;
      const dim = cell_(loc, r, 'dimension');
      if (dim) sizes[dim] = true;
      const cur = cell_(loc, r, 'status');
      if (!cur) sh.getRange(r + 1, statusCol, 1, 2).setValues([['Not Started', 0]]);
      else if (LEGACY_STATUS[cur]) sh.getRange(r + 1, statusCol).setValue(LEGACY_STATUS[cur]);
    }

    const statusRange = sh.getRange(firstRow, statusCol, numRows, 1);
    const kept = sh.getConditionalFormatRules().filter(function (rule) {
      return !rule.getRanges().some(function (rg) { return rg.getColumn() === statusCol; });
    });
    STATUSES.forEach(function (s) {
      kept.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s)
        .setBackground(STATUS_COLORS[s]).setRanges([statusRange]).build());
    });
    sh.setConditionalFormatRules(kept);
  });

  // Helper tabs
  Object.keys(TABS).forEach(function (k) { ensureTab_(ss, TABS[k]); });

  const tapeSheet = ss.getSheetByName(TABS.tape.name);
  const tapeHave = readTape_(ss);
  const tapeNew = areas.filter(function (a) { return tapeHave[a] === undefined; })
    .map(function (a, i) { return [a, DEFAULT_TAPE[(Object.keys(tapeHave).length + i) % DEFAULT_TAPE.length]]; });
  if (tapeNew.length) tapeSheet.getRange(tapeSheet.getLastRow() + 1, 1, tapeNew.length, 2).setValues(tapeNew);

  const lumberSheet = ss.getSheetByName(TABS.lumber.name);
  const lumberHave = {};
  readLumber_(ss).forEach(function (l) { lumberHave[l.size] = true; });
  const lumberNew = Object.keys(sizes).filter(function (s) { return !lumberHave[s]; })
    .map(function (s) { const sheet = s.indexOf("'") !== -1; return [s, sheet ? '' : 96, '', sheet ? 0 : 10]; });
  if (lumberNew.length) lumberSheet.getRange(lumberSheet.getLastRow() + 1, 1, lumberNew.length, 4).setValues(lumberNew);

  const crewSheet = ss.getSheetByName(TABS.crew.name);
  ensureHeaders_(crewSheet, TABS.crew);
  crewSheet.getRange(2, 2, Math.max(crewSheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  crewSheet.getRange(2, 4, Math.max(crewSheet.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  readCrew_(ss).forEach(function (c) {
    if (!c.pin) crewSheet.getRange(c.row, 2).setValue(newPin_());
    if (!crewSheet.getRange(c.row, 4).getValue()) crewSheet.getRange(c.row, 4).setValue('Yes');
    if (!crewSheet.getRange(c.row, 3).getValue()) crewSheet.getRange(c.row, 3).setValue(new Date());
  });

  const unitSheet = ss.getSheetByName(TABS.units.name);
  if (unitSheet.getLastRow() < 2) {
    const rows = DEFAULT_UNITS.map(function (u) { return [u[0], u[1], u[2], 'Not started', '', '', '', '']; });
    unitSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  unitSheet.getRange(2, 4, Math.max(unitSheet.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(UNIT_STAGES, true).build());

  const msgSheet = ss.getSheetByName(TABS.messages.name);
  msgSheet.getRange(2, 9, Math.max(msgSheet.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Open', 'Answered', 'Closed'], true).build());

  const settingsSheet = ss.getSheetByName(TABS.settings.name);
  const haveSettings = readSettings_(ss);
  const newSettings = SETTINGS_DEFAULTS.filter(function (row) { return haveSettings[row[0]] === undefined; })
    .map(function (row) { return row[0] === 'Summary email' ? [row[0], Session.getEffectiveUser().getEmail(), row[2]] : row; });
  if (newSettings.length) settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, newSettings.length, 3).setValues(newSettings);

  // Daily summary trigger (replaces any earlier one so the hour stays current).
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySummary') ScriptApp.deleteTrigger(t);
  });
  const hour = Math.min(23, Math.max(0, parseInt(readSettings_(ss)['Summary hour'], 10) || 20));
  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(hour).create();

  photoFolder_();

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LEAD_PIN')) {
    props.setProperty('LEAD_PIN', String(Math.floor(100000 + Math.random() * 900000)));
  }
  console.log('Setup complete. Leadership PIN: ' + props.getProperty('LEAD_PIN') +
    '  (change it in Project Settings > Script properties > LEAD_PIN)');
}

/* =================== Helpers =================== */

function legacy_(s) {
  s = String(s || '').trim();
  return LEGACY_STATUS[s] || s;
}
function normStatus_(s) {
  s = String(s || '').trim();
  if (LEGACY_STATUS[s]) return LEGACY_STATUS[s];
  return STATUSES.indexOf(s) === -1 ? 'Not Started' : s;
}
function pickSpare_(r, size) {
  const v = r['Spare %'] !== undefined && r['Spare %'] !== '' ? r['Spare %'] : r['Waste %'];
  if (v === undefined || v === '' || v === null) return size.indexOf("'") !== -1 ? 0 : 10;
  return num_(v) || 0;
}
function cleanLength_(s) { return s.replace(/["'\s]/g, '') === '' ? '' : s; }
function clamp_(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function num_(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function clean_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max); }
function msg_(err) { return String(err && err.message ? err.message : err); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }
function json_(obj) { return text_(JSON.stringify(obj)); }

/* =================== PLANNER (copy of assets/planner.js) =================== */
/*
 * Cut planner. Plain JavaScript with no browser or Google dependencies, so the exact same
 * code runs on the pages (assets/planner.js) and in Apps Script (copied into Code.gs).
 * If you change this file, paste it over the PLANNER section at the bottom of Code.gs too.
 *
 * The problem: pieces still to cut, wood already on hand (spare boards of any length),
 * and new boards of a fixed length. Every cut costs one blade kerf. Fit as many pieces as
 * possible into wood on hand, and report how many new boards the rest needs.
 */
var CutPlanner = (function () {
  var EPS = 1e-9;

  // "75 1/2\"", "96\"", "8'", "8' 6\"", "16.5" -> inches
  function parseInches(s) {
    if (s === null || s === undefined || s === '') return NaN;
    if (typeof s === 'number') return s;
    var str = String(s).replace(/[”″]/g, '"').replace(/[’′]/g, "'").trim();
    var total = 0, found = false;
    var ft = str.match(/(\d+(?:\.\d+)?)\s*'/);
    if (ft) { total += parseFloat(ft[1]) * 12; str = str.slice(ft.index + ft[0].length); found = true; }
    var m = str.match(/^\s*-?\s*(\d+(?:\.\d+)?)?(?:[\s-]+)?(?:(\d+)\/(\d+))?/);
    if (m && m[1]) { total += parseFloat(m[1]); found = true; }
    if (m && m[2] && m[3]) { total += parseFloat(m[2]) / parseFloat(m[3]); found = true; }
    return found ? total : NaN;
  }

  // Inches as a tape-measure reading, to the nearest 1/16".
  function fmtIn(x) {
    if (x === null || x === undefined || isNaN(x)) return '';
    var whole = Math.floor(x + EPS), n = Math.round((x - whole) * 16);
    if (n === 16) { whole++; n = 0; }
    if (!n) return whole + '"';
    var d = 16;
    while (n % 2 === 0) { n /= 2; d /= 2; }
    return (whole ? whole + ' ' : '') + n + '/' + d + '"';
  }

  function isSheetGood(size) { return /'/.test(size) || /\d+\s*x\s*\d+\s*ft/i.test(size); }
  function effDone(st, qty) { return st.status === 'Bundled' ? qty : Math.min(st.done || 0, qty); }
  function leftToCut(st, qty) { return (st.status === 'Cut' || st.status === 'Bundled') ? 0 : qty - Math.min(st.done || 0, qty); }

  // Martello-Toth L2 lower bound for identical boards: no plan can use fewer.
  function lowerBound(lengths, stock, kerf) {
    var cap = stock + kerf;
    var w = lengths.map(function (L) { return L + kerf; });
    if (!w.length) return 0;
    var best = Math.ceil(w.reduce(function (a, b) { return a + b; }, 0) / cap - EPS);
    var ks = w.filter(function (x) { return x <= cap / 2; }).concat([0]);
    ks.forEach(function (k) {
      var j1 = 0, j2 = [], s3 = 0;
      w.forEach(function (x) { if (x > cap - k) j1++; else if (x > cap / 2) j2.push(x); else if (x >= k) s3 += x; });
      var free = j2.length * cap - j2.reduce(function (a, b) { return a + b; }, 0);
      best = Math.max(best, j1 + j2.length + Math.max(0, Math.ceil((s3 - free) / cap - EPS)));
    });
    return best;
  }

  function byLenDesc(a, b) { return b.len - a.len || String(a.label).localeCompare(String(b.label), undefined, { numeric: true }); }
  function newBin(len, kind, kerf) { return { len: len, kind: kind, rem: len + kerf, pieces: [] }; }
  function put(bin, p, kerf) { bin.rem -= p.len + kerf; bin.pieces.push(p); }
  function fits(bin, p, kerf) { return bin.rem >= p.len + kerf - EPS; }

  // Strategy 1: longest piece first, best fit among boards already started,
  // otherwise the shortest spare board that fits, otherwise a new board.
  function bestFit(pieces, stock, newLen, kerf) {
    var open = [], unused = stock.slice().sort(function (a, b) { return a - b; });
    open.over = [];
    pieces.slice().sort(byLenDesc).forEach(function (p) {
      var best = null;
      open.forEach(function (b) { if (fits(b, p, kerf) && (!best || b.rem < best.rem)) best = b; });
      if (!best) {
        var i = -1;
        for (var j = 0; j < unused.length; j++) if (unused[j] + kerf >= p.len + kerf - EPS) { i = j; break; }
        if (i !== -1) { best = newBin(unused[i], 'stock', kerf); unused.splice(i, 1); }
        else if (p.len <= newLen + EPS) best = newBin(newLen, 'new', kerf);
        else { open.over.push(p); return; }
        open.push(best);
      }
      put(best, p, kerf);
    });
    return open;
  }

  // Fill one board as full as possible from the remaining pieces (bounded search).
  function fillBoard(len, pool, kerf) {
    var cap = len + kerf, types = [], map = {};
    pool.forEach(function (p, idx) {
      var k = p.len;
      if (!map[k]) { map[k] = { len: p.len, idx: [] }; types.push(map[k]); }
      map[k].idx.push(idx);
    });
    types.sort(function (a, b) { return b.len - a.len; });
    var best = { used: 0, take: [] }, nodes = 0, take = [];
    (function dfs(t, rem, used) {
      if (++nodes > 4000) return;
      if (used > best.used) best = { used: used, take: take.slice() };
      if (rem < EPS) return;
      for (var i = t; i < types.length; i++) {
        var w = types[i].len + kerf;
        var maxN = Math.min(types[i].idx.length, Math.floor((rem + EPS) / w));
        for (var n = maxN; n >= 1; n--) {
          take.push([i, n]);
          dfs(i + 1, rem - n * w, used + n * types[i].len);
          take.pop();
          if (nodes > 4000) return;
        }
      }
    })(0, cap, 0);
    var chosen = [];
    best.take.forEach(function (tn) { chosen = chosen.concat(types[tn[0]].idx.slice(0, tn[1])); });
    return chosen;
  }

  // Strategy 2: fill spare boards (longest first) as full as possible, then new boards.
  function stockFirst(pieces, stock, newLen, kerf) {
    var pool = pieces.slice().sort(byLenDesc), bins = [];
    stock.slice().sort(function (a, b) { return b - a; }).forEach(function (len) {
      if (!pool.length) return;
      var chosen = fillBoard(len, pool, kerf);
      if (!chosen.length) return;
      var bin = newBin(len, 'stock', kerf);
      chosen.sort(function (a, b) { return b - a; }).forEach(function (i) { put(bin, pool[i], kerf); pool.splice(i, 1); });
      bin.pieces.sort(byLenDesc);
      bins.push(bin);
    });
    var rest = bestFit(pool, [], newLen, kerf);
    var all = bins.concat(rest);
    all.over = rest.over;
    return all;
  }

  // Strategy 3: plan everything on new boards, then move whole board patterns onto
  // spare boards that can hold them (each move saves one new board).
  function swapIn(pieces, stock, newLen, kerf) {
    var bins = bestFit(pieces, [], newLen, kerf);
    var over = bins.over;
    var unused = stock.slice().sort(function (a, b) { return a - b; });
    bins.map(function (b) { return b; })
      .sort(function (a, b) { return (b.len + kerf - b.rem) - (a.len + kerf - a.rem); })
      .forEach(function (b) {
        var need = b.len + kerf - b.rem;
        for (var j = 0; j < unused.length; j++) {
          if (unused[j] + kerf >= need - EPS) {
            b.kind = 'stock'; b.rem = unused[j] + kerf - need; b.len = unused[j];
            unused.splice(j, 1);
            break;
          }
        }
      });
    bins.over = over;
    return bins;
  }

  function score(bins) {
    var n = 0, s = 0, off = 0;
    bins.forEach(function (b) { if (b.kind === 'new') n++; else s++; off += b.rem; });
    return [(bins.over || []).length, n, s, off];
  }
  function better(a, b) {
    var x = score(a), y = score(b);
    for (var i = 0; i < 4; i++) { if (x[i] < y[i] - EPS) return true; if (x[i] > y[i] + EPS) return false; }
    return false;
  }

  /*
   * pieces: [{ label, area, len, text }]    stock: [lengths in inches]
   * Returns { newBoards, stockUsed, stockLeft, patterns, tooLong, unknown, bound }
   */
  function plan(pieces, stock, newLen, kerf) {
    stock = (stock || []).filter(function (L) { return L > 0; });
    var tooLong = [], unknown = [], ok = [];
    var longest = Math.max.apply(null, [newLen || 0].concat(stock));
    pieces.forEach(function (p) {
      if (isNaN(p.len)) unknown.push(p);
      else if (p.len > longest + EPS) tooLong.push(p);
      else ok.push(p);
    });
    var cands = [bestFit(ok, stock, newLen, kerf)];
    if (stock.length) cands.push(stockFirst(ok, stock, newLen, kerf), swapIn(ok, stock, newLen, kerf));
    var bins = cands[0];
    cands.forEach(function (c) { if (better(c, bins)) bins = c; });
    tooLong = tooLong.concat(bins.over || []);

    // Anything too long for a new board but placed on a longer spare board is fine;
    // pieces longer than a new board that couldn't go on spare wood are reported.
    var groups = {}, patterns = [];
    bins.forEach(function (b) {
      b.pieces.sort(byLenDesc);
      var used = b.pieces.reduce(function (a, p) { return a + p.len; }, 0);
      var offcut = Math.max(0, b.len - used - kerf * b.pieces.length);
      var key = b.kind + '|' + b.len + '|' + b.pieces.map(function (p) { return p.area + ':' + p.label + '@' + p.len; }).join(',');
      if (!groups[key]) { groups[key] = { kind: b.kind, len: b.len, pieces: b.pieces, offcut: offcut, count: 0 }; patterns.push(groups[key]); }
      groups[key].count++;
    });
    patterns.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'stock' ? -1 : 1;
      return b.count - a.count || b.len - a.len || String(a.pieces[0].label).localeCompare(String(b.pieces[0].label), undefined, { numeric: true });
    });
    var newBoards = 0, stockUsed = 0, usedLens = [];
    bins.forEach(function (b) { if (b.kind === 'new') newBoards++; else { stockUsed++; usedLens.push(b.len); } });
    var stockLeft = stock.slice();
    usedLens.forEach(function (L) { var i = stockLeft.indexOf(L); if (i !== -1) stockLeft.splice(i, 1); });
    return {
      newBoards: newBoards, stockUsed: stockUsed, stockLeft: stockLeft, patterns: patterns,
      tooLong: tooLong, unknown: unknown,
      bound: stock.length ? null : lowerBound(ok.map(function (p) { return p.len; }), newLen, kerf)
    };
  }

  // Pieces still to cut, grouped by size, across the given sheets.
  function piecesLeft(sheets, stateOf) {
    var out = {};
    sheets.forEach(function (sh) {
      sh.rows.forEach(function (r) {
        if (r.type !== 'cut' || !r.dim) return;
        var st = stateOf ? stateOf(sh.name, r) : r;
        var n = leftToCut(st, r.qty);
        if (!out[r.dim]) out[r.dim] = [];
        var len = parseInches(r.length);
        for (var i = 0; i < n; i++) out[r.dim].push({ label: r.label, area: sh.name, len: len, text: r.length });
      });
    });
    return out;
  }

  function lumberFor(lumber, size) {
    var l = null;
    (lumber || []).forEach(function (x) { if (x.size === size) l = x; });
    var sheet = isSheetGood(size);
    var d = { size: size, boardLength: sheet ? null : 96, price: null, spare: sheet ? 0 : 10 };
    if (l) {
      if (l.boardLength !== undefined) d.boardLength = l.boardLength;
      if (l.price !== undefined) d.price = l.price;
      if (l.spare !== undefined && l.spare !== null) d.spare = l.spare;
    }
    return d;
  }

  /*
   * The lumber report used by the leadership page, the crew cut plan, and the daily email.
   * sheets: cut tabs; lumber: Lumber tab; stock: [{ size, length, count, by, at }]
   */
  function report(sheets, lumber, stock, kerf, stateOf) {
    var left = piecesLeft(sheets, stateOf);
    var sizes = Object.keys(left);
    (stock || []).forEach(function (s) { if (sizes.indexOf(s.size) === -1 && s.count > 0) sizes.push(s.size); });
    return sizes.map(function (size) {
      var cfg = lumberFor(lumber, size);
      var pieces = left[size] || [];
      var rows = (stock || []).filter(function (s) { return s.size === size && s.count > 0; });
      var onHand = rows.reduce(function (a, s) { return a + s.count; }, 0);
      var counted = rows.reduce(function (a, s) { return !a || (s.at && s.at > a.at) ? s : a; }, null);
      var flagged = 0;
      sheets.forEach(function (sh) { sh.rows.forEach(function (r) { if (r.type === 'cut' && r.dim === size && (stateOf ? stateOf(sh.name, r) : r).status === 'Need to Purchase') flagged++; }); });
      var out = { size: size, sheet: !cfg.boardLength, boardLength: cfg.boardLength, price: cfg.price, spare: cfg.spare || 0,
                  left: pieces.length, onHand: onHand, stockRows: rows, countedAt: counted ? counted.at : '', countedBy: counted ? counted.by : '', flagged: flagged };
      if (!cfg.boardLength) {
        out.fromStock = Math.min(onHand, pieces.length);
        out.newBoards = Math.max(0, pieces.length - onHand);
        out.plan = null;
      } else {
        var lens = [];
        rows.forEach(function (s) { for (var i = 0; i < s.count; i++) lens.push(s.length); });
        var p = plan(pieces, lens, cfg.boardLength, kerf);
        out.plan = p;
        out.fromStock = p.stockUsed;
        out.newBoards = p.newBoards + p.unknown.length;
      }
      out.spareBoards = out.newBoards ? Math.ceil(out.newBoards * out.spare / 100) : 0;
      out.toBuy = out.newBoards + out.spareBoards;
      out.cost = cfg.price ? out.toBuy * cfg.price : null;
      return out;
    });
  }

  // "F×2, G×2, H×2" or "A x20, B*8" -> [{ label, n }]
  function parseParts(str) {
    var out = [];
    String(str || '').split(/[,;]+/).forEach(function (bit) {
      var m = bit.trim().match(/^([A-Za-z]+)\s*(?:[×x*]\s*(\d+))?$/);
      if (m) out.push({ label: m[1].toUpperCase(), n: m[2] ? parseInt(m[2], 10) : 1 });
    });
    return out;
  }

  var UNIT_STAGES = ['Not started', 'Building', 'Built', 'Finished', 'Loaded in'];

  /*
   * Which units can be built right now. Bundled pieces are handed out in order:
   * units already under way first (they physically have their pieces), then the rest
   * in sheet order. A unit is ready when every part it needs is covered.
   * Labels resolve inside the unit's own area tab.
   */
  function unitStatus(sheets, units, stateOf) {
    var pool = {}, qty = {};
    sheets.forEach(function (sh) {
      sh.rows.forEach(function (r) {
        if (r.type !== 'cut') return;
        var st = stateOf ? stateOf(sh.name, r) : r;
        pool[sh.name + '|' + r.label] = effDone(st, r.qty);
        qty[sh.name + '|' + r.label] = r.qty;
      });
    });
    var order = units.map(function (u, i) { return i; }).sort(function (a, b) {
      var sa = units[a].stage !== 'Not started' ? 0 : 1, sb = units[b].stage !== 'Not started' ? 0 : 1;
      return sa - sb || a - b;
    });
    var result = units.map(function () { return null; });
    order.forEach(function (i) {
      var u = units[i];
      var parts = parseParts(u.parts).map(function (p) {
        var key = u.area + '|' + p.label;
        var known = key in pool;
        var have = known ? Math.min(pool[key], p.n) : 0;
        if (known) pool[key] -= have;
        return { label: p.label, need: p.n, have: have, known: known };
      });
      var ready = parts.length > 0 && parts.every(function (p) { return p.known && p.have >= p.need; });
      var phase = u.stage === 'Not started' ? (ready ? 'Ready' : 'Waiting') : u.stage;
      result[i] = { parts: parts, ready: ready, phase: phase,
                    missing: parts.filter(function (p) { return p.have < p.need; }),
                    unknown: parts.filter(function (p) { return !p.known; }) };
    });
    return result;
  }

  return {
    parseParts: parseParts, unitStatus: unitStatus, UNIT_STAGES: UNIT_STAGES,
    parseInches: parseInches, fmtIn: fmtIn, isSheetGood: isSheetGood, effDone: effDone, leftToCut: leftToCut,
    lowerBound: lowerBound, plan: plan, piecesLeft: piecesLeft, lumberFor: lumberFor, report: report
  };
})();
