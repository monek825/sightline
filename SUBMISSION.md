# Submission kit

**Owners:** Brayden (video) + Sean (text). **Deadline: Sunday 15 Nov 2026, 23:59 WIB.** First "Submit for Judging" at 21:00, final by 23:00.

## Required fields on the project page
| Field | What we put |
|---|---|
| Project name | Sightline |
| High-level summary (50–200 words) | Draft below |
| Link to project demo | **ONE link only**: the 30-second YouTube video (public or unlisted) |
| Link to final project | GitHub repo + live GitHub Pages link |
| Project details | Draft below |
| NASA data | Section 8 of README.md + "Challenge resources used" from data/sources.md |
| Space agency partner data | Optional — none unless we add some |
| References | data/sources.md |
| AI use | Dropdown: code generation, research/text. Text: see below |
| Checkboxes | Both rules checkboxes |
| Team members | All 4 registered on the project page **before** submitting |

Turn the page **Lock** on while one person edits. Save often. Test every link in an incognito window.

## High-level summary (draft, ~150 words)
> Mars has no GPS. An astronaut on a spacewalk in Jezero Crater navigates by sight — and on real terrain, home is hidden behind ridges from most of the ground nearby. Sightline is a navigation and safety map that answers one question at every step: can this astronaut still get home safely?
> It combines three things. SEE: blind-zone maps computed from NASA's Jezero elevation model show where no landmark is visible, and dust storms shrink visibility live. LOCATE: a 360° "Horizon Match" matches the horizon the astronaut sees to horizons computed from NASA terrain, giving a position and uncertainty circle without GPS. CREW: a body-and-suit model built on NASA measurements — Curiosity radiation data, solar storm alerts, post-flight balance and vision changes, suit time and cooling limits, cold, dust devils — becomes one Walk Budget that tells the crew when to turn back and which route keeps home in sight.

## 30-second video script
Indonesian voice is OK **with English subtitles**. No NASA logos. No one under 18. If any AI-generated image/video is used, add a visible "SI-generated" watermark. Record with "video mode" (`v` key) in the app.

| Time | Picture | Words (EN subtitles) |
|---|---|---|
| 0:00–0:02 | Team name over the Jezero map | "We're [team name], Jakarta." |
| 0:02–0:05 | Zoom from orbit into Jezero | "Martian Map challenge. On Mars, there is no GPS." |
| 0:05–0:10 | Blind zones appear in red around home | "Sightline: can this astronaut still get home? Red = home can't be seen." |
| 0:10–0:20 | Demo player: storm banner → budget RED → dust → blind zones grow → new route → 360° Horizon Match | "Built on NASA data: Jezero terrain, Curiosity radiation, solar storm alerts, Perseverance weather. A solar storm hits. Dust rises. Sightline re-routes home and fixes position from the skyline." |
| 0:20–0:28 | Helmet view: terrain, beacon through hill, HUD | "Tomorrow, this goes inside the helmet." |
| 0:28–0:30 | Title card + URL | "Sightline." |

## Project details (draft outline)
- **What it does:** SEE / LOCATE / CREW + helmet view (README section 1).
- **How it works:** precomputed viewsheds and skylines from the 20 m CTX DTM (Python/numpy, with Mars curvature); A* route planner with slope limits and blind-zone penalties; a pure-function crew model where every constant is tagged NASA data vs estimate; Leaflet map on NASA Mars Trek tiles; A-Frame 3D helmet view.
- **Benefits:** a navigation aid that works with no GPS and no comms; makes "can I get home" visible; a planning tool for EVA designers.
- **What we hope to achieve:** test Horizon Match on real Perseverance Navcam photos; place beacons to remove blind zones; feed live MEDA/DONKI data; AR in suit helmets.
- **Honest limits:** Horizon Match tested on simulated skylines only; several crew-model constants are our estimates (marked in the app).
- **Tools:** HTML/CSS/JavaScript, Leaflet, A-Frame/three.js, Python, NumPy, Pillow, GitHub Pages, Claude, GitHub Copilot.

## AI use text
> We used Claude (Anthropic) for research synthesis, planning documents and code generation, and GitHub Copilot for code generation. All science numbers were checked against the cited NASA sources; AI-generated code is marked with a header comment in each file. No AI-generated images or video are used (if any are added, they carry a visible "SI-generated" watermark).

## Final checklist (Sunday)
- [ ] 16:00 feature freeze
- [ ] `python3 scripts/check_data.py` exits 0 (no missing files, no mocks, no unsourced "NASA data" constants)
- [ ] GitHub Pages live, loads in incognito, no console errors
- [ ] Repo **public** (judges must open it without logging in)
- [ ] Video ≤ 30 s, English subtitles, uploaded, link works in incognito
- [ ] All fields filled, 4 members registered, checkboxes ticked
- [ ] 21:00 Submit for Judging → banner confirms
- [ ] Fixes → re-submit by 23:00
