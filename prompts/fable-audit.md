Use the frugal-fable skill first and follow it strictly. Be extremely frugal: you do the judging and the final report. Cheaper subagents do the reading, clicking and searching. Never read a whole large file when grep plus a line range will do. Target: a full audit for well under the usual token cost.

## Context
- Sightline is our NASA Space Apps 2026 entry, "the Mars map with no blue dot". It shows whether an astronaut on a walk in Jezero crater can get home without GPS.
- Repo: /Users/brayden/Documents/Hackathon/sightline. Read CLAUDE.md, then ARCHITECTURE.md §1–5 only.
- Live: https://monek825.github.io/sightline/
- Local: `python3 -m http.server 8000` in the repo (or `.claude/launch.json` → "sightline").
- Stack: static ES modules, Leaflet 1.9.4, A-Frame 1.6.0. No build step, no npm, no backend, no runtime API calls.
- Deadline: Sunday 15 Nov 23:59 WIB. Feature freeze Sunday 16:00. So this is an audit plus small safe fixes, not new features.

## Task
Audit the whole site and report everything that is buggy, laggy, confusing or wrong. Also find issues nobody has spotted yet.

### 1. Walk every flow at 1440×900 and 375×812
- Loading screen.
- Welcome card.
- Play the 100-second story to the end.
- Reset and scrub.
- View dropdown: 2D, 3D, Helmet, and the 3D graphics setting.
- Eye menu: toggle each item, in 2D and in 3D.
- Status card hide and show.
- Tabs: Home, Dust, Position.
- Details sheet and its event buttons: dust, clear, solar, lost; random run, calm day, the story.
- Horizon Match.
- "Can't see the hills (dust)".
- Helmet view: open and close, drag, zoom, graphics levels, Show list.
- Sources dialog.

### 2. Bugs
- Console errors.
- Overlapping UI.
- Things that never finish or never hide.
- State that doesn't reset after Reset.
- Stale text.
- Labels that don't match what is drawn.
- Keyboard focus and Escape.
- Reduced motion.

### 3. Lag
- Measure fps in 3D and in the helmet, idle and during the story. Use the `?fps=1` helmet param or rAF counting.
- Long tasks.
- Memory or GPU pressure. Watch for a WebGL context loss after reopening the helmet.
- Work that keeps running while hidden.

The team lead reports the helmet at 2–4 fps in Chrome on an M1. We get 60 fps, so look for what could explain that.

### 4. UX
- Would a first-time judge understand within 30 s what they are looking at and what the colours mean?
- Flag jargon, unclear buttons, dead ends, and anything that looks AI-generated or template-like.
- House rules:
  - No small eyebrow text above headings.
  - No "01 ·" numbering.
  - No ↗ arrows.
  - No fades or seams.
  - Nothing sticky unless asked.

### 5. Under the radar
- Every number shown should come from `data/crew_constants.json` with a source.
- Spot-check the 5 most important claims against primary sources, with cheap web searches by a subagent:
  - Jezero dust τ and storm levels.
  - The NASA solar-storm radiation limit. Our two teammates disagree: 250 mSv per event vs 250 mGy-Eq per 30 days for blood-forming organs. Find which NASA-STD-3001 revision is current and what it says.
  - Visibility vs τ.
  - Suited walking speed.
  - Horizon Match accuracy claims.
- Check the hackathon rules risks:
  - No NASA logos or branding.
  - Every AI-generated image marked "AI-generated".
  - AI use declared.
  - Citations present.

## Rules
- Report first. Then fix only items that are small, safe and clearly bugs, each verified with a screenshot after the fix.
- Ask before anything bigger or anything in skyline/: Jayden owns Horizon Match.
- Never touch data contracts or the function signatures in ARCHITECTURE.md §5.
- Insert text with textContent, never innerHTML. No API keys. No runtime API calls.
- Commits end with: Co-Authored-By line for your model. Commit on a branch `fix/audit` and open a PR. Don't push to main.

## Output
1. **`docs/audit.md`.** One table: `# | area | severity (blocker/high/med/low) | what happens | where (file:line) | fix | fixed? (proof)`. Then a short "science check" section with the sources you used.
2. **A chat summary of at most 10 lines.** Top 5 problems, what you fixed, what needs a decision from the team.
