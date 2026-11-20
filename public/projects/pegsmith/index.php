<!DOCTYPE html>
<html lang="en">
<head>
<!-- PHP includes, not SSI. include takes a filesystem path,
     hence DOCUMENT_ROOT: a bare "/includes/head.php" would be looked up from
     the server's root directory rather than the site's, and would silently
     produce nothing. -->

<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Pegsmith</title>
<meta name="description" content="Design peg-light art on a grid, or convert a photo to peg colours, then print a template at true scale so the holes line up with the board." />

<?php include $_SERVER['DOCUMENT_ROOT'] . '/includes/head.php'; ?>

<link rel="stylesheet" href="assets/css/pegsmith.css" />
<?php pw_light_css('/projects/pegsmith/assets/css/pegsmith.light.css'); ?>

<!-- Rewritten at print time with the paper the sheets were actually sized
     for. It must exist in the document from the start: injecting a <style>
     during beforeprint is too late in some browsers, and the page then
     prints at the default paper with the artwork scaled — which is the one
     failure this whole tool exists to avoid. -->
<style id="ps-page-style">@page { size: 215.9mm 279.4mm; margin: 0; }</style>
</head>

<!-- pw-accent-lumen: the chrome's accent here. A peg board is eight
     saturated colours at once, so the page furniture cannot take any of
     them without appearing to mean something. Cyan is the one bright hue
     that is NOT in the peg set. -->
<body class="pw-accent-lumen">

<?php include $_SERVER['DOCUMENT_ROOT'] . '/includes/nav.php'; ?>

