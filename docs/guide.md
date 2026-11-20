# Pegsmith

Design peg-light art on a grid, or convert a photograph to peg colours, then
print a template at **true physical scale** so the holes on paper land on the
holes in the board.

Vanilla JS. No build step, no dependencies, no server component — the whole
tool runs in the browser and nothing you load is uploaded anywhere.

```
index.php               the page (page chrome via small PHP includes)
assets/css/pegsmith.css
assets/js/pegsmith.js
.htaccess               DirectoryIndex + Options -Indexes
```

## The one thing that matters

A template is only useful if it registers with the board. Browsers disagree
about what a CSS pixel is, but they agree about physical units inside SVG, so
each sheet is an `<svg width="203.2mm" …>` with a `viewBox` in the same
millimetres, and `@page { margin: 0 }` so nothing rescales it.

That still leaves the print dialog, which defaults to "fit to page" and will
quietly shrink everything by a few percent. Hence the **100 mm bar** on every
sheet: measure it once with a ruler. If it is not 100 mm, the sheet is wrong
and no amount of care with the artwork will save it.

## Hole spacing

Hasbro does not publish one. The presets ship at 6.35 mm (¼ in) as a starting
point, and the artwork sizes come from the manufacturer's stated template
dimensions:

| Preset | Artwork |
|---|---|
| Ultimate Classic | 8 × 6½ in |
| Cube | 6¾ in square |
| Mini | 3⅝ × 3½ in |

**Calibrate once and this is solved for good.** Count a run of holes on the
real board, measure centre-to-centre across that run, and enter both. The
tool divides by `n − 1` gaps, not `n` — getting that off by one is how you
end up 3% out across a full board, which is a whole hole by the far edge.

## Image conversion

Nine possible values per hole (eight colours plus "no peg") is a very short
palette, so the interesting step is not resizing — it is deciding, per hole,
which of nine states is least wrong.

- Matching uses **redmean** RGB distance rather than plain Euclidean, which
  stops blue and purple reading as far apart while green and yellow read as
  close.
- **Floyd–Steinberg** dithering is on by default. Without it every mid-tone
  snaps to one flat colour. Turn it off for logos and flat art.
- The **dark cutoff is judged on the undiffused luminance**, and a hole held
  empty by it swallows its error instead of passing it on. This is the fix
  for the single stray peg in the middle of a black background: diffused
  error is otherwise enough to lift a truly black hole over the line, and one
  lit peg in an empty field is the most visible mistake the converter can
  make.

## Tiling

A design larger than the paper is split into tiles. Tiles are **pinned to the
same top-left origin** rather than centred, and the cut marks sit on the field
outline rather than the page margin — so trimming each sheet on its dashed
rectangle and butting the edges reproduces the pitch across the join. Centre
them instead and every trimmed sheet is off by a different fraction of a hole.

Tiles do not overlap. The build sheet prints the sheet order.

## Storage

The current design is kept in `localStorage` between visits, run-length
encoded (a peg design is mostly empty, so a 60 × 48 grid is a few dozen pairs
rather than 2880 numbers). Save a `.pegsmith.json` to keep more than one or to
move a design to another machine. Every storage call is wrapped — a private
window or blocked site data costs you the autosave and nothing else.

## Page chrome

The page takes its strip and theme toggle from `public/includes/` and the
tokens it reads (`--pw-*`) from `public/assets/site/chrome.css`; the editor itself fills
the viewport below the strip. Its accent is `pw-accent-lumen`: cyan, because it is the
one bright hue **not** in the peg palette, so the chrome can never be mistaken for
the artwork.
