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

## High-level summary (~185 words)
> In 1971, Apollo 14's crew walked toward Cone Crater, came within about 20 metres of the rim and turned back: every ridge looked like the last one. On Mars it is harder. There is no GPS, and dust hides the hills astronauts steer by.
> Sightline is a navigation and safety map for walking in Jezero Crater without GPS. It does three things we have not found together anywhere else:
> 1. **It shows where you lose sight of home.** Red zones, computed from NASA's Jezero elevation model, mark ground where no landmark is visible, and they grow live as dust rises.
> 2. **It fixes your position from the hills.** With no GPS the suit's step-count position drifts. Horizon Match compares the outline of the hills the astronaut sees with outlines computed from NASA terrain and shrinks that drift back.
> 3. **It knows the astronaut's body.** Balance and vision changes after landing, suit time and cooling limits, and solar-storm radiation (NASA measurements) set when to turn back.
> Crews will drive rovers too, but rovers break and get stuck. Apollo had a rule for that: never drive further than you can walk back on your suit's supplies. Sightline is that walk back, on Mars, without GPS.
> Today it is a planning tool for walks at Jezero. Next, the same answer belongs inside the helmet, and the same sight-line maps can choose where to put the habitat and radio beacons so no route has blind spots.

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
