<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Alternative UI skins

Each folder here is a different look for the same Sightline app. A skin has its own `index.html` and
`styles.css`; it reuses the main app's JavaScript, data and assets. The original root `index.html` and
`styles.css` are not touched.

## Skins
- `cream/` — warm cream editorial style: opaque white cards with hairlines, no shadows or glass, Inter + JetBrains Mono,
  one orange primary button ("Play demo"). `cream/DESIGN.md` is a style reference only.

## Open a skin
From the repo root run `python -m http.server 8000`, then open `http://localhost:8000/alt-ui/cream/`.

## How a skin is wired
- The skin's `index.html` is a copy of the root one with `<base href="../../">` as the first element after the charset meta,
  so `map/app.js`, `data/` fetches, images and `helmet/index.html` resolve from the repo root.
- Its stylesheet link points at `alt-ui/<skin>/styles.css`. Hash-only links (`#...`) would need `alt-ui/<skin>/index.html#...` because of the base tag (none exist today).
- Element ids, classes, `data-*`, `aria-*` and `hidden` must stay as in the root page; the shared JS finds elements by them.

## Keep a skin in sync (when root `index.html` or `styles.css` changes)
A skin's `index.html` is a copy, not a link, and the shared JS finds elements by the root page's ids, so it must be re-copied whenever the root `index.html` changes.
1. Copy root `index.html` over `alt-ui/<skin>/index.html`, then re-apply the four head edits: `<base href="../../">` after the charset meta; stylesheet link to `alt-ui/<skin>/styles.css`; the skin's font link; ` (alt UI)` appended to the title (keep the AI-assistance comment).
2. Rewrite any hash-only `href="#..."` as `alt-ui/<skin>/index.html#...`; change nothing else in the body.
3. Port every new or changed selector from root `styles.css` into the skin's `styles.css`, restyled in the skin's language.
4. Check: compare the sets of `id="..."` / class tokens of the two `index.html` files, that their `<body>` is byte-identical, and that each id/class selector and `@media` in root `styles.css` appears in the skin CSS (the local script `.frugal-fable/altui/check.js`, run `node .frugal-fable/altui/check.js` from the repo root, does this and also lints the skin for glass, shadows and stray colours).

## Add another skin
1. Copy `cream/index.html` to `alt-ui/<name>/index.html` and keep the `<base>` tag; change the stylesheet path.
2. Write `alt-ui/<name>/styles.css`; keep every state and layout selector from the root `styles.css` (`[hidden]`, `.GREEN/.AMBER/.RED`, `data-status`, drawer/tab states, responsive rules).
3. Change only colours, type, radius and spacing; no JS copies.

## Approved deviation
`DESIGN.md` has no warning colour, so AMBER reuses its gold (`#c08532`); GREEN is `#1f8a65` and RED `#cf2d56`.
