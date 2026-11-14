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

## High-level summary (~170 words)
> Mars has no GPS. An astronaut walking in Jezero Crater finds the way home by sight, and on the real terrain the habitat is hidden behind ridges from most of the ground nearby. Dust makes it worse: when the air fills, the hills you steer by fade out.
> Sightline is the Mars map with no blue dot. It answers one question at every step: can this astronaut still get home?
> It shows where no landmark is in sight, computed from NASA's Jezero elevation model, and those red zones grow live as dust rises. When the astronaut is unsure of their position, Horizon Match compares the outline of the hills they see with outlines computed from NASA terrain and gives a position with an uncertainty circle. A crew model built on NASA measurements (Curiosity radiation, the May 2024 solar storm, post-flight balance and vision changes, suit time and cooling limits) turns all of it into one walk budget: minutes left, when to turn back, and which route keeps home in sight. A helmet view shows the same answer from the astronaut's eyes.

## 30-second video
Script, beat sheet and checks: `docs/video-script.md` ("bad news" structure, one continuous screen recording, no AI-generated pictures). Indonesian voice is OK **with English subtitles**. No NASA logos. No one under 18.

## Project details (draft outline)
- **What it does:** SEE / LOCATE / CREW + helmet view (README section 1).
- **How it works:** precomputed viewsheds and skylines from the CTX elevation model (Python/NumPy, with Mars curvature); a live in-browser horizon match on a 40 m grid; an A* route planner with slope limits and blind-zone penalties; a pure-function crew model where every constant is tagged NASA data or estimate; a Leaflet map on NASA Mars Trek tiles with HiRISE close-ups; an A-Frame 3D terrain and helmet view.
- **Benefits:** a navigation aid that works with no GPS and no comms; makes "can I get home" visible; a planning tool for EVA designers.
- **What we hope to achieve:** test Horizon Match on real Perseverance Navcam photos; place beacons to remove blind zones; feed live MEDA/DONKI data; AR in suit helmets.
- **Honest limits:** Horizon Match was tested on 5 real Perseverance panoramas (3 of them used while developing): 4 within 51–143 m, one 2.8 km off; five is too few to quote an error rate. Several crew-model constants are team estimates, and the app marks each one.
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
