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
