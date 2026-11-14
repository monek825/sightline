# 30-second video: "bad news" spine (after the SteelSeries Sensei/Rival Pro ad)

Rule check: ONE video link, **≤ 30 s**, English subtitles, no NASA logos, nobody under 18, AI-generated picture = visible "SI-generated" mark (this plan uses none: everything is screen recording).

Angle: a judge who thinks "navigation on Mars = just use a map" should leave believing "out there you can't see home, and Sightline is how you still get back".
Mechanism: the app hides nothing: red = no landmark in sight, the horizon you see is matched to NASA terrain to find you, the suit minutes left decide when to turn back.

Borrowed from the SteelSeries ad: open on bad news, reveal a problem the viewer can see, sting, "that's why we built…", plain mechanism, an honest twist, two-word tag. The grammar only, not their lines.

## Voiceover (paste into ElevenLabs or record yourself; flat, deadpan, unhurried)

Bad news. Mars has no GPS.

See the red? Out here, every hill you'd steer by is out of sight.

Then the dust rolls in. [pause] And the red grows.

That's why we built Sightline.

It matches the hills on your horizon to NASA's terrain map, and finds you.

It counts the minutes your suit has left. And when a solar storm hits, it tells you: turn back. Now.

Mars will still try to kill you. [pause] You'll just see it coming.

Sightline. Get home.

(~80 words: about 30 s at a calm pace. If it runs long, cut "Out here," and "on your horizon" first, never the pauses.)

## Beat sheet

Record the app in video mode (`v` key hides the player chrome), Chrome full screen, 1920×1080. Play the story at 4–6× speed and cut it to the beats below. Record the helmet LAST (closing it rebuilds the map's 3D for ~6 s).

| Time | Voiceover | Picture (screen recording) | On-screen text |
|---|---|---|---|
| 0:00–0:03 | Bad news. Mars has no GPS. | 3D view, close on the habitat, slow orbit; astronaut marker steps out. First frame already moving. | MARS HAS NO GPS |
| 0:03–0:07 | See the red? Out here, every hill you'd steer by is out of sight. | Cut to 2D map, zoomed to the walk: red blind zones around the route. | (none: the red does the talking) |
| 0:07–0:10 | Then the dust rolls in. And the red grows. | Story at ~30 min: dust ramps, red zones spread, haze over the map. Hold one beat on the pause. | τ 0.4 → 2 (from the app's own readout) |
| 0:10–0:12 | That's why we built Sightline. | Logo/brand bar close-up, or the 3D terrain pulling back to the crater. | SIGHTLINE |
| 0:12–0:17 | It matches the hills on your horizon to NASA's terrain map, and finds you. | Horizon Match: topo scan ring, candidates flicker, lock. | NASA terrain (CTX) |
| 0:17–0:23 | It counts the minutes your suit has left. And when a solar storm hits, it tells you: turn back. Now. | Status card minutes ticking down → solar-storm banner → headline flips to RETURN NOW; the route home lights up. | RETURN NOW (the app's headline) |
| 0:23–0:27 | Mars will still try to kill you. You'll just see it coming. | Helmet view: walking home, beacon through the hill, compass tape. | (none) |
| 0:27–0:30 | Sightline. Get home. | End card: logo, "Sightline", team name, monek825.github.io/sightline. Last frame can loop into the first. | Team name · Jakarta |

Music: one low, steady synth bed, no drops. SFX only where the picture changes (a soft whoosh on the 2D→3D cut, a click on the Horizon Match lock). No sound that tells the viewer to laugh at the twist.

## Alternative hooks
1. "Bad news. Your blue dot stays on Earth." Plays on the "Mars map with no blue dot" line, but needs a beat to land for non-phone people.
2. "On Mars, nobody can drop you a pin." Relatable, but softer than "bad news" and loses the SteelSeries rhythm.

## Review gate
| Check | Score | Note |
|---|---|---|
| Hook clarity | 5 | "Mars has no GPS" on screen at frame 1, sound off works |
| Alignment | 5 | spoken, text and picture all say "no GPS" |
| Mechanism | 5 | red zones, horizon match, suit minutes all shown working |
| Value | 4 | a judge learns why sight-navigation fails on Mars |
| Rhythm | 4 | short/long mix, two written pauses, a cut every 2–5 s |
| Slop | 5 | no "not X, it's Y", no hype words, no em dashes, no invented numbers |
| Truth | 5 | every claim is something the app visibly does (see below) |
| Ending | 5 | twist then a two-word tag |
| Sendability | 4 | "Mars will still try to kill you. You'll just see it coming." |

## Confirm before recording
- The story really reaches RETURN NOW after the solar storm (it does in `data/scenario_demo.json` at minute 60; check after today's merges).
- The dust readout reaches τ 2 (Jojo's change), not 6, so the on-screen text matches.
- Horizon Match lock animation plays in the story's minute-55 stop (Sean/Jayden is editing skyline/ today: record after his PR is merged).
- Team name for the end card.
- If an Indonesian voiceover is used instead, burn in the English subtitles above.
