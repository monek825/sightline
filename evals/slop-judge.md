# Slop judge — sightline — 2026-11-16 00:35 (round 2, after e27b0e3)
Target: http://localhost:8000/ (single-screen app, fresh browser contexts, no cache) · Industry: space / science data-vis tool for judges · Follows: none (own tokens in styles.css; Clash Display + Switzer + Geist Mono)
Verdict: PASS WITH LIMITATIONS (no hard fails; average 3.86; one surface at 3: Dialogs, Sources at 375 and Helmet HUD)

Round 1 was FAIL (3.43, four surfaces at 3). Confirmed fixed in the round-2 shots:
- the status card hugs its content, uses hairline rows and has a bigger verdict;
- the 3D camera centres the habitat on the visible map (x≈530 against a visible centre of 525);
- Details closes Horizon Match;
- the banner sits beside Horizon Match at 1440;
- the helmet says "stay inside the habitat" when AT SHELTER, and the fps readout is gone;
- the loading background is warm (#120b07);
- the welcome card is a bottom sheet at 375 with both buttons visible;
- the banner and caption no longer repeat each other at 375;
- the events headings (h3) now use Switzer.

Out of scope this round, as the coordinator asked: the Horizon Match panel's layout at 375 and its internals in skyline/.

## Hard fails
- none. Re-measured: no eyebrows, mask fades, dead links, gradients, slop phrases, emoji, stats-strip trinity, placeholder media or 375 overflowX. The reduced-motion rule is present.

## Sections (app surfaces)
| # | surface | score | strongest | weakest (px-level) | fix → source |
|---|---|---|---|---|---|
| 1 | Loading screen | 4 | The SL mark fills, with wry rotating copy, now on warm black. | A 12×12px grey stub still sits at the mark's right foot (x≈276–288, y≈447–459 at 375; x≈846–870 at 1440). It reads as a missing pixel, not as part of the fill. | Include it in `.intro-fill` or delete it from logo.svg's loading copy. |
| 2 | Welcome card | 4 | At 1440 it is unchanged and good. At 375 it is now a bottom sheet from y≈308 to 812, with both CTAs visible (y 698–790). | At 375 the sheet's frosted background lets the terrain show through behind 16px body text, a busy read on the top 120px. | Use `background: var(--frost-strong)` for `.welcome` at ≤600px. |
| 3 | Main map + chrome | 4 | The habitat is now centred in the visible map. Real Jezero terrain carries the screen. | Map labels are still cut by the status card ("Rim hig" at x=1034, y=124 on the fold). The 3D note is still a permanent 986×46px mono bar at 1440 and takes 78px (y 327–405) of the 500px map at 375. | Cull or flip labels whose box intersects `#panel`'s rect. Collapse `.v3-note` to a one-line "True scale · habitat is a concept ⓘ" (≤24px tall) with the full text in the ⓘ. |
| 4 | Walk-status card | 4 | The ~72px Clash GO with hairline label/value rows and right-aligned mono values reads like an instrument. Card height is now 410px, down from 764. | The verdict word still only spans ~100px of a 374px card, so the numbers carry equal weight. "Walk status" in 15px muted under GO is redundant once the tab tooltip says the same. | Optional: set GO / RETURN / AT SHELTER at 96px and drop the "Walk status" line. Reference for terminal-style rows: `refero/fey.md`. |
| 5 | Bottom bar | 4 | Slanted-shoulder glass bar, popping cream tab disc, state dots. Caption and banner are no longer duplicated at 375. | Event markers under the scrubber are still 5px and overlap ("○○○" at x≈210–225, y≈859 at 1440; x≈180–200, y≈666 at 375). They are too small to tell apart or tap. | Use 8px markers with a 6px minimum gap and merge co-located events. Snap reference: Kinetics #46 Filmstrip Scrubber (`demo-filmstrip`). |
| 6 | Details sheet | 4 | It no longer stacks on Horizon Match. The limiting-factors list (icon, name, mono value, hairline) is the best data block in the app. The h3s are now Switzer. | Clash Display is still used below 20px here, against the stated fix. `#verdict` is Clash 18px and `.more h2` ("Limiting factors", "Conditions") is Clash 15px (styles.css l.248/346/405/412). At DPR 1 the word spaces collapse ("Go:allfactors…", "Limitingfactors"). It reads correctly only at 2x. | At styles.css l.405, drop `.more h2` from the display-font list. Set `.verdict` in `600 18px var(--font)` (Switzer). |
| 7 | Dialogs (Sources, Helmet; Horizon Match out of scope) | **3** | Sources at 1440 is an honest cited table with NASA data / Estimate tags. The Helmet HUD (compass tape, AT SHELTER, consistent copy) is strong at 1440. | **Sources at 375:** the stacked rows still overflow. `td:nth-child(2){white-space:nowrap}` (l.292) plus `grid-template-columns:1fr auto` (l.800) pushes the value off-screen ("0.66…", "250 mGy-Eq (30-day, blood-forming…") and clips each source line at the right edge. The "NASA short-term radiation limit" row squeezes its label to a ~70px column over 4 lines. **Helmet at 375:** the factor list (y 545–650) runs under the Auto/Low/Med/High row (y 655–690), with the GREEN line half-covered. Helmet banner and "Home 0.0 km · 0°" are Clash at ~15–19px with collapsed word spaces ("Solarparticleevent:stayinsidethehabitat" at DPR 1). | In the ≤600px block add `.src-table tr{grid-template-columns:1fr}` and `.src-table td:nth-child(2){white-space:normal}`, so the value goes on its own line under the label. Helmet ≤600px: put the graphics row in normal flow above the factor list, or cap the factor list at `max-height:96px; overflow:auto`. Set the helmet banner, Graphics label and Home readout in Switzer 600. |

## Cross-cutting
| axis | score | evidence |
|---|---|---|
| typography | 4 | Real three-role pairing with mono used for data. The remaining flaw is Clash below 20px in `.verdict`, `.more h2` and the helmet HUD. |
| colour | 4 | Warm Mars field, with GO green, amber and red as meaning. The #ff5f56 banner slab is still the harshest element but now sits clear of the panels. |
| imagery | 5 | Real NASA terrain and HiRISE/CTX imagery, true-scale models, and the habitat flagged as a concept. |
| copy voice | 4 | Specific and plain. The helmet contradiction is fixed and there is no slop. |
| interaction & motion | 4 | Tab pop, magnetic accent button, logo fill, focus outline and reduced-motion rule. The scrubber markers are too small for touch. |
| radius / depth | 3 | Coherent 20/12/8/999 scale, but every surface is the same frosted slab. The hairline status rows help. |
| responsive 375 | 3→4 | Welcome, caption/banner and status card now work at 375. Sources and the helmet HUD still break as described above. |

## Page questions
1. Blind board test: not the odd one out next to Tier-A product heroes (Ramp, Resend). The terrain plus the giant GO hold the screen, and the dead-card problem is gone.
2. Template family: none from tier C or the slop fixture. The boxed 2×2 tiles that were the last template tell are replaced by hairline rows.
3. Swap test: passes. Jezero terrain, Horizon Match and the walk verdict belong only to this product.
4. One remembered decision: real Mars terrain under a huge colour-coded GO / RETURN / AT SHELTER verdict.
5. Proof honesty: good. Every number is tagged NASA data or Estimate with a citation, and the map marks positions "(approx.)". I did not open each citation link.

## Evidence
Shots: evals/slop-judge-shots/ (fold/full/sec-* from capture.py; state-01…14 app states at 1440 + 375; state-07b/c details at 375; zoom-details-head-1440@2x.png for the font check) · computed styles: `#verdict` Clash 18px, `.more h2` Clash 15px, events h3 Switzer 15px · compared against: boards/supahero-tierA.jpg, supahero-tierC-template-family.jpg, minimalgallery-sport-nonprofit-hotel-studio.jpg · DESIGN.md/kit: none (token suggestion: refero/fey.md)
Note: state-01-loading-1440 caught the exit frame (blank warm black) because the terrain loaded in about 2 s locally. The 375 capture shows the fill mid-way.
