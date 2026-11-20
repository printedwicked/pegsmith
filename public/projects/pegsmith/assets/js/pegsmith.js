/* =========================================================================
   Pegsmith — peg-light art designer
   -------------------------------------------------------------------------
   Draw on a peg grid, or drop an image and let it quantise to peg colours,
   then print a template at true physical scale so the holes line up with a
   real board.

   No framework, no build step. One file, one IIFE, four parts:

     1. MODEL      grid, palette, undo, persistence
     2. BOARD      canvas renderer and pointer tools
     3. IMAGE      downsample + quantise to the peg palette
     4. SHEET      the printable SVG, sized in millimetres

   THE ONE IDEA WORTH KNOWING
   The printed template is only useful if a hole on paper sits exactly over
   a hole on the board. Browsers disagree about CSS pixels but agree about
   physical units in SVG, so the sheet is an <svg width="203.2mm"> with a
   viewBox in millimetres and @page margin: 0. Everything else here is in
   service of that: the pitch input, the calibration bar, the tiling.
   ========================================================================= */

(function () {
  'use strict';

  /* =======================================================================
     1. MODEL
     ===================================================================== */

  /* The eight colours a classic peg set ships in. `hex` is the lit colour
     used on screen; `ink` is what goes on paper, darkened where the lit
     colour would be invisible on white (white and yellow especially).
     `key` is the letter printed inside a peg when codes are switched on,
     so a greyscale print is still followable. */
  var PALETTE = [
    { v: 1, name: 'White',  key: 'W', hex: '#ffffff', ink: '#9aa0a6' },
    { v: 2, name: 'Red',    key: 'R', hex: '#ff3535', ink: '#e01b1b' },
    { v: 3, name: 'Orange', key: 'O', hex: '#ff8a1f', ink: '#e8710a' },
    { v: 4, name: 'Yellow', key: 'Y', hex: '#ffd82b', ink: '#d8ad00' },
    { v: 5, name: 'Green',  key: 'G', hex: '#2fdc57', ink: '#17a83c' },
    { v: 6, name: 'Blue',   key: 'B', hex: '#3d86ff', ink: '#1f5fd6' },
    { v: 7, name: 'Pink',   key: 'P', hex: '#ff62c0', ink: '#e0399e' },
    { v: 8, name: 'Purple', key: 'U', hex: '#a45cff', ink: '#7d33e0' }
  ];
  var BY_V = {};
  PALETTE.forEach(function (p) { BY_V[p.v] = p; });

  var MM_PER_IN = 25.4;

  /* Board presets. The artwork sizes are the manufacturers' stated template
     dimensions; the pitch is NOT published anywhere reliable, so 6.35 mm
     (1/4") is a starting point and the Calibrate control below is how you
     replace it with your board's real one. Get that number right once and
     every sheet after it is right. */
  var PRESETS = {
    'ultimate': { label: 'Ultimate Classic', w: 8 * MM_PER_IN, h: 6.5 * MM_PER_IN, pitch: 6.35 },
    'cube':     { label: 'Cube',             w: 6.75 * MM_PER_IN, h: 6.75 * MM_PER_IN, pitch: 6.35 },
    'mini':     { label: 'Mini',             w: 3.625 * MM_PER_IN, h: 3.5 * MM_PER_IN, pitch: 6.35 },
    'custom':   { label: 'Custom' }
  };

  var PAPERS = {
    letter: { label: 'Letter', w: 215.9, h: 279.4 },
    legal:  { label: 'Legal',  w: 215.9, h: 355.6 },
    a4:     { label: 'A4',     w: 210,   h: 297 },
    a3:     { label: 'A3',     w: 297,   h: 420 }
  };

  var STORE_KEY = 'pegsmith.v1';

  var state = {
    cols: 32,
    rows: 26,
    pitch: 6.35,          // mm between hole centres
    preset: 'ultimate',
    cells: null,          // Uint8Array(cols*rows), 0 = no peg
    name: 'untitled'
  };

  var view = { cell: 18, ox: 0, oy: 0 };     // cell size in screen px, pan
  var ui = {
    tool: 'pen',
    color: 1,
    mirrorX: false,
    mirrorY: false,
    lit: true,
    showHoles: true
  };

  var undoStack = [];
  var redoStack = [];
  var UNDO_MAX = 80;

  function idx(x, y) { return y * state.cols + x; }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }

  function allocGrid(cols, rows, old, oldCols, oldRows) {
    var next = new Uint8Array(cols * rows);
    if (old) {
      /* Resizing keeps what still fits rather than clearing. Anchored at the
         top-left because that is the corner every other measurement in this
         app is anchored to. */
      var cx = Math.min(cols, oldCols), cy = Math.min(rows, oldRows);
      for (var y = 0; y < cy; y++) {
        for (var x = 0; x < cx; x++) next[y * cols + x] = old[y * oldCols + x];
      }
    }
    return next;
  }

  function snapshot() {
    undoStack.push(state.cells.slice());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    refreshHistoryButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(state.cells.slice());
    state.cells = undoStack.pop();
    afterEdit();
    refreshHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(state.cells.slice());
    state.cells = redoStack.pop();
    afterEdit();
    refreshHistoryButtons();
  }

  /* ---- persistence ---------------------------------------------------- */

  /* Cells are run-length encoded before they go anywhere. A peg design is
     mostly empty, so a 60x48 grid that would be 2880 comma-separated numbers
     is a few dozen pairs — small enough for localStorage to hold happily and
     for a saved file to stay readable. */
  function encodeCells(a) {
    var out = [], run = 1, i;
    for (i = 1; i <= a.length; i++) {
      if (i < a.length && a[i] === a[i - 1]) { run++; continue; }
      out.push(run > 1 ? run + 'x' + a[i - 1] : String(a[i - 1]));
      run = 1;
    }
    return out.join('.');
  }

  function decodeCells(s, len) {
    var a = new Uint8Array(len), at = 0;
    if (!s) return a;
    s.split('.').forEach(function (tok) {
      var n = 1, v;
      var cut = tok.indexOf('x');
      if (cut > -1) { n = parseInt(tok.slice(0, cut), 10); v = parseInt(tok.slice(cut + 1), 10); }
      else v = parseInt(tok, 10);
      if (!isFinite(v)) v = 0;
      for (var k = 0; k < n && at < len; k++) a[at++] = v;
    });
    return a;
  }

  function serialise() {
    return {
      format: 'pegsmith', version: 1,
      name: state.name,
      cols: state.cols, rows: state.rows, pitchMM: state.pitch,
      preset: state.preset,
      cells: encodeCells(state.cells)
    };
  }

  function load(doc) {
    if (!doc || doc.format !== 'pegsmith') throw new Error('Not a Pegsmith file.');
    state.cols = Math.max(2, Math.min(400, doc.cols | 0));
    state.rows = Math.max(2, Math.min(400, doc.rows | 0));
    state.pitch = +doc.pitchMM || 6.35;
    state.preset = doc.preset || 'custom';
    state.name = doc.name || 'untitled';
    state.cells = decodeCells(doc.cells, state.cols * state.rows);
    undoStack.length = redoStack.length = 0;
  }

  var saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(serialise())); }
      catch (e) { /* private window, quota, blocked storage — not fatal */ }
    }, 600);
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      load(JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }

  /* =======================================================================
     2. BOARD — canvas renderer
     ===================================================================== */

  var cv, ctx, boardEl, dpr = 1;
  var sprites = null, spriteCell = 0;   // cached glow sprites, one per colour

  function sizeCanvas() {
    var r = boardEl.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    draw();
  }

  /* A lit peg is a small disc inside a wide soft halo. Drawing that with a
     radial gradient per peg per frame is thousands of gradient objects a
     second; drawing it once per colour into an offscreen canvas and blitting
     the result is one image draw per peg. The cache is keyed on cell size,
     so it rebuilds on zoom and not on pan. */
  function buildSprites(cell) {
    var size = Math.ceil(cell * 3);
    var mid = size / 2;
    var r = cell * 0.30;
    sprites = {};
    PALETTE.forEach(function (p) {
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(mid, mid, r * 0.4, mid, mid, cell * 1.35);
      grad.addColorStop(0, hexA(p.hex, 0.55));
      grad.addColorStop(0.35, hexA(p.hex, 0.16));
      grad.addColorStop(1, hexA(p.hex, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      g.beginPath();
      g.arc(mid, mid, r, 0, 6.2832);
      g.fillStyle = p.hex;
      g.fill();
      /* A bright core, because a real peg is lit from behind and the centre
         blows out. Without it every colour reads as flat felt. */
      g.beginPath();
      g.arc(mid - r * 0.15, mid - r * 0.18, r * 0.42, 0, 6.2832);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
      sprites[p.v] = c;
    });
    spriteCell = cell;
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var hover = { x: -1, y: -1 };
  var preview = null;      // array of {x,y,v} drawn on top while dragging a shape

  /* A whole-grid stand-in, used while the image controls are being tuned.
     It has to be read by draw() rather than swapped into state.cells around
     one call, because every hover event redraws — and a preview that only
     survives until the pointer moves is not a preview. */
  var overlayCells = null;
  function cellsForDraw() { return overlayCells || state.cells; }

  function draw() {
    if (!ctx) return;
    var cell = view.cell * dpr;
    var ox = view.ox * dpr, oy = view.oy * dpr;
    var w = state.cols * cell, h = state.rows * cell;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);

    /* The board itself. Slightly lighter than the page so its edge reads
       without needing a border, plus a hairline so it still reads when the
       zoom is small enough that the fill is mostly covered by pegs. */
    ctx.fillStyle = ui.lit ? '#000000' : '#0a0b0c';
    roundRect(ctx, ox, oy, w, h, Math.min(cell * 0.6, 14 * dpr));
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,237,225,0.14)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    /* Holes. Skipped below 5 px a cell, where they turn the board into a
       grey wash and hide the art they exist to register against. */
    if (ui.showHoles && cell > 5) {
      ctx.fillStyle = ui.lit ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.085)';
      var hr = Math.max(0.8, cell * 0.09);
      for (var y = 0; y < state.rows; y++) {
        var cy = oy + (y + 0.5) * cell;
        if (cy < -cell || cy > cv.height + cell) continue;
        for (var x = 0; x < state.cols; x++) {
          var cx = ox + (x + 0.5) * cell;
          if (cx < -cell || cx > cv.width + cell) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, hr, 0, 6.2832);
          ctx.fill();
        }
      }
    }

    if (!sprites || Math.abs(spriteCell - cell) > 0.5) buildSprites(cell);

    /* Lit mode composites the halos additively so overlapping pegs bloom
       into each other the way the real thing does. Flat mode is the honest
       one for editing — it shows exactly which hole holds a peg. */
    var half = Math.ceil(cell * 3) / 2;
    ctx.globalCompositeOperation = ui.lit ? 'lighter' : 'source-over';

    var src = cellsForDraw();
    for (var yy = 0; yy < state.rows; yy++) {
      var py = oy + (yy + 0.5) * cell;
      if (py < -cell * 2 || py > cv.height + cell * 2) continue;
      for (var xx = 0; xx < state.cols; xx++) {
        var v = src[yy * state.cols + xx];
        if (!v) continue;
        var px = ox + (xx + 0.5) * cell;
        if (px < -cell * 2 || px > cv.width + cell * 2) continue;
        if (ui.lit) {
          ctx.drawImage(sprites[v], px - half, py - half);
        } else {
          ctx.beginPath();
          ctx.arc(px, py, cell * 0.32, 0, 6.2832);
          ctx.fillStyle = BY_V[v].hex;
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    /* Shape preview: whatever the current drag would commit, drawn once on
       top rather than written into the grid, so cancelling costs nothing. */
    if (preview) {
      ctx.globalAlpha = 0.75;
      preview.forEach(function (p) {
        var px = ox + (p.x + 0.5) * cell, py = oy + (p.y + 0.5) * cell;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.32, 0, 6.2832);
        if (p.v) { ctx.fillStyle = BY_V[p.v].hex; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(); }
      });
      ctx.globalAlpha = 1;
    }

    if (inBounds(hover.x, hover.y) && cell > 6) {
      ctx.beginPath();
      ctx.arc(ox + (hover.x + 0.5) * cell, oy + (hover.y + 0.5) * cell, cell * 0.44, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function fitView() {
    var r = boardEl.getBoundingClientRect();
    var pad = 44;
    view.cell = Math.max(3, Math.min(
      (r.width - pad * 2) / state.cols,
      (r.height - pad * 2) / state.rows
    ));
    view.ox = (r.width - state.cols * view.cell) / 2;
    view.oy = (r.height - state.rows * view.cell) / 2;
    sprites = null;
    draw();
  }

  function zoomAt(factor, sx, sy) {
    var next = Math.max(2, Math.min(90, view.cell * factor));
    var k = next / view.cell;
    view.ox = sx - (sx - view.ox) * k;
    view.oy = sy - (sy - view.oy) * k;
    view.cell = next;
    sprites = null;
    draw();
  }

  function cellAt(sx, sy) {
    return {
      x: Math.floor((sx - view.ox) / view.cell),
      y: Math.floor((sy - view.oy) / view.cell)
    };
  }

  /* ---- writing into the grid ------------------------------------------ */

  /* Every write goes through here, which is what makes symmetry a two-line
     feature rather than a mode: the mirrors are applied at the point of
     writing, so pen, line, rectangle, ellipse and fill all inherit it. */
  function put(x, y, v) {
    var xs = [x], ys = [y];
    if (ui.mirrorX) xs.push(state.cols - 1 - x);
    if (ui.mirrorY) ys.push(state.rows - 1 - y);
    for (var i = 0; i < xs.length; i++) {
      for (var j = 0; j < ys.length; j++) {
        if (inBounds(xs[i], ys[j])) state.cells[idx(xs[i], ys[j])] = v;
      }
    }
  }

  function lineCells(x0, y0, x1, y1) {
    /* Bresenham. A pointer moving fast skips cells between events, and a
       line drawn hole-by-hole is the only kind that does not have gaps. */
    var out = [];
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      out.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }

  function rectCells(x0, y0, x1, y1, filled) {
    var out = [];
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (var y = ay; y <= by; y++) {
      for (var x = ax; x <= bx; x++) {
        if (filled || x === ax || x === bx || y === ay || y === by) out.push({ x: x, y: y });
      }
    }
    return out;
  }

  function ellipseCells(x0, y0, x1, y1, filled) {
    var out = [], seen = {};
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    var cx = (ax + bx) / 2, cy = (ay + by) / 2;
    var rx = Math.max(0.5, (bx - ax) / 2), ry = Math.max(0.5, (by - ay) / 2);
    for (var y = ay; y <= by; y++) {
      for (var x = ax; x <= bx; x++) {
        var dx = (x - cx) / rx, dy = (y - cy) / ry;
        var d = dx * dx + dy * dy;
        if (d > 1.02) continue;
        if (!filled) {
          /* An outline on a grid this coarse cannot be a stroke width — it
             is "inside the ellipse but with a neighbour outside it". */
          var edge = false;
          for (var k = 0; k < 4 && !edge; k++) {
            var nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k];
            var ex = (nx - cx) / rx, ey = (ny - cy) / ry;
            if (ex * ex + ey * ey > 1.02) edge = true;
          }
          if (!edge) continue;
        }
        var key = x + ',' + y;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ x: x, y: y });
      }
    }
    return out;
  }

  function flood(x, y, v) {
    if (!inBounds(x, y)) return;
    var target = state.cells[idx(x, y)];
    if (target === v) return;
    var stack = [x, y];
    while (stack.length) {
      var cy = stack.pop(), cx = stack.pop();
      if (!inBounds(cx, cy) || state.cells[idx(cx, cy)] !== target) continue;
      state.cells[idx(cx, cy)] = v;
      stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
    }
  }

  /* ---- pointer --------------------------------------------------------- */

  var drag = null;
  var spaceDown = false;

  function bindBoard() {
    boardEl.addEventListener('pointerdown', function (e) {
      boardEl.setPointerCapture(e.pointerId);
      var r = boardEl.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var c = cellAt(sx, sy);

      /* Touching the board is a decision to draw rather than to keep tuning,
         so the image preview stands down and what is under the pointer is
         the real grid again. */
      if (overlayCells && e.button === 0 && !spaceDown && ui.tool !== 'pan') overlayCells = null;

      /* Middle button or held space pans, whatever tool is selected. A tool
         you have to put down to move the canvas is a tool you fight. */
      if (e.button === 1 || spaceDown || ui.tool === 'pan') {
        drag = { mode: 'pan', sx: sx, sy: sy, ox: view.ox, oy: view.oy };
        boardEl.dataset.panning = '1';
        return;
      }
      if (e.button !== 0) return;

      var v = (ui.tool === 'eraser' || e.shiftKey) ? 0 : ui.color;

      if (ui.tool === 'picker') {
        if (inBounds(c.x, c.y)) {
          var got = state.cells[idx(c.x, c.y)];
          if (got) { ui.color = got; syncPalette(); }
        }
        return;
      }
      if (ui.tool === 'fill') {
        snapshot();
        flood(c.x, c.y, v);
        afterEdit();
        return;
      }
      if (ui.tool === 'pen' || ui.tool === 'eraser') {
        snapshot();
        drag = { mode: 'paint', v: v, last: c };
        put(c.x, c.y, v);
        afterEdit();
        return;
      }
      /* line / rect / ellipse: preview until release */
      drag = { mode: 'shape', v: v, from: c, to: c };
      updateShapePreview();
    });

    boardEl.addEventListener('pointermove', function (e) {
      var r = boardEl.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var c = cellAt(sx, sy);

      if (hover.x !== c.x || hover.y !== c.y) {
        hover = c;
        setHud();
        if (!drag) draw();
      }

      if (!drag) return;
      if (drag.mode === 'pan') {
        view.ox = drag.ox + (sx - drag.sx);
        view.oy = drag.oy + (sy - drag.sy);
        draw();
      } else if (drag.mode === 'paint') {
        lineCells(drag.last.x, drag.last.y, c.x, c.y).forEach(function (p) { put(p.x, p.y, drag.v); });
        drag.last = c;
        afterEdit(true);
      } else if (drag.mode === 'shape') {
        drag.to = c;
        updateShapePreview();
      }
    });

    function end() {
      if (!drag) return;
      if (drag.mode === 'shape' && preview) {
        snapshot();
        preview.forEach(function (p) { put(p.x, p.y, drag.v); });
        preview = null;
        afterEdit();
      }
      preview = null;
      drag = null;
      delete boardEl.dataset.panning;
      setHud();
      draw();
      autosave();
    }
    boardEl.addEventListener('pointerup', end);
    boardEl.addEventListener('pointercancel', end);
    boardEl.addEventListener('pointerleave', function () {
      if (!drag) { hover = { x: -1, y: -1 }; draw(); }
    });

    boardEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = boardEl.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function updateShapePreview() {
    var f = drag.from, t = drag.to, filled = ui.shapeFill;
    if (ui.tool === 'line') preview = lineCells(f.x, f.y, t.x, t.y);
    else if (ui.tool === 'rect') preview = rectCells(f.x, f.y, t.x, t.y, filled);
    else if (ui.tool === 'ellipse') preview = ellipseCells(f.x, f.y, t.x, t.y, filled);
    preview = (preview || []).map(function (p) { return { x: p.x, y: p.y, v: drag.v }; });
    setHud();
    draw();
  }

  /* ---- keyboard -------------------------------------------------------- */

  var TOOL_KEYS = { b: 'pen', e: 'eraser', g: 'fill', i: 'picker', l: 'line', r: 'rect', o: 'ellipse', h: 'pan' };

  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }

      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); openPreview(); return; }
      if (mod) return;

      var k = e.key.toLowerCase();
      if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
      if (k >= '1' && k <= '8') { ui.color = +k; syncPalette(); return; }
      if (k === 'f') { fitView(); return; }
      if (k === 'x') { ui.mirrorX = !ui.mirrorX; syncToggles(); return; }
      if (k === 'y') { ui.mirrorY = !ui.mirrorY; syncToggles(); return; }
      if (k === 'v') { ui.lit = !ui.lit; syncToggles(); draw(); return; }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') spaceDown = false;
    });
  }

  /* =======================================================================
     3. IMAGE — downsample, then quantise to the peg palette
     ---------------------------------------------------------------------
     A peg board is a very small, very saturated display: about a thousand
     cells and nine possible values, one of which is "off". Ordinary image
     resizing is the wrong instinct here — the useful step is choosing, per
     hole, which of nine states is least wrong, and that is a different
     question from "what colour is this pixel".
     ===================================================================== */

  var srcImage = null;

  var img = {
    fit: 'contain',
    brightness: 0,     // -100..100
    contrast: 0,       // -100..100
    saturation: 20,    // -100..100, biased up: pegs are saturated, photos are not
    cutoff: 42,        // luminance below this leaves the hole empty
    dither: true
  };

  /* Candidate list is the palette plus black-as-empty. Matching against
     black rather than thresholding first is what lets dithering trade a
     dark cell for an off cell honestly. */
  function candidates() {
    var list = [{ v: 0, r: 0, g: 0, b: 0 }];
    PALETTE.forEach(function (p) {
      var n = parseInt(p.hex.slice(1), 16);
      list.push({ v: p.v, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
    });
    return list;
  }

  /* "Redmean" distance. Plain RGB distance puts blue and purple absurdly far
     apart and green and yellow absurdly close; this weights the channels by
     where in the red axis the two colours sit, and costs one multiply more.
     It is not CIEDE2000, but on nine colours nothing finer would change an
     answer. */
  function nearest(list, r, g, b) {
    var best = list[0], bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var rm = (c.r + r) / 2;
      var dr = c.r - r, dg = c.g - g, db = c.b - b;
      var d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function sampleImage() {
    if (!srcImage) return null;
    var c = document.createElement('canvas');
    c.width = state.cols; c.height = state.rows;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#000';
    g.fillRect(0, 0, state.cols, state.rows);

    var iw = srcImage.naturalWidth || srcImage.width;
    var ih = srcImage.naturalHeight || srcImage.height;

    if (img.fit === 'stretch') {
      g.drawImage(srcImage, 0, 0, state.cols, state.rows);
    } else if (img.fit === 'cover') {
      var s = Math.max(state.cols / iw, state.rows / ih);
      var w = iw * s, h = ih * s;
      g.drawImage(srcImage, (state.cols - w) / 2, (state.rows - h) / 2, w, h);
    } else {
      var s2 = Math.min(state.cols / iw, state.rows / ih);
      var w2 = iw * s2, h2 = ih * s2;
      g.drawImage(srcImage, (state.cols - w2) / 2, (state.rows - h2) / 2, w2, h2);
    }
    return g.getImageData(0, 0, state.cols, state.rows);
  }

  function quantise() {
    var data = sampleImage();
    if (!data) return null;
    var px = data.data;
    var n = state.cols * state.rows;

    /* Adjustments run in float, once, before matching. Doing them in the
       ImageData's Uint8 would clip twice — once here and once at match
       time — and crush exactly the highlights the cutoff then reads. */
    var buf = new Float32Array(n * 3);
    /* The adjusted luminance BEFORE any dither error is added. The cutoff
       has to be judged against this and not against the diffused value, or
       a flat black background comes out speckled with single pegs: error
       pushed out of a dark neighbour is enough to lift a truly black hole
       over the line, and one lit peg in an empty field is the most visible
       mistake this converter can make. */
    var lum0 = new Float32Array(n);
    var bright = img.brightness * 2.55;
    var cFac = (259 * (img.contrast + 255)) / (255 * (259 - img.contrast));
    var sat = 1 + img.saturation / 100;

    for (var i = 0; i < n; i++) {
      var r = px[i * 4], g2 = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3] / 255;
      /* Transparent pixels are unlit holes, not black ones — but they land
         on black anyway, which is the same answer and one branch cheaper. */
      r *= a; g2 *= a; b *= a;
      r = cFac * (r - 128) + 128 + bright;
      g2 = cFac * (g2 - 128) + 128 + bright;
      b = cFac * (b - 128) + 128 + bright;
      var lum = 0.299 * r + 0.587 * g2 + 0.114 * b;
      r = lum + (r - lum) * sat;
      g2 = lum + (g2 - lum) * sat;
      b = lum + (b - lum) * sat;
      buf[i * 3] = r; buf[i * 3 + 1] = g2; buf[i * 3 + 2] = b;
      lum0[i] = 0.299 * r + 0.587 * g2 + 0.114 * b;
    }

    var list = candidates();
    var out = new Uint8Array(n);

    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        var k = y * state.cols + x;
        var R = buf[k * 3], G = buf[k * 3 + 1], B = buf[k * 3 + 2];
        var forced = lum0[k] < img.cutoff;
        var pick = forced ? list[0] : nearest(list, clamp255(R), clamp255(G), clamp255(B));
        out[k] = pick.v;

        /* A hole held empty by the cutoff swallows its error rather than
           passing it on. Diffusing it would just relocate the speckle to
           the next hole along and the flat black would never settle. */
        if (img.dither && !forced) {
          /* Floyd–Steinberg, pushed forward in the same float buffer. On a
             grid this coarse it is the difference between a face and a
             poster: without it, every mid-tone snaps to one flat colour. */
          var er = R - pick.r, eg = G - pick.g, eb = B - pick.b;
          spread(buf, x + 1, y, 7 / 16, er, eg, eb);
          spread(buf, x - 1, y + 1, 3 / 16, er, eg, eb);
          spread(buf, x, y + 1, 5 / 16, er, eg, eb);
          spread(buf, x + 1, y + 1, 1 / 16, er, eg, eb);
        }
      }
    }
    return out;
  }

  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function spread(buf, x, y, f, er, eg, eb) {
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return;
    var k = (y * state.cols + x) * 3;
    buf[k] += er * f; buf[k + 1] += eg * f; buf[k + 2] += eb * f;
  }

  var liveTimer = null;
  function previewImage() {
    /* Debounced because every slider drag would otherwise re-dither the
       whole grid on each of sixty frames. */
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (!srcImage) return;
      var q = quantise();
      if (!q) return;
      overlayCells = q;
      draw();
    }, 40);
  }

  function applyImage() {
    if (!srcImage) return;
    var q = overlayCells || quantise();
    if (!q) return;
    snapshot();
    state.cells = q;
    overlayCells = null;
    afterEdit();
    toast('Image converted — ' + countPegs().total + ' pegs');
  }

  function acceptFile(file) {
    if (!file) return;
    if (file.name && /\.pegsmith\.json$|\.json$/i.test(file.name)) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          load(JSON.parse(fr.result));
          syncBoardInputs(); fitView(); afterEdit(); toast('Loaded ' + state.name);
        } catch (err) { toast('Could not read that file.'); }
      };
      fr.readAsText(file);
      return;
    }
    if (!/^image\//.test(file.type)) { toast('Drop an image, or a .json Pegsmith file.'); return; }
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onload = function () {
      srcImage = im;
      var t = document.getElementById('ps-thumb');
      t.style.backgroundImage = 'url(' + url + ')';
      t.dataset.has = '1';
      t.textContent = '';
      openTab('image');
      previewImage();
      toast('Image loaded — tune it, then Convert');
    };
    im.onerror = function () { toast('That image would not load.'); };
    im.src = url;
  }

  /* =======================================================================
     4. SHEET — the printable template
     ---------------------------------------------------------------------
     One <svg> per sheet, width and height in millimetres, viewBox in the
     same numbers. Print at 100% and a hole on paper lands on a hole on the
     board. The calibration bar at the foot of every sheet is there because
     "Fit to page" is on by default in most print dialogs and will quietly
     shrink the whole thing by 4%: if that bar does not measure 100 mm with
     a ruler, the sheet is the wrong size and nothing else on it is usable.
     ===================================================================== */

  var print = {
    paper: 'letter',
    orient: 'auto',
    style: 'color',      // color | ring | black
    codes: false,
    keySheet: true,
    margin: 10           // mm
  };

  var HEAD_H = 12, FOOT_H = 13;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function tilesFor(pw, ph) {
    var availW = pw - print.margin * 2;
    var availH = ph - print.margin * 2 - HEAD_H - FOOT_H;
    var perX = Math.max(1, Math.floor(availW / state.pitch));
    var perY = Math.max(1, Math.floor(availH / state.pitch));
    return Math.ceil(state.cols / perX) * Math.ceil(state.rows / perY);
  }

  /* Auto orientation asks the only question that matters — which way round
     needs fewer sheets — rather than comparing the design's own proportions.
     A board that is wider than it is tall can still want portrait paper,
     and a design that misses the page by two millimetres should not silently
     become two sheets when turning the paper would have fitted it. Ties go
     to portrait, because that is the way paper comes out of the tray. */
  function paperSize() {
    var p = PAPERS[print.paper];
    if (print.orient === 'landscape') return { w: p.h, h: p.w, land: true };
    if (print.orient === 'portrait') return { w: p.w, h: p.h, land: false };
    return tilesFor(p.h, p.w) < tilesFor(p.w, p.h)
      ? { w: p.h, h: p.w, land: true }
      : { w: p.w, h: p.h, land: false };
  }

  function sheetPlan() {
    var pg = paperSize();
    var availW = pg.w - print.margin * 2;
    var availH = pg.h - print.margin * 2 - HEAD_H - FOOT_H;
    var perX = Math.max(1, Math.floor(availW / state.pitch));
    var perY = Math.max(1, Math.floor(availH / state.pitch));
    return {
      pg: pg, availW: availW, availH: availH, perX: perX, perY: perY,
      tilesX: Math.ceil(state.cols / perX),
      tilesY: Math.ceil(state.rows / perY)
    };
  }

  function countPegs() {
    var by = {}, total = 0;
    PALETTE.forEach(function (p) { by[p.v] = 0; });
    for (var i = 0; i < state.cells.length; i++) {
      var v = state.cells[i];
      if (v) { by[v]++; total++; }
    }
    return { by: by, total: total };
  }

  function svgSheet(parts, pg, dark) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + pg.w + 'mm" height="' + pg.h + 'mm"' +
      ' viewBox="0 0 ' + pg.w + ' ' + pg.h + '">' +
      '<rect width="' + pg.w + '" height="' + pg.h + '" fill="' + (dark ? '#000000' : '#ffffff') + '"/>' +
      parts.join('') + '</svg>';
  }

  function calibrationBar(x, y, fg, dim) {
    /* 100 mm, ticked every 10 and labelled. Deliberately not an inch bar as
       well: two rulers invites measuring the wrong one. */
    var p = ['<g stroke="' + fg + '" stroke-width="0.25" fill="' + fg + '">'];
    p.push('<line x1="' + x + '" y1="' + y + '" x2="' + (x + 100) + '" y2="' + y + '"/>');
    for (var i = 0; i <= 10; i++) {
      var tx = x + i * 10, len = (i % 5 === 0) ? 2.6 : 1.5;
      p.push('<line x1="' + tx + '" y1="' + (y - len) + '" x2="' + tx + '" y2="' + y + '"/>');
    }
    p.push('</g>');
    p.push('<text x="' + x + '" y="' + (y + 3.6) + '" font-family="monospace" font-size="2.5" fill="' + dim +
      '">100 mm &#8212; if this bar does not measure 100 mm, reprint at 100% scale (turn off &#8220;fit to page&#8221;)</text>');
    return p.join('');
  }

  function buildSheets() {
    var plan = sheetPlan();
    var pg = plan.pg;
    var dark = print.style === 'black';
    var fg = dark ? '#ffffff' : '#111111';
    var dim = dark ? '#8a8a8a' : '#8a8a8a';
    var holeFill = dark ? '#2a2a2a' : '#d8d8d8';
    var sheets = [];
    var tally = countPegs();

    var total = plan.tilesX * plan.tilesY;
    if (total > 60) return { sheets: [], error: 'That design needs ' + total + ' sheets. Reduce the grid or the pitch.' };

    for (var ty = 0; ty < plan.tilesY; ty++) {
      for (var tx = 0; tx < plan.tilesX; tx++) {
        var x0 = tx * plan.perX, y0 = ty * plan.perY;
        var x1 = Math.min(state.cols, x0 + plan.perX);
        var y1 = Math.min(state.rows, y0 + plan.perY);
        var nx = x1 - x0, ny = y1 - y0;

        var fieldW = nx * state.pitch, fieldH = ny * state.pitch;
        /* A single sheet centres its artwork, because that looks right and
           nothing has to line up with anything. Tiles do NOT: every tile is
           pinned to the same top-left origin, so trimming each one on its
           own field outline and butting the edges reproduces the pitch
           across the join. Centre them and the trimmed sheets are each off
           by a different fraction of a hole. */
        var ax = total > 1
          ? print.margin + state.pitch / 2
          : print.margin + (plan.availW - fieldW) / 2;
        var ay = print.margin + HEAD_H + (total > 1
          ? state.pitch / 2
          : (plan.availH - fieldH) / 2);

        var p = [];

        /* Header. The grid range is on every sheet on purpose — it is the
           only thing that tells you which tile you are holding once they
           are cut out and spread on a table. */
        var title = (state.name || 'untitled') + '  ·  ' + state.cols + '×' + state.rows +
          ' @ ' + state.pitch.toFixed(2) + ' mm';
        p.push('<text x="' + print.margin + '" y="' + (print.margin + 4) + '" font-family="monospace" font-size="3.4" fill="' + fg + '">' + esc(title) + '</text>');
        var right = total > 1
          ? 'SHEET ' + (ty * plan.tilesX + tx + 1) + '/' + total + '   COLS ' + (x0 + 1) + '–' + x1 + '  ROWS ' + (y0 + 1) + '–' + y1
          : 'PEGSMITH';
        p.push('<text x="' + (pg.w - print.margin) + '" y="' + (print.margin + 4) + '" text-anchor="end" font-family="monospace" font-size="2.8" fill="' + dim + '">' + esc(right) + '</text>');

        /* The field outline is the artwork boundary — lay the sheet on the
           board and this rectangle is what you square up. */
        p.push('<rect x="' + (ax - state.pitch / 2).toFixed(3) + '" y="' + (ay - state.pitch / 2).toFixed(3) +
          '" width="' + (fieldW).toFixed(3) + '" height="' + (fieldH).toFixed(3) +
          '" fill="none" stroke="' + dim + '" stroke-width="0.2" stroke-dasharray="1.2 1.2"/>');

        /* Holes first, pegs over them. Every hole is marked even when empty:
           an unbroken lattice is what makes a half-finished sheet land in
           the right row. */
        var holeR = Math.max(0.22, state.pitch * 0.05);
        var pegR = state.pitch * 0.34;
        var holes = [], pegs = [];
        for (var y = y0; y < y1; y++) {
          for (var x = x0; x < x1; x++) {
            var cx = +(ax + (x - x0) * state.pitch + state.pitch / 2).toFixed(3);
            var cy = +(ay + (y - y0) * state.pitch + state.pitch / 2).toFixed(3);
            var v = state.cells[y * state.cols + x];
            if (!v) {
              holes.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + holeR.toFixed(3) + '" fill="' + holeFill + '"/>');
              continue;
            }
            var col = BY_V[v];
            var paint = dark ? col.hex : col.ink;
            if (print.style === 'ring') {
              pegs.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + pegR.toFixed(3) +
                '" fill="none" stroke="' + paint + '" stroke-width="' + (state.pitch * 0.13).toFixed(3) + '"/>');
              pegs.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + holeR.toFixed(3) + '" fill="' + paint + '"/>');
            } else {
              pegs.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + pegR.toFixed(3) + '" fill="' + paint +
                '" stroke="' + (dark ? 'none' : 'rgba(0,0,0,0.35)') + '" stroke-width="0.12"/>');
            }
            if (print.codes && state.pitch >= 4.5) {
              pegs.push('<text x="' + cx + '" y="' + (cy + state.pitch * 0.14).toFixed(3) +
                '" text-anchor="middle" font-family="monospace" font-size="' + (state.pitch * 0.42).toFixed(2) +
                '" fill="' + (print.style === 'ring' ? paint : (dark ? '#000' : '#ffffff')) + '">' + col.key + '</text>');
            }
          }
        }
        p.push(holes.join(''), pegs.join(''));

        /* Cut marks sit on the FIELD corners, not the page margin — the
           field outline is the line you trim, so it is the line the marks
           have to extend. */
        if (total > 1) {
          var m = 4;
          var fx0 = ax - state.pitch / 2, fy0 = ay - state.pitch / 2;
          var fx1 = fx0 + fieldW, fy1 = fy0 + fieldH;
          [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]
            .forEach(function (c) {
              p.push('<g stroke="' + dim + '" stroke-width="0.2">' +
                '<line x1="' + (c[0] - m) + '" y1="' + c[1] + '" x2="' + (c[0] + m) + '" y2="' + c[1] + '"/>' +
                '<line x1="' + c[0] + '" y1="' + (c[1] - m) + '" x2="' + c[0] + '" y2="' + (c[1] + m) + '"/></g>');
            });
        }

        p.push(calibrationBar(print.margin, pg.h - print.margin - 4, fg, dim));
        sheets.push(svgSheet(p, pg, dark));
      }
    }

    if (print.keySheet) sheets.push(keySheet(pg, dark, fg, dim, tally, plan, total));
    return { sheets: sheets, error: null, count: sheets.length };
  }

  function keySheet(pg, dark, fg, dim, tally, plan, tiles) {
    var p = [];
    var x = print.margin, y = print.margin + 8;
    p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="5" fill="' + fg + '">' +
      esc(state.name || 'untitled') + '</text>');
    y += 6;
    p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="3" fill="' + dim + '">BUILD SHEET</text>');

    y += 12;
    var meta = [
      ['Grid', state.cols + ' × ' + state.rows + ' holes'],
      ['Pitch', state.pitch.toFixed(2) + ' mm  (' + (state.pitch / MM_PER_IN).toFixed(3) + ' in)'],
      ['Artwork', (state.cols * state.pitch).toFixed(1) + ' × ' + (state.rows * state.pitch).toFixed(1) + ' mm'],
      ['Sheets', tiles + (tiles > 1 ? ' tiles (' + plan.tilesX + ' × ' + plan.tilesY + ')' : '')],
      ['Pegs', String(tally.total)]
    ];
    meta.forEach(function (row) {
      p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="3.2" fill="' + dim + '">' + esc(row[0]) + '</text>');
      p.push('<text x="' + (x + 28) + '" y="' + y + '" font-family="monospace" font-size="3.2" fill="' + fg + '">' + esc(row[1]) + '</text>');
      y += 5.4;
    });

    y += 8;
    p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="3" fill="' + dim + '">PEGS BY COLOUR</text>');
    y += 6;
    var maxN = 1;
    PALETTE.forEach(function (c) { maxN = Math.max(maxN, tally.by[c.v]); });
    PALETTE.forEach(function (c) {
      var n = tally.by[c.v];
      var paint = dark ? c.hex : c.ink;
      p.push('<circle cx="' + (x + 2.2) + '" cy="' + (y - 1.1) + '" r="2.2" fill="' + paint +
        '" stroke="' + (dark ? 'none' : 'rgba(0,0,0,0.3)') + '" stroke-width="0.15"/>');
      p.push('<text x="' + (x + 7) + '" y="' + y + '" font-family="monospace" font-size="3.2" fill="' + fg + '">' + c.name + '</text>');
      p.push('<rect x="' + (x + 30) + '" y="' + (y - 2.6) + '" width="' + (50 * n / maxN).toFixed(2) +
        '" height="2.4" fill="' + paint + '" opacity="0.85"/>');
      p.push('<text x="' + (x + 95) + '" y="' + y + '" text-anchor="end" font-family="monospace" font-size="3.2" fill="' + fg + '">' + n + '</text>');
      y += 5.6;
    });

    if (tiles > 1) {
      y += 8;
      p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="3" fill="' + dim + '">SHEET ORDER</text>');
      y += 4;
      var bw = 12, bh = 9;
      for (var r = 0; r < plan.tilesY; r++) {
        for (var c2 = 0; c2 < plan.tilesX; c2++) {
          var bx = x + c2 * (bw + 1.5), by = y + r * (bh + 1.5);
          p.push('<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh +
            '" fill="none" stroke="' + dim + '" stroke-width="0.25"/>');
          p.push('<text x="' + (bx + bw / 2) + '" y="' + (by + bh / 2 + 1.2) + '" text-anchor="middle" font-family="monospace" font-size="3.4" fill="' + fg + '">' +
            (r * plan.tilesX + c2 + 1) + '</text>');
        }
      }
      y += plan.tilesY * (bh + 1.5) + 6;
      p.push('<text x="' + x + '" y="' + y + '" font-family="monospace" font-size="2.8" fill="' + dim +
        '">Trim each tile on its dashed outline and butt the edges &#8212; tiles do not overlap.</text>');
    }

    p.push(calibrationBar(print.margin, pg.h - print.margin - 4, fg, dim));
    return svgSheet(p, pg, dark);
  }

  function renderSheets() {
    var root = document.getElementById('ps-print');
    var res = buildSheets();
    if (res.error) { root.innerHTML = ''; toast(res.error); return 0; }
    root.innerHTML = res.sheets.map(function (s) { return '<div class="ps-sheet">' + s + '</div>'; }).join('');

    /* @page has to carry the same paper the SVG was sized for, or the
       browser picks its own default and the sheet is cropped or scaled. */
    var pg = paperSize();
    var st = document.getElementById('ps-page-style');
    st.textContent = '@page { size: ' + pg.w + 'mm ' + pg.h + 'mm; margin: 0; }';
    return res.count;
  }

  /* =======================================================================
     5. UI
     ===================================================================== */

  var $ = function (id) { return document.getElementById(id); };

  var toastTimer = null;
  function toast(msg) {
    var t = $('ps-toast');
    t.textContent = msg;
    t.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { delete t.dataset.show; }, 2600);
  }

  function afterEdit(light) {
    draw();
    if (!light) { renderTally(); autosave(); }
  }

  function setHud() {
    var bits = [];
    bits.push('<b>' + state.cols + '×' + state.rows + '</b>');
    bits.push((state.cols * state.pitch / MM_PER_IN).toFixed(1) + '×' + (state.rows * state.pitch / MM_PER_IN).toFixed(1) + ' in');
    if (inBounds(hover.x, hover.y)) bits.push('<b>' + (hover.x + 1) + ',' + (hover.y + 1) + '</b>');
    if (preview) bits.push(preview.length + ' cells');
    $('ps-hud').innerHTML = bits.join(' · ');
  }

  function setTool(t) {
    ui.tool = t;
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
    });
  }

  function syncToggles() {
    $('ps-mirror-x').setAttribute('aria-pressed', ui.mirrorX ? 'true' : 'false');
    $('ps-mirror-y').setAttribute('aria-pressed', ui.mirrorY ? 'true' : 'false');
    $('ps-lit').checked = ui.lit;
    $('ps-holes').checked = ui.showHoles;
    $('ps-fill-shape').setAttribute('aria-pressed', ui.shapeFill ? 'true' : 'false');
    draw();
  }

  function syncPalette() {
    document.querySelectorAll('[data-swatch]').forEach(function (b) {
      b.setAttribute('aria-pressed', +b.dataset.swatch === ui.color ? 'true' : 'false');
    });
  }

  function refreshHistoryButtons() {
    $('ps-undo').disabled = !undoStack.length;
    $('ps-redo').disabled = !redoStack.length;
  }

  function openTab(name) {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    document.querySelectorAll('[data-pane]').forEach(function (p) {
      if (p.dataset.pane === name) p.dataset.open = '1'; else delete p.dataset.open;
    });
    if (name === 'print') updateSheetInfo();
  }

  function buildPalette() {
    var wrap = $('ps-palette');
    var html = PALETTE.map(function (p) {
      return '<button class="ps-swatch" type="button" data-swatch="' + p.v + '" style="--c:' + p.hex +
        '" title="' + p.name + ' (' + p.v + ')" aria-pressed="false"><i></i><small>' + p.v + '</small></button>';
    }).join('');
    html += '<button class="ps-swatch" type="button" data-swatch="0" data-empty="1" title="No peg (Shift-drag)" aria-pressed="false"><i></i></button>';
    wrap.innerHTML = html;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-swatch]');
      if (!b) return;
      var v = +b.dataset.swatch;
      if (v === 0) { setTool('eraser'); return; }
      ui.color = v;
      if (ui.tool === 'eraser') setTool('pen');
      syncPalette();
    });
    syncPalette();
  }

  function renderTally() {
    var t = countPegs();
    var max = 1;
    PALETTE.forEach(function (c) { max = Math.max(max, t.by[c.v]); });
    $('ps-tally').innerHTML = PALETTE.map(function (c) {
      var n = t.by[c.v];
      return '<div class="ps-tally__row" style="--c:' + c.hex + '">' +
        '<span class="ps-tally__dot"></span>' +
        '<span class="ps-tally__bar"><span style="width:' + (100 * n / max).toFixed(1) + '%"></span></span>' +
        '<span class="ps-tally__n">' + n + '</span></div>';
    }).join('') +
      '<div class="ps-tally__row" style="--c:transparent;margin-top:6px"><span></span>' +
      '<span style="color:var(--ps-text-faint)">TOTAL</span><span class="ps-tally__n">' + t.total + '</span></div>';
  }

  function syncBoardInputs() {
    $('ps-cols').value = state.cols;
    $('ps-rows').value = state.rows;
    $('ps-pitch').value = state.pitch.toFixed(2);
    $('ps-preset').value = state.preset;
    $('ps-name').value = state.name;
    $('ps-size').textContent =
      (state.cols * state.pitch).toFixed(0) + ' × ' + (state.rows * state.pitch).toFixed(0) + ' mm  ·  ' +
      (state.cols * state.pitch / MM_PER_IN).toFixed(2) + ' × ' + (state.rows * state.pitch / MM_PER_IN).toFixed(2) + ' in';
    setHud();
    updateSheetInfo();
  }

  function applyGrid() {
    var cols = Math.max(2, Math.min(400, parseInt($('ps-cols').value, 10) || state.cols));
    var rows = Math.max(2, Math.min(400, parseInt($('ps-rows').value, 10) || state.rows));
    var pitch = Math.max(1, Math.min(60, parseFloat($('ps-pitch').value) || state.pitch));
    if (cols === state.cols && rows === state.rows && pitch === state.pitch) return;
    snapshot();
    state.cells = allocGrid(cols, rows, state.cells, state.cols, state.rows);
    state.cols = cols; state.rows = rows; state.pitch = pitch;
    syncBoardInputs();
    fitView();
    afterEdit();
    if (srcImage) previewImage();
  }

  function updateSheetInfo() {
    var el = $('ps-sheetinfo');
    if (!el) return;
    var plan = sheetPlan();
    var tiles = plan.tilesX * plan.tilesY;
    var pages = tiles + (print.keySheet ? 1 : 0);
    el.innerHTML =
      '<strong>' + pages + '</strong> page' + (pages === 1 ? '' : 's') +
      (tiles > 1 ? ' — artwork tiled ' + plan.tilesX + ' × ' + plan.tilesY : ' — fits on one sheet') +
      '<br>' + plan.pg.w + ' × ' + plan.pg.h + ' mm ' + (plan.pg.land ? 'landscape' : 'portrait') +
      ', up to ' + plan.perX + ' × ' + plan.perY + ' holes per sheet.';
  }

  function openPreview() {
    var n = renderSheets();
    if (!n) return;
    $('ps-preview').dataset.open = '1';
  }
  function closePreview() { delete $('ps-preview').dataset.open; }

  /* ---- files ----------------------------------------------------------- */

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function saveJSON() {
    var doc = serialise();
    download(slug(state.name) + '.pegsmith.json', new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  }

  function slug(s) {
    return (String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled');
  }

  function exportPNG() {
    /* The lit preview at a fixed generous cell size, so a share image does
       not inherit whatever zoom happened to be on screen. */
    var cell = 22, pad = cell;
    var w = state.cols * cell + pad * 2, h = state.rows * cell + pad * 2;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);

    var keepCv = cv, keepCtx = ctx, keepView = { cell: view.cell, ox: view.ox, oy: view.oy }, keepDpr = dpr;
    cv = c; ctx = g; dpr = 1;
    view.cell = cell; view.ox = pad; view.oy = pad;
    sprites = null;
    var keepHover = hover; hover = { x: -1, y: -1 };
    draw();
    hover = keepHover;
    cv = keepCv; ctx = keepCtx; dpr = keepDpr;
    view.cell = keepView.cell; view.ox = keepView.ox; view.oy = keepView.oy;
    sprites = null;
    draw();

    c.toBlob(function (b) { download(slug(state.name) + '.png', b); });
  }

  /* ---- wiring ---------------------------------------------------------- */

  function bindUI() {
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () { setTool(b.dataset.tool); });
    });
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { openTab(b.dataset.tab); });
    });

    $('ps-undo').addEventListener('click', undo);
    $('ps-redo').addEventListener('click', redo);

    $('ps-zoom-in').addEventListener('click', function () {
      var r = boardEl.getBoundingClientRect();
      zoomAt(1.25, r.width / 2, r.height / 2);
    });
    $('ps-zoom-out').addEventListener('click', function () {
      var r = boardEl.getBoundingClientRect();
      zoomAt(1 / 1.25, r.width / 2, r.height / 2);
    });
    $('ps-zoom-fit').addEventListener('click', fitView);

    $('ps-mirror-x').addEventListener('click', function () { ui.mirrorX = !ui.mirrorX; syncToggles(); });
    $('ps-mirror-y').addEventListener('click', function () { ui.mirrorY = !ui.mirrorY; syncToggles(); });
    $('ps-fill-shape').addEventListener('click', function () { ui.shapeFill = !ui.shapeFill; syncToggles(); });
    $('ps-lit').addEventListener('change', function () { ui.lit = this.checked; sprites = null; draw(); });
    $('ps-holes').addEventListener('change', function () { ui.showHoles = this.checked; draw(); });

    /* ---- board pane ---- */
    $('ps-preset').addEventListener('change', function () {
      var p = PRESETS[this.value];
      state.preset = this.value;
      if (!p || !p.w) { syncBoardInputs(); return; }
      state.pitch = p.pitch;
      var cols = Math.round(p.w / p.pitch), rows = Math.round(p.h / p.pitch);
      snapshot();
      state.cells = allocGrid(cols, rows, state.cells, state.cols, state.rows);
      state.cols = cols; state.rows = rows;
      syncBoardInputs(); fitView(); afterEdit();
      if (srcImage) previewImage();
    });
    ['ps-cols', 'ps-rows', 'ps-pitch'].forEach(function (id) {
      $(id).addEventListener('change', function () { state.preset = 'custom'; $('ps-preset').value = 'custom'; applyGrid(); });
    });
    $('ps-name').addEventListener('input', function () { state.name = this.value || 'untitled'; autosave(); });

    $('ps-cal-apply').addEventListener('click', function () {
      var n = parseInt($('ps-cal-holes').value, 10);
      var mm = parseFloat($('ps-cal-mm').value);
      if (!(n > 1) || !(mm > 0)) { toast('Enter a hole count above 1 and the distance you measured.'); return; }
      /* n holes have n-1 gaps between their centres. Getting this off by one
         is the classic way to end up 3% out over a full board. */
      state.pitch = mm / (n - 1);
      state.preset = 'custom';
      syncBoardInputs(); fitView();
      toast('Pitch set to ' + state.pitch.toFixed(3) + ' mm');
      autosave();
    });

    $('ps-clear').addEventListener('click', function () {
      snapshot();
      state.cells.fill(0);
      afterEdit();
    });
    $('ps-invert').addEventListener('click', function () {
      snapshot();
      for (var i = 0; i < state.cells.length; i++) state.cells[i] = state.cells[i] ? 0 : ui.color;
      afterEdit();
    });

    /* ---- image pane ---- */
    $('ps-thumb').addEventListener('click', function () { $('ps-file').click(); });
    $('ps-file').addEventListener('change', function () { acceptFile(this.files[0]); this.value = ''; });
    $('ps-fit').addEventListener('change', function () { img.fit = this.value; previewImage(); });
    [['ps-bright', 'brightness'], ['ps-contrast', 'contrast'], ['ps-sat', 'saturation'], ['ps-cutoff', 'cutoff']]
      .forEach(function (pair) {
        var el = $(pair[0]);
        el.addEventListener('input', function () {
          img[pair[1]] = +this.value;
          var out = document.querySelector('[data-out="' + pair[0] + '"]');
          if (out) out.textContent = this.value;
          previewImage();
        });
      });
    $('ps-dither').addEventListener('change', function () { img.dither = this.checked; previewImage(); });
    $('ps-apply-img').addEventListener('click', applyImage);
    $('ps-match-aspect').addEventListener('click', function () {
      if (!srcImage) { toast('Load an image first.'); return; }
      var ar = (srcImage.naturalWidth || 1) / (srcImage.naturalHeight || 1);
      var rows = state.rows;
      var cols = Math.max(2, Math.min(400, Math.round(rows * ar)));
      $('ps-cols').value = cols;
      state.preset = 'custom'; $('ps-preset').value = 'custom';
      applyGrid();
    });
    $('ps-clear-img').addEventListener('click', function () {
      srcImage = null;
      overlayCells = null;
      var t = $('ps-thumb');
      t.style.backgroundImage = '';
      delete t.dataset.has;
      t.textContent = 'Click or drop an image here';
      draw();
    });

    /* ---- print pane ---- */
    [['ps-paper', 'paper'], ['ps-orient', 'orient'], ['ps-style', 'style']].forEach(function (pair) {
      $(pair[0]).addEventListener('change', function () { print[pair[1]] = this.value; updateSheetInfo(); });
    });
    $('ps-codes').addEventListener('change', function () { print.codes = this.checked; });
    $('ps-keysheet').addEventListener('change', function () { print.keySheet = this.checked; updateSheetInfo(); });
    $('ps-margin').addEventListener('change', function () {
      print.margin = Math.max(3, Math.min(30, +this.value || 10));
      this.value = print.margin;
      updateSheetInfo();
    });
    $('ps-open-preview').addEventListener('click', openPreview);
    $('ps-preview-close').addEventListener('click', closePreview);
    $('ps-preview-print').addEventListener('click', function () { window.print(); });
    $('ps-print-now').addEventListener('click', function () {
      if (renderSheets()) window.print();
    });

    /* ---- save pane ---- */
    $('ps-save-json').addEventListener('click', saveJSON);
    $('ps-export-png').addEventListener('click', exportPNG);
    $('ps-load-file').addEventListener('change', function () { acceptFile(this.files[0]); this.value = ''; });
    $('ps-load-json').addEventListener('click', function () { $('ps-load-file').click(); });
    $('ps-new').addEventListener('click', function () {
      snapshot();
      state.cells.fill(0);
      state.name = 'untitled';
      $('ps-name').value = '';
      afterEdit();
      toast('Cleared');
    });

    /* ---- drag and drop over the whole window ---- */
    ['dragenter', 'dragover'].forEach(function (t) {
      window.addEventListener(t, function (e) { e.preventDefault(); boardEl.dataset.drop = '1'; });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      window.addEventListener(t, function (e) {
        e.preventDefault();
        if (t === 'dragleave' && e.relatedTarget) return;
        delete boardEl.dataset.drop;
        if (t === 'drop' && e.dataTransfer && e.dataTransfer.files.length) acceptFile(e.dataTransfer.files[0]);
      });
    });

    window.addEventListener('resize', sizeCanvas);
    /* Rebuilt on every print, not only the first: someone who previews,
       changes the paper and then hits the browser's own Print would
       otherwise get the sheets they had before the change. */
    window.addEventListener('beforeprint', function () { renderSheets(); });
  }

  /* ---- start ----------------------------------------------------------- */

  function init() {
    boardEl = $('ps-board');
    cv = $('ps-canvas');
    ctx = cv.getContext('2d');

    ui.shapeFill = false;

    if (!restore()) {
      var p = PRESETS.ultimate;
      state.pitch = p.pitch;
      state.cols = Math.round(p.w / p.pitch);
      state.rows = Math.round(p.h / p.pitch);
      state.cells = allocGrid(state.cols, state.rows);
      seedDemo();
    }

    buildPalette();
    bindBoard();
    bindKeys();
    bindUI();
    syncBoardInputs();
    syncToggles();
    setTool('pen');
    refreshHistoryButtons();
    renderTally();
    sizeCanvas();
    fitView();
    openTab('board');
  }

  /* A first-run design, so the board is never an empty grid with no clue
     what it is for. Overwritten by the first Clear and never restored — it
     only ever exists before anything is saved. */
  function seedDemo() {
    var cx = state.cols / 2, cy = state.rows / 2;
    var r = Math.min(state.cols, state.rows) * 0.34;
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        var dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        var band = Math.floor(d * 5);
        state.cells[idx(x, y)] = [4, 3, 2, 7, 8][band] || 8;
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
