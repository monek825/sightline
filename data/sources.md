# Sources and references (Sightline)

Hackathon rule: cite everything, including open-source code and AI tools. Sean keeps this list complete; paste it into the submission's References field.

## Challenge resources used
_Sean: copy the exact names from the challenge "Resources" tab here and say how we used each._
- TODO (Sean): not filled in. spaceappschallenge.org could not be reached on 14 Nov 2026, so the Resources tab was not read. Do not guess this list — copy it from the tab by hand.

## NASA data
- NASA Mars Trek WMTS — Jezero HiRISE 25 cm orthomosaic (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`) and CTX 6 m orthomosaic (`JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0`). https://trek.nasa.gov/mars/
  - HiRISE orthomosaic NASA/JPL-Caltech/UArizona via NASA Mars Trek: `data/hirise_home.jpg` and `data/hirise_three_forks.jpg` (3 km × 3 km around the habitat and Three Forks, fetched at zoom 16 ≈ 0.7 m/px by `scripts/make_hirise_patch.py`; one brightness gain + offset fitted to the CTX mosaic at CTX resolution, no other edits). Shown in both 3D views when zoomed in.
- Mars 2020 TRN CTX DTM, 20 m (USGS Astrogeology / NASA). https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif
- MGS MOLA MEGDR 128 px/deg topography (`megt44n000hb.img`), PDS Geosciences Node — far-field terrain for the real-photo skyline tests. https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/
- Perseverance waypoints (MMGIS). https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
- Perseverance raw images API. https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json
- DONKI Solar Energetic Particle API (NASA CCMC via api.nasa.gov). https://api.nasa.gov/
- IAU / USGS Gazetteer of Planetary Nomenclature — used to check landmark names (no match; landmarks keep auto-picked names). https://planetarynames.wr.usgs.gov/
- Perseverance MEDA, PDS Atmospheres Node. https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/
- Mars24 sunclock algorithm (NASA GISS). https://www.giss.nasa.gov/tools/mars24/help/algorithm.html

## Science papers and NASA reports
- Hassler et al. 2014, Mars' surface radiation environment measured by Curiosity RAD, Science. https://www.science.org/doi/10.1126/science.1244797
- Zeitlin et al. 2013, Measurements of energetic particle radiation in transit to Mars, Science. https://www.science.org/doi/10.1126/science.1235989
- NASA OCHMO Radiation Protection technical brief (NASA-STD-3001 Vol 1 Rev B [V1 4031], 250 mSv per design-reference solar particle event; career 600 mSv). https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf
- May 2024 solar storm at Mars (Curiosity RAD 8,100 µGy, as reported by NASA/JPL). NASA/JPL news release, June 2024. https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/
- NASA's first weather report from Jezero Crater (surface pressure). https://www.nasa.gov/feature/nasa-s-first-weather-report-from-jezero-crater-on-mars
- SwRI release, first radiation measurements on the surface of Mars (GCR dose, 180-day transit). https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars
- Apollo Lunar Surface Journal, Apollo 11 gaits (walk-back speeds). https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.gaits.html
- Bellcomm memo B70 10028, P. Benjamin, 13 Oct 1970, "Apollo 15 EVA Capability and Constraints Envelopes" (Case 320): walking 3.3 km/hr at 1200 BTU/hr, emergency walkback 3.3 km/hr at 1440 BTU/hr (20% pad), p. 1 assumptions 7–8 and p. 2. https://web.archive.org/web/2009/http://www.hq.nasa.gov/alsj/19790073512_1979073512.pdf (the nasa.gov ALSJ copy now returns 404)
- Miller et al. 2018, Functional Task and Balance Performance in Bed Rest Subjects and Astronauts, Aerosp Med Hum Perform 89(9):805 (sensorimotor recovery ~6–16 days). https://pubmed.ncbi.nlm.nih.gov/30126513/
- Ehresmann et al. 2021, Natural Radiation Shielding on Mars Measured With the MSL/RAD Instrument, JGR Planets 126(8), e2021JE006851 (4% lower dose rate beside Butte M12). https://doi.org/10.1029/2021JE006851
- Guo et al. 2026, terrain-based radiation at Mars, JGR Planets. https://elib.dlr.de/224554/
- NASA HRP — bone loss evidence. https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf
- NASA HRP IWS poster, sensorimotor predictors of post-landing performance (no recovery duration stated; superseded here by Miller et al. 2018). https://ntrs.nasa.gov/citations/20200001416
- NASA HRP — SANS evidence report. https://humanresearchroadmap.nasa.gov/evidence/reports/SANS.pdf
- NASA xPLSS requirements (NTRS 20170010189), EVA suit CO2 / heat design reference. https://ntrs.nasa.gov/api/citations/20170010189/downloads/20170010189.pdf
- NASA Mars PLSS status and plan, ICES-2026-126 (NTRS 20260003024; SWME cooling below ~7 Torr). https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf
- Moore & Marmolejo 2014, Extravehicular Activity (EVA) Hardware & Operations Overview, NTRS 20140009556 (EMU 7 h budget incl. 30 min reserve). https://ntrs.nasa.gov/api/citations/20140009556/downloads/20140009556.pdf
- EVA 23 water intrusion report summary. https://www.americaspace.com/2014/02/27/a-condition-that-was-life-threatening-nasa-releases-report-into-eva-23-water-intrusion-incident/
- Newman et al. 2022, dust devils and wind at Jezero. https://pmc.ncbi.nlm.nih.gov/articles/PMC9132482/
- Lemmon et al. 2022, dust storm at Jezero (Jan 2022 regional storm took ~3–4 sols to reach τ ≈ 2). https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/
- Lorenz et al., solar array dust accumulation. https://hal.sorbonne-universite.fr/hal-03369920v1/document
- Martian dust health risks (Univ. of Colorado, 2025). https://www.colorado.edu/today/2025/03/31/martian-dust-could-pose-health-risks-future-astronauts
- Circadian entrainment to the Mars sol. https://pmc.ncbi.nlm.nih.gov/articles/PMC1934931
- JPL global localization for Mars rovers, ICRA 2024. https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf
- Lander Vision System (Mars 2020). https://ntrs.nasa.gov/citations/20230006986
- NASA Joint AR for spacesuits. https://ntrs.nasa.gov/api/citations/20220013671/downloads/Joint_AR_AIAA_ASCEND_Manuscript.pdf

## Software and libraries
- Leaflet 1.9.4 (BSD-2-Clause). https://leafletjs.com
- A-Frame 1.6.0 (MIT) / three.js (MIT). https://aframe.io
- NumPy (BSD). https://numpy.org
- Pillow (HPND). https://python-pillow.org
- Fonts: IBM Plex Sans and IBM Plex Mono (SIL Open Font License 1.1), loaded from Google Fonts. https://fonts.google.com/specimen/IBM+Plex+Sans · https://fonts.google.com/specimen/IBM+Plex+Mono

## AI tools (also declare in the submission dropdown)
- Claude (Anthropic) — research, planning docs, code generation.
- GitHub Copilot — code generation (helmet view).