<div class="ps-shell">

  <!-- ------------------------------------------------------------ rail -->
  <div class="ps-rail" role="toolbar" aria-label="Tools">
    <button class="ps-tool" type="button" data-tool="pen" data-tip="Peg  ·  B" aria-pressed="true" aria-label="Peg">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7-4-4-7 7-1 5z"/><path d="M15 8l1-1a2 2 0 1 1 3 3l-1 1"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="eraser" data-tip="Erase  ·  E" aria-pressed="false" aria-label="Erase">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l8-8 6 6-4 4H6z"/><path d="M4 20h16"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="fill" data-tip="Fill  ·  G" aria-pressed="false" aria-label="Fill">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3z"/><path d="M19 15s2 2.4 2 3.6a2 2 0 1 1-4 0C17 17.4 19 15 19 15z"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="picker" data-tip="Pick colour  ·  I" aria-pressed="false" aria-label="Pick colour">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5-9 9-5 1 1-5z"/><path d="M13 6l5 5"/></svg>
    </button>

    <div class="ps-rail__sep"></div>

    <button class="ps-tool" type="button" data-tool="line" data-tip="Line  ·  L" aria-pressed="false" aria-label="Line">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="rect" data-tip="Rectangle  ·  R" aria-pressed="false" aria-label="Rectangle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="ellipse" data-tip="Ellipse  ·  O" aria-pressed="false" aria-label="Ellipse">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="12" rx="8" ry="6.5"/></svg>
    </button>
    <button class="ps-tool" type="button" id="ps-fill-shape" data-tip="Filled shapes" aria-pressed="false" aria-label="Filled shapes">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" opacity="0.55"/><rect x="4" y="6" width="16" height="12" rx="1"/></svg>
    </button>

    <div class="ps-rail__sep"></div>

    <button class="ps-tool" type="button" id="ps-mirror-x" data-tip="Mirror left/right  ·  X" aria-pressed="false" aria-label="Mirror horizontally">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v18"/><path d="M9 8L4 12l5 4z"/><path d="M15 8l5 4-5 4z"/></svg>
    </button>
    <button class="ps-tool" type="button" id="ps-mirror-y" data-tip="Mirror top/bottom  ·  Y" aria-pressed="false" aria-label="Mirror vertically">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 12h18"/><path d="M8 9L12 4l4 5z"/><path d="M8 15l4 5 4-5z"/></svg>
    </button>

    <div class="ps-rail__sep"></div>

    <button class="ps-tool" type="button" id="ps-undo" data-tip="Undo  ·  Ctrl+Z" aria-label="Undo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="M8 5L4 9l4 4"/></svg>
    </button>
    <button class="ps-tool" type="button" id="ps-redo" data-tip="Redo  ·  Ctrl+Shift+Z" aria-label="Redo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9H9a5 5 0 0 0 0 10h6"/><path d="M16 5l4 4-4 4"/></svg>
    </button>
    <button class="ps-tool" type="button" data-tool="pan" data-tip="Pan  ·  H, or hold Space" aria-pressed="false" aria-label="Pan">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M9 12V7a1.5 1.5 0 0 1 3 0"/><path d="M12 12V6a1.5 1.5 0 0 1 3 0v6"/><path d="M15 12V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.3-1.8L4 17.5a1.6 1.6 0 0 1 2.3-2.2L9 17"/></svg>
    </button>
  </div>

  <!-- ----------------------------------------------------------- board -->
  <div class="ps-board" id="ps-board">
    <canvas id="ps-canvas" aria-label="Peg board"></canvas>
    <div class="ps-hud" id="ps-hud"></div>
    <div class="ps-zoom">
      <button type="button" id="ps-zoom-out" aria-label="Zoom out">&minus;</button>
      <button type="button" id="ps-zoom-fit" aria-label="Fit to view">FIT</button>
      <button type="button" id="ps-zoom-in" aria-label="Zoom in">+</button>
    </div>
    <div class="ps-drop">Drop an image to convert it</div>
  </div>

  <!-- ----------------------------------------------------------- panel -->
  <div class="ps-panel">
    <div class="ps-tabs" role="tablist">
      <button type="button" data-tab="board" role="tab" aria-selected="true">Board</button>
      <button type="button" data-tab="image" role="tab" aria-selected="false">Image</button>
      <button type="button" data-tab="print" role="tab" aria-selected="false">Print</button>
      <button type="button" data-tab="file"  role="tab" aria-selected="false">File</button>
    </div>

    <div class="ps-panes">

      <!-- ---- BOARD ---- -->
      <section class="ps-pane" data-pane="board" data-open="1">
        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-colour', 'Colour') ?></h2>
          <div class="ps-palette" id="ps-palette"></div>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-board', 'Board') ?></h2>
          <label class="ps-field">
            <span class="ps-field__label">Model</span>
            <select id="ps-preset">
              <option value="ultimate">Ultimate Classic — 8 × 6½ in</option>
              <option value="cube">Cube — 6¾ in square</option>
              <option value="mini">Mini — 3⅝ × 3½ in</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <div class="ps-row ps-row--split">
            <label class="ps-field" style="margin:0">
              <span class="ps-field__label">Holes across</span>
              <input type="number" id="ps-cols" min="2" max="400" step="1" />
            </label>
            <label class="ps-field" style="margin:0">
              <span class="ps-field__label">Holes down</span>
              <input type="number" id="ps-rows" min="2" max="400" step="1" />
            </label>
          </div>
          <label class="ps-field" style="margin-top:8px">
            <span class="ps-field__label">Hole spacing <span class="ps-field__value">mm</span></span>
            <input type="number" id="ps-pitch" min="1" max="60" step="0.01" />
          </label>
          <p class="ps-note" id="ps-size"></p>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-calibrate', 'Calibrate') ?></h2>
          <p class="ps-note" style="margin-bottom:8px"><?= cms_block('pegsmith-ps-note-hasbro-does-not-publish', '
            Hasbro does not publish a hole spacing, so the presets start at
            <strong>6.35 mm</strong> and you replace it once with your board\'s real one.
            Measure centre-to-centre across a run of holes — the longer the run, the smaller
            your error.
          ') ?></p>
          <div class="ps-row ps-row--split">
            <label class="ps-field" style="margin:0">
              <span class="ps-field__label">Across holes</span>
              <input type="number" id="ps-cal-holes" value="21" min="2" step="1" />
            </label>
            <label class="ps-field" style="margin:0">
              <span class="ps-field__label">Measured mm</span>
              <input type="number" id="ps-cal-mm" value="127" min="1" step="0.1" />
            </label>
          </div>
          <div class="ps-row" style="margin-top:8px">
            <button class="ps-btn" type="button" id="ps-cal-apply">Set spacing</button>
          </div>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-view', 'View') ?></h2>
          <label class="ps-check"><input type="checkbox" id="ps-lit" checked /> Lit preview <span style="color:var(--ps-text-faint)">(V)</span></label>
          <label class="ps-check"><input type="checkbox" id="ps-holes" checked /> Show empty holes</label>
          <div class="ps-row" style="margin-top:10px">
            <button class="ps-btn" type="button" id="ps-invert">Invert</button>
            <button class="ps-btn" type="button" id="ps-clear">Clear board</button>
          </div>
        </div>
      </section>

      <!-- ---- IMAGE ---- -->
      <section class="ps-pane" data-pane="image">
        <div class="ps-group">
          <div class="ps-thumb" id="ps-thumb">Click or drop an image here</div>
          <input type="file" id="ps-file" accept="image/*" hidden />
          <p class="ps-note"><?= cms_block('pegsmith-ps-note-nothing-is-uploaded-the', '
            Nothing is uploaded — the image is read and converted in your browser.
          ') ?></p>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-conversion', 'Conversion') ?></h2>
          <label class="ps-field">
            <span class="ps-field__label">Fit</span>
            <select id="ps-fit">
              <option value="contain">Contain — whole image, letterboxed</option>
              <option value="cover">Cover — fill the board, crop the edges</option>
              <option value="stretch">Stretch — distort to fit</option>
            </select>
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Brightness <span class="ps-field__value" data-out="ps-bright">0</span></span>
            <input type="range" id="ps-bright" min="-100" max="100" value="0" />
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Contrast <span class="ps-field__value" data-out="ps-contrast">0</span></span>
            <input type="range" id="ps-contrast" min="-100" max="100" value="0" />
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Saturation <span class="ps-field__value" data-out="ps-sat">20</span></span>
            <input type="range" id="ps-sat" min="-100" max="100" value="20" />
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Leave dark holes empty <span class="ps-field__value" data-out="ps-cutoff">42</span></span>
            <input type="range" id="ps-cutoff" min="0" max="160" value="42" />
          </label>
          <label class="ps-check"><input type="checkbox" id="ps-dither" checked /> Dither (Floyd–Steinberg)</label>
          <p class="ps-note"><?= cms_block('pegsmith-ps-note-nine-possible-values-per', '
            Nine possible values per hole is a very short palette. Dithering trades a
            flat wrong colour for a mix that reads right from a step back — leave it on
            for photographs, turn it off for logos and flat art.
          ') ?></p>
        </div>

        <div class="ps-group">
          <div class="ps-row">
            <button class="ps-btn ps-btn--primary" type="button" id="ps-apply-img">Convert</button>
            <button class="ps-btn" type="button" id="ps-match-aspect">Match aspect</button>
          </div>
          <div class="ps-row">
            <button class="ps-btn" type="button" id="ps-clear-img">Remove image</button>
          </div>
          <p class="ps-note"><?= cms_block('pegsmith-ps-note-the-board-previews-the', '
            The board previews the conversion live. <strong>Convert</strong> commits it so
            you can edit it by hand — and that step is undoable.
          ') ?></p>
        </div>
      </section>

      <!-- ---- PRINT ---- -->
      <section class="ps-pane" data-pane="print">
        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-sheet', 'Sheet') ?></h2>
          <label class="ps-field">
            <span class="ps-field__label">Paper</span>
            <select id="ps-paper">
              <option value="letter">Letter — 8.5 × 11 in</option>
              <option value="legal">Legal — 8.5 × 14 in</option>
              <option value="a4">A4</option>
              <option value="a3">A3</option>
            </select>
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Orientation</span>
            <select id="ps-orient">
              <option value="auto">Auto</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Style</span>
            <select id="ps-style">
              <option value="color">Filled dots — white paper</option>
              <option value="ring">Rings — white paper, less ink</option>
              <option value="black">Black sheet — looks like the real thing</option>
            </select>
          </label>
          <label class="ps-field">
            <span class="ps-field__label">Margin <span class="ps-field__value">mm</span></span>
            <input type="number" id="ps-margin" value="10" min="3" max="30" step="1" />
          </label>
          <label class="ps-check"><input type="checkbox" id="ps-codes" /> Letter code in each peg</label>
          <label class="ps-check"><input type="checkbox" id="ps-keysheet" checked /> Add a build sheet (counts + sheet order)</label>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-output', 'Output') ?></h2>
          <p class="ps-note" id="ps-sheetinfo"></p>
          <div class="ps-row" style="margin-top:10px">
            <button class="ps-btn ps-btn--primary" type="button" id="ps-open-preview">Preview sheets</button>
          </div>
          <div class="ps-row">
            <button class="ps-btn" type="button" id="ps-print-now">Print now</button>
          </div>
          <p class="ps-note"><?= cms_block('pegsmith-ps-note-turn-off-fit-to', '
            <strong>Turn off “fit to page” / “shrink to fit”</strong> in the print dialog and
            set the scale to 100%. Every sheet carries a 100 mm bar — measure it once with a
            ruler before you trust the rest.
          ') ?></p>
        </div>
      </section>

      <!-- ---- FILE ---- -->
      <section class="ps-pane" data-pane="file">
        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-design', 'Design') ?></h2>
          <label class="ps-field">
            <span class="ps-field__label">Name</span>
            <input type="text" id="ps-name" placeholder="untitled" />
          </label>
          <div class="ps-row">
            <button class="ps-btn" type="button" id="ps-save-json">Save .json</button>
            <button class="ps-btn" type="button" id="ps-load-json">Open…</button>
          </div>
          <div class="ps-row">
            <button class="ps-btn" type="button" id="ps-export-png">Export PNG</button>
            <button class="ps-btn" type="button" id="ps-new">New</button>
          </div>
          <input type="file" id="ps-load-file" accept=".json,application/json,image/*" hidden />
          <p class="ps-note"><?= cms_block('pegsmith-ps-note-your-work-is-kept', '
            Your work is kept in this browser between visits. Save a
            <strong>.json</strong> to move a design to another machine, or to keep more than
            one.
          ') ?></p>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-pegs-used', 'Pegs used') ?></h2>
          <div class="ps-tally" id="ps-tally"></div>
        </div>

        <div class="ps-group">
          <h2 class="ps-group__title"><?= cms_block('pegsmith-ps-group-title-keys', 'Keys') ?></h2>
          <p class="ps-note" style="font-family:var(--pw-mono);line-height:1.9"><?= cms_block('pegsmith-ps-note-b-peg-e-erase', '
            B peg · E erase · G fill · I pick<br>
            L line · R rect · O ellipse · H pan<br>
            1–8 colour · Shift-drag erases<br>
            X / Y mirror · V lit · F fit<br>
            Ctrl+Z undo · Ctrl+P print
          ') ?></p>
        </div>
      </section>

    </div>
  </div>
</div>

<!-- The print document. Also the on-screen preview — same markup either way,
     so what is checked is what is printed. -->
<div class="ps-preview" id="ps-preview">
  <div class="ps-preview__bar">
    <h2><?= cms_block('pegsmith-h2-print-preview-check-the', 'Print preview — check the 100 mm bar') ?></h2>
    <button class="ps-btn ps-btn--primary" type="button" id="ps-preview-print">Print</button>
    <button class="ps-btn" type="button" id="ps-preview-close">Close</button>
  </div>
  <div class="ps-preview__scroll">
    <div id="ps-print"></div>
  </div>
</div>

<div class="ps-toast" id="ps-toast"></div>

<script src="assets/js/pegsmith.js" defer></script>
<?php include $_SERVER['DOCUMENT_ROOT'] . '/includes/scripts.php'; ?>
</body>
</html>
