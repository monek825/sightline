> **Status (this branch, `feat/dust-lost-graphics-science`):** this fact-check was written against the app *before* the fixes below. Applied here:
> - **Fixed:** suit cooling (key `evap_cooler_max_pressure_pa` + `water_triple_point_pa`; the sublimator can't work at Jezero).
> - **Fixed:** dust scale height 15 → 10.5 km (Lemmon 2022).
> - **Fixed:** surface dose per sol 0.67 → 0.66 (0.64 mSv/day × 1.027).
> - **Fixed:** SANS range factor 0.8 → 1.0.
> - **Fixed:** perchlorate 0.75 → 0.5% (Phoenix).
> - **Fixed:** dead reckoning (no compass on Mars).
> - **Fixed:** dust-devil wording (vortices vs dusty).
> - **Fixed:** Horizon Match claims ("typically ~100 m"), a ±100 m floor on fixes, and fixes only applied when they agree with dead reckoning.
> - **Corrected sources/notes:** May 2024 dose (NASA URL), NASA-STD-3001 Rev C, walk-back pad (Apollo Bellcomm), slopes (Artemis III < 20°), Jezero pressure range, bone loss (pre/post ARED), wind equivalent.
> - **Sensorimotor recovery:** kept at 7 days for the walking-speed ramp (functional tasks recover in ~6 days), plus `sensorimotor_full_recovery_days` = 16 (full recovery 6–16 days, Reschke 2015) for the caution message. Not changed to 14 days, which would alter the sol-12 demo's slope limit and routes; a team decision.
> - **Still labelled team estimates:** tau thresholds, cold thresholds, slopes, eye height, transit time.
# Sightline's science holds, but its cooling check is inverted

Most of the science behind Sightline is sound, and the core idea behind Horizon Match is real and published. Matching a 360° skyline against an orbital elevation model does give a position fix on Mars. The accuracy is coarse, though: JPL summarises horizon methods as **"typically on the order of 100m, at best 10m"**, and Sightline's own Perseverance test (four of five fixes within 51–143 m, one 2.77 km failure) sits right in that band. That is good enough to walk an astronaut back within sight of a habitat. It is roughly two orders of magnitude worse than the sub-metre orbital-image matching JPL now runs onboard Perseverance. Of the 39 constants in `data/crew_constants.json`, about half are correct as sourced. Most of the rest are honestly labelled team estimates. A handful are wrong in ways that matter:

- **The sublimator limit inverts a safety call.** The app shows "Cooling OK: 718 Pa vs 933 Pa limit". A sublimator cannot work above water's triple point (611.657 Pa), and Jezero is always above it.
- **The 15 km dust scale height overstates visibility.** It has no source, and in a settled global storm it predicts about 2.5× the visibility actually observed.
- **Sensorimotor recovery is about two weeks, not one.**
- **Several constants have unit, citation or wording slips.** The worst is a dose labelled per sol that is really per Earth day.

None of these is hard to fix. Correcting them turns Sightline from a plausible demo into one whose every number survives scrutiny.

## Horizon Match delivers 100-metre fixes, not rover-grade ones

The published record splits position-fixing from ground imagery into two families that differ by about a factor of 100. **Horizon and skyline methods** compare the silhouette of distant terrain with skylines rendered from a digital elevation model. JPL's review of that literature calls them "valuable for orientation estimation, but their accuracy does not match the position accuracy requirements of a typical Mars rover mission scenario" ([Nash et al., ICRA 2024](https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf)). **Near-field image registration** works differently. It projects a 360° Navcam stereo panorama overhead and matches it to a 0.25 m HiRISE orthoimage. JPL's Censible system did this with **0.36 m mean error and a 1.07 m maximum across 264 real Perseverance panoramas** ([Nash et al., ICRA 2024](https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf)). It has since run onboard: on sol 1762 (2 February 2026) it cut position uncertainty "from 8.4m to 1.5m" after a 159 m drive ([JPL, IEEE Aerospace 2026](https://www-robotics.jpl.nasa.gov/media/documents/2026_Global_Localization_Memory_Workaround_IEEE_Aero__final.pdf)).

The closest published analogue to an astronaut turning on the spot and matching peaks is JPL's theoretical study of bearing-only landmark navigation in Jezero itself. It used a 50 m/px DEM and Navcam-class pointing. It predicted geometric dilution of precision of **about 10 m in the most informative regions and over 100 m in the least**. In the river channel, where the banks hide every landmark, it found that uncertainty "effectively becomes infinite". The authors judged the method "unsuitable as a sole method of local navigation" but useful for "sporadic position estimates that are globally registered" ([Vander Hook et al. 2022](https://www-robotics.jpl.nasa.gov/media/documents/Topographical_Landmarks_for_Ground-Level_Terrain_Relative_Navigation_on_Mars.pdf)).

Earth and Moon analogues tell the same story:

- **Swiss Alps.** The best-known terrestrial skyline benchmark counts a query as a success if it lands within 1 km, and reportedly manages that for about 88% of queries over 40,000 km² of Switzerland ([Saurer et al., IJCV 2016](https://doi.pangaea.de/10.1007/s11263-015-0830-0), success rate as tabulated by [CMLocate 2023](https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/ipr2.12883)).
- **NASA Ames field tests.** Ames fused horizon matching with terrain matching and visual odometry and cut localisation error by "over 60%" against wheel odometry on a 3 km traverse. It needed a 9 m/post regional model added to the 1 m local one, or the far horizon rendered "incorrect" ([Nefian et al., ISAIRAS 2014](https://www.cse.unr.edu/~bebis/isairas14.pdf)).
- **Moon.** Lunar studies report horizon self-localisation errors of a few metres to tens of metres with well-calibrated instruments. Accuracy degrades badly when shadows are ignored ([BIT lunar horizon matching](https://pure.bit.edu.cn/en/publications/global-localization-technology-of-lunar-rover-by-horizon-line-mat/); [CMU FSR 2019](https://www.ri.cmu.edu/app/uploads/2020/05/FSR2019__Ray_Tracing_and_Use_of_Shadows_as_Features_for_Determining_Location_in_Lunar_Polar_Terrain__Camera_Ready.pdf)).

NASA Ames traced nearly all large horizon-match errors to three causes: "high contrast clouds which were mistaken for part of the horizon; a camera position with a poor view of the horizon; large nearby rocks or dirt mounds not sufficiently large to be captured in the DEM." It also found that ±5° of orientation error could send the optimiser to the wrong minimum ([Bouyssounouse et al., NTRS 20160011500](https://ntrs.nasa.gov/api/citations/20160011500/downloads/20160011500.pdf)).

Against this record, Sightline's test (CTX 20 m DTM plus MOLA, five Navcam panoramas) is unremarkable in the best sense. Its 51–143 m errors match JPL's "order of 100m". Its single km-scale failure matches the known local-minimum behaviour. Its finding that single 96° frames are unreliable matches Censible's sensitivity table, where dropping to one stereo pair pushed the 99th-percentile error from 0.93 m to **20.09 m** even for a sub-metre method ([Nash et al., ICRA 2024](https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf)). Five samples cannot set a failure rate, but they are enough to show the failure mode exists.

The app's three credibility claims check out with small wording fixes:

1. **"JPL reports ~10–100 m"** should read "typically ~100 m, at best ~10 m".
2. **Perseverance's Lander Vision System** was in error by "only a few meters relative to a 40 m requirement" ([AIAA JGCD](https://arc.aiaa.org/doi/10.2514/1.G006780)), and the rover touched down within 5 m of its target against a 60 m requirement ([NTRS 20230006986](https://ntrs.nasa.gov/citations/20230006986)). LVS, however, matched downward-looking descent images to an orthoimage. That is an analogy for Horizon Match, not evidence for it.
3. **"Global localisation is still done partly by humans"** is right: human specialists "re-localize the rover before every drive plan" ([JPL 2026](https://www-robotics.jpl.nasa.gov/media/documents/2026_Global_Localization_Memory_Workaround_IEEE_Aero__final.pdf)). What they match is panoramas to orthoimages, not skylines.

The strongest case for Horizon Match comes from Apollo, not from rovers. The lunar rover's navigation goal was only to bring the crew within visual range of the lunar module, expected to be visible to about 1 km and probably about 3 km ([McKee, NTRS 20250000720](https://ntrs.nasa.gov/api/citations/20250000720/downloads/Lunar_Surface_Nav_Survey_AAS_GNC_011825.pdf)). A 100 m fix meets that requirement with plenty of room. It is also worth comparing a fix with plain dead reckoning (my arithmetic). At the app's 3% drift, dead-reckoning uncertainty only reaches 100 m after about 3.3 km of walking. With 1–2% foot-mounted inertial navigation, it takes 5–10 km. A Horizon Match fix therefore helps mainly on long traverses. The 2.77 km outlier also shows the risk: accepted blindly, one bad fix is worse than no fix. Sightline should reject fixes that fall far outside the current dead-reckoning circle, and it should never let a fix shrink uncertainty below about 100 m.

Two navigation constants sit alongside this. **The 3% dead-reckoning drift** is a defensible planning number:

- Apollo's rover requirement was ±2% of distance travelled ([McKee, NTRS 20250000720](https://ntrs.nasa.gov/api/citations/20250000720/downloads/Lunar_Surface_Nav_Survey_AAS_GNC_011825.pdf)).
- Foot-mounted inertial units with zero-velocity updates (ZUPT) get about 1–2% ([PMC6679558](https://pmc.ncbi.nlm.nih.gov/articles/PMC6679558)).
- Low-cost shoe sensors get 7–12% ([PMC9027260](https://pmc.ncbi.nlm.nih.gov/articles/PMC9027260/)).

The stated mechanism, "step counting + compass", is wrong for Mars, which has only patchy crustal magnetisation and no global field ([Acuña et al. 1999](https://doi.org/10.1126/science.284.5415.790)). Heading must come from a gyro realigned to the Sun or stars, as on the Apollo rover and every Mars rover ([McKee, NTRS 20250000720](https://ntrs.nasa.gov/api/citations/20250000720/downloads/Lunar_Surface_Nav_Survey_AAS_GNC_011825.pdf)). **The 1.7 m eye height** has no source but is plausible. It puts the geometric horizon on flat Martian ground at about 3.4 km (√(2Rh), R = 3389.5 km; my calculation). So on a crater floor, the skyline Horizon Match uses is distant raised terrain such as the crater rim, not the true horizon.

## Dust erases the far skyline, and a 15 km scale height overstates visibility

Sightline converts column dust optical depth into horizontal visibility with a Koschmieder relation, V = 3.912 / (τ/H). The form is sound. For an exponential dust profile, the near-surface extinction coefficient is τ/H. A 2% contrast threshold gives V = 3.912/β, and Mars teams use the same line-of-sight extinction concept ([Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)). The problem is **H = 15 km**, which no source supports. For well-mixed dust, H equals the gas scale height (RT/Mg ≈ 10.8 km at 210 K; my calculation). Lemmon et al. normalise Jezero line-of-sight opacity "per 10.5 km" for exactly this reason ([Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)). Using 15 km inflates every visibility estimate by about 43%.

The two published Martian visibility measurements show how much the effective scale height varies:

- **Jezero, January 2022 regional storm.** Line-of-sight opacity peaked at **1.3 per 10.5 km**, and a hill 36 km away was "only faintly visible". That is a Koschmieder range of about 32 km at column τ of about 1.7–2 ([Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)).
- **Gale crater, 2018 global storm.** Column τ reached 8.5, and Curiosity's team reported horizontal visibility falling to **2.7 km**. That happened nine sols *after* the τ peak, as dust settled into the crater ([Guzewich et al. 2019](https://ntrs.nasa.gov/api/citations/20190001691/downloads/20190001691.pdf)).

Read backwards, Jezero implies an effective H of about 15–20 km, because the dust was aloft. Gale implies about 6 km, because the dust was settled. The app's 15 km happens to fit the Jezero event. It is 2.5× too optimistic for the Gale event, which is the dangerous direction for a navigation aid.

| Column τ | App (H = 15 km) | Well-mixed (H = 10.5 km) | Measured analogue |
|---|---|---|---|
| 0.4 (typical) | 147 km | 103 km | — |
| 1.0 (amber) | 59 km | 41 km | Jezero after sol 316: ~41 km |
| 2.0 (Jan 2022 storm) | 29 km | 20.5 km | Jezero sols 313–315: ~32 km |
| 3.0 (red) | 20 km | 13.7 km | — |
| 8.5 (2018 global storm) | 6.9 km | 4.8 km | Gale sol 2094: 2.7 km |

Visibilities are computed with V = 3.912·H/τ. Measured values are from [Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/) and [Guzewich et al. 2019](https://ntrs.nasa.gov/api/citations/20190001691/downloads/20190001691.pdf).

The model also assumes a black target (inherent contrast 1). Martian hills, flags and suits have lower contrast and will vanish sooner. The Jezero hill at line-of-sight τ of about 4.5 suggests 3.912 is about right for large terrain, but not for small markers.

Haze matters for Horizon Match beyond the visibility number. Ames notes that with an atmosphere "the horizon line can be fuzzy and affected by haze or dust" ([Bouyssounouse et al.](https://ntrs.nasa.gov/api/citations/20160011500/downloads/20160011500.pdf)). The far rim is the part of the skyline a 20 m CTX DTM models best, and it is the first to fade. No study quantifies skyline error against τ, so Sightline should treat high τ as a reason to distrust a fix, not just to shorten the visibility circle.

The dust constants themselves are mostly right:

- **τ_typical = 0.4** is a fair value. But Lemmon et al. give about 0.3 before and about 0.4 after the 2022 storm, not a "0.3–0.5 outside storms" climatology ([Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)).
- **τ = 2.0 for the January 2022 storm** is correct. The paper says "Peak visible optical depth was ∼2", with 1.7 retrieved on sols 313–315. Both wind-sensor booms "stopped reporting due to damage from blown debris" ([Lemmon et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)).
- **The amber (τ 1.0) and red (τ 3.0) thresholds have no official basis.** NASA's dust workshop says only that storm opacity "may be large enough to reduce EVA times" and that short-term local forecasting "appears to be non-existent" ([NESC, NTRS 20180006321](https://ntrs.nasa.gov/api/citations/20180006321/downloads/20180006321.pdf)). They are reasonable team heuristics, and the app labels them that way.
- **The rate of τ rise is a better warning sign than any fixed level.** Gale went from τ 1.56 to 8.5 in five sols, then took about 43 sols (e-folding time) to clear ([Guzewich et al. 2019](https://ntrs.nasa.gov/api/citations/20190001691/downloads/20190001691.pdf)).

## Dust devils, wind and the Jezero environment check out with wording fixes

The Newman et al. dust-devil figures are accurate apart from one word:

- Peak vortex activity at **12:00–13:00 LTST**, peak vortex wind **32 m/s**, largest imaged dust devil **270 m**, and peak pressure drop **about 6.5 Pa** (sol 168) are all in the paper ([Newman et al. 2022](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9132482/fullTextXML)).
- The ">4 per sol" figure counts *convective vortices* detected as pressure drops above 0.5 Pa, "over 25% of which were significantly dusty". It does not count visible dust devils ([Newman et al. 2022](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9132482/fullTextXML)).
- Typical dust devils are much smaller than 270 m: mean diameter about 29 m ([Hueso et al. 2023, abstract](https://digital.inta.es:8443/jspui/handle/20.500.12666/883?mode=full)).
- The 11–14 LTST warning window is a team choice that brackets the published peak.
- The 5 m/s drift speed matches measurements: about 5 m/s for a dust devil that passed over the rover ([Murdoch et al. 2022](https://www.nature.com/articles/s41467-022-35100-z)) and about 19 km/h for one tracked in 2023 ([JPL](https://www.jpl.nasa.gov/news/nasas-perseverance-captures-dust-filled-martian-whirlwind/)).

The Earth-equivalent wind needs a small fix. At the app's own Jezero conditions (718 Pa, −55 °C), CO₂ air has a density of about 0.0172 kg/m³. That is **about 1/70 of Earth sea level**, not 1/80, so a 32 m/s gust pushes like **3.8 m/s** on Earth (my ideal-gas calculation using the [NSSDC Mars fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) molecular mass). The app's 3.6 m/s holds only for warmer midday air. The message, that a Martian gale feels like a light breeze, stands either way.

Jezero pressure and temperature are well chosen. MEDA daily-mean pressure ranged from **625 Pa to 761 Pa** over the first 460 sols ([Sánchez-Lavega et al. 2023](https://arxiv.org/pdf/2401.12931.pdf)). So 718 Pa is typical, and the spread is −13%/+6% rather than ±10%. Mean air temperature is about −55 °C with a 50–60 °C day-night swing ([UPV/EHU via Phys.org](https://phys.org/news/2023-01-rich-meteorology-mars-perseverance-rover.html)). Air ranges from −83 °C to −23 °C ([NASA MEDA blog](https://science.nasa.gov/blogs/daily-records-of-atmospheric-temperature-with-perseverance/)). The −70 °C cold-amber threshold and the 16:30 LTST return time are unsourced team choices. Both are physically sensible: the near-surface atmosphere turns isothermal and starts cooling around 17:00 LTST ([Munguira et al. 2023 record](https://eld.bl.uk/catalog/100183927930_0x000001)). Sol length (39.6 min drift, 61.65 min Mars hour) is exact to rounding against NASA's Mars24 constant of 1.0274912517 Earth days per sol ([NASA GISS Mars24](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)).

## The suit cooling check is backwards, but the EVA budget holds

**`sublimator_max_pressure_pa = 933` is the most consequential error in the file.** A sublimator freezes feedwater in a porous plate and sublimes the ice to the outside. That only works below water's triple point, **611.657 Pa (4.59 Torr)** ([IAPWS](https://www.iapws.org/relguide/MeltSub.html)). NASA says plainly that ISS sublimators "cannot be used on the surface of Mars where the atmospheric pressure is greater than the triple point of water", and that this is why it developed the Spacesuit Water Membrane Evaporator. The "5-7 torr" figure in NASA's papers is the Mars back-pressure at which that membrane evaporator was *tested* ([ICES-2024-463, NTRS 20240005670](https://ntrs.nasa.gov/api/citations/20240005670/downloads/ICES-2024-463_SWME_FINALv2.pdf)). It is not a sublimator limit. NASA's 2026 Mars suit study adds that Mars pressure "precludes use of venting technologies (SWME and RCA) without modification", and its candidate designs pair the evaporator with a vacuum pump ([NTRS 20260005204](https://ntrs.nasa.gov/api/citations/20260005204/downloads/ICES_Mars_PLSS_Presentation_2026_1.pdf)). The app's cited source (NTRS 20260003024) could not be retrieved, and no NASA document found says a sublimator works up to 7–8 Torr.

In code (`crew/budget.js`), the app computes `933 − 718` and prints "Cooling OK", which reverses the physics. The honest version: Jezero's 625–761 Pa is always above 611.657 Pa, so a sublimator never works there. A Mars suit needs a membrane evaporator with a pump, and the warning should be about that hardware, not a pressure margin.

The rest of the suit and EVA budget is well sourced:

- **8 h EVA design duration plus about 2 h pre/post** matches NASA's xPLSS requirement for "up to 8 hours continuous" in "vacuum (micro-g), lunar, and Mars environments" ([NTRS 20170010189](https://ntrs.nasa.gov/api/citations/20170010189/downloads/20170010189.pdf)).
- **The 30-min reserve** is exactly the EMU breakdown of 15 min egress + 6 h work + 15 min ingress + 30 min reserve ([NTRS 20140009556](https://ntrs.nasa.gov/api/citations/20140009556/downloads/20140009556.pdf)). That breakdown is for a 7 h EMU EVA, so applying it to an 8 h Mars EVA is an extrapolation.
- **1024 Btu/h average metabolic rate** is in the cited document. That document's own table also lists "1230 Btu/hr (300 W)", an internal inconsistency. NASA's 2026 Mars study uses a higher 350 W (1194 Btu/h) ([NTRS 20260005204](https://ntrs.nasa.gov/api/citations/20260005204/downloads/ICES_Mars_PLSS_Presentation_2026_1.pdf)).
- **The 3.3 km/h walk-back speed** is a genuine Apollo 15 planning value: 1200 Btu/h at 3.3 km/h, padded 20% to 1440 Btu/h ([Bellcomm memo, ALSJ](https://www.nasa.gov/wp-content/uploads/static/history/alsj/19790073512_1979073512.pdf); text seen via search index only). Apollo also planned 2.7 km/h for walkbacks longer than an hour, and crews actually walked at only **1.1–2.2 km/h** ([ALSJ](https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.gaits.html)).
- **The 1.2× walk-back pad** is supported by Apollo practice: "A 20% pad is required for emergency walkback" ([Bellcomm memo](https://www.nasa.gov/wp-content/uploads/static/history/alsj/19790073512_1979073512.pdf)). The app's own note wrongly says no source exists. Apollo padded the metabolic rate, but at a constant rate that equals padding walk-home time.
- **The 15° slope limit** is conservative next to NASA's Artemis EVA planning limit of under 20° ([NTRS 20240009596](https://ntrs.nasa.gov/api/citations/20240009596/downloads/ArtemisHLSUpdate_2024.pdf)). The 10° early-mission limit is a team choice. Both are reasonable for Mars gravity, which makes climbing harder than on the Moon.

## Radiation numbers are right, but per-day and per-sol units are mixed up

The radiation set is mostly correct, with unit care needed:

- **Surface dose.** Hassler et al. measured **0.210 mGy/day absorbed** and **0.64 ± 0.12 mSv/day dose equivalent** at Gale ([Science](https://www.science.org/doi/10.1126/science.1244797); figure caption in [SWSC](https://www.swsc-journal.org/articles/swsc/full_html/2016/01/swsc150074/F11.html)). The app's 0.67 is SwRI's press-release figure, which is also *per day* ([SwRI](https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars)). Labelling it "per sol" is a 2–4% slip; the paper value converts to **0.66 mSv/sol**. The measurement dates from solar maximum.
- **Gale vs Jezero.** The app's note calls Gale (−4.4 km) and Jezero (−2.6 km) a "similar elevation band". Measured dose-pressure slopes imply Jezero's thinner air column raises dose by a few to about 10% ([Guo et al. 2017](https://arxiv.org/abs/1712.06987); my extrapolation). That is within Gale's own ±19% uncertainty, but it should be flagged.
- **Cruise dose and NASA limits.** Cruise dose of **1.84 mSv/day** is correct ([Zeitlin et al. 2013](https://www.science.org/doi/10.1126/science.1235989)). The **600 mSv career effective-dose limit** is correct and now sits in NASA-STD-3001 Rev C ([V1 4030](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf)).
- **The 250 mGy-Eq blood-forming-organ 30-day limit** is correct in value, units and organ ([Rev C Table 4.8-1](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf)). mGy-Eq is RBE-weighted absorbed dose, though, and must not be summed with mSv.
- **The May 2024 event.** **8,100 µGy** is correct and is an absorbed dose, "equivalent to 30 chest X-rays" ([NASA](https://www.nasa.gov/solar-system/planets/mars/nasa-watches-mars-light-up-during-epic-solar-storm)). That NASA page should replace the phys.org copy.
- **Terrain shielding.** The **4%** dose-rate reduction beside Butte M-12 (19% of sky blocked) matches the paper ([Ehresmann et al. 2021](https://doi.org/10.1029/2021JE006851)).
- **Transit time.** The 180-day transit is a conventional scenario assumption, consistent with SwRI's 0.66 Sv round-trip estimate.
- **Suit shielding.** A suit adds essentially nothing against galactic cosmic rays. NASA's protection for solar storms during EVAs is real-time alerting and getting into shielding within about 2 hours ([OCHMO TB-020](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf)), which is the logic Sightline's "return to shelter" message should follow.

## Crew recovery takes two weeks, not one

**`sensorimotor_recovery_days = 7` is wrong.** NASA and Russian field-test data on Soyuz crews show "significant improvement in crew performance was observed within 24 hours, but full recovery appears to require 6 to 16 days" ([Reschke et al., NTRS 20150022287](https://ntrs.nasa.gov/api/citations/20150022287/downloads/20150022287.pdf)). Obstacle-course recovery averaged about 15 days ([Mulavara et al. 2010](https://link.springer.com/doi/10.1007/s00221-010-2171-0), as restated in a [2021 review](https://www.frontiersin.org/articles/10.3389/fncir.2021.723504/pdf)). Four of 18 crew could not complete the landing-day test battery because of motion sickness ([Rosenberg et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9515505/)). The cited NTRS 20200001416 is a study-design abstract that gives no recovery duration. The 0.6 landing-day speed factor is plausible but unmeasured. A linear seven-day ramp contradicts the front-loaded recovery the data show: a big jump in the first day, then a slow tail to about day 14.

The other physiology constants:

- **Bone loss.** **1.25%/month** is right for pre-2009 crews: 1–1.5% per month at weight-bearing sites ([Sibonga et al., NTRS 20170004597](https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf)). The same report shows **0.3–0.5%/month** with ISS's ARED exercise device, the realistic case for a modern Mars crew.
- **SANS diopter shift.** The **+0.5 to +1.75 D** range is correct but comes from a seven-astronaut cohort ([Mader et al. 2011](https://pubmed.ncbi.nlm.nih.gov/21849212/)), which is the paper to cite.
- **SANS range factor.** The 0.8 factor has no support. The documented symptom of SANS is *reduced near vision*, so a 20% cut in distant-landmark range has no basis, especially with corrective eyewear.
- **Perchlorate.** The 0.75% figure mixes two sites. Phoenix measured **0.4 to 0.6%** perchlorate by mass ([Hecht et al. 2009](https://doi.org/10.1126/science.1172466)). Curiosity's samples at Gale spanned **0.05–1.05 wt%** ([Sutter et al. 2017](https://authors.library.caltech.edu/81049)). Use 0.5% with the primary citations instead of a university news story.

## Summary table of every claim

Verdict key: **Correct** means the value matches the source (minor citation or wording fixes may still apply). **Wrong** means the value or its physics is wrong. **Unsupported** means no published source sets the value; it may still be a reasonable team estimate.

| # | Claim / constant | App value | Verdict | Correct value | Primary source |
|---|---|---|---|---|---|
| A1 | Horizon-match accuracy | "~10–100 m" | Correct (reword) | Typically ~100 m, at best ~10 m | [Nash et al. 2024](https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf) |
| A2 | Perseverance LVS | Req. <40 m, achieved few m | Correct | Few m vs 40 m req.; touchdown within 5 m (60 m req.); orthoimage, not horizon | [AIAA JGCD](https://arc.aiaa.org/doi/10.2514/1.G006780) |
| A3 | Rover global localisation partly human | Yes | Correct | Yes; onboard demos Feb 2026 | [JPL 2026](https://www-robotics.jpl.nasa.gov/media/documents/2026_Global_Localization_Memory_Workaround_IEEE_Aero__final.pdf) |
| A4 | Team test (4/5 at 51–143 m, 1 at 2.77 km; 96° unreliable) | — | Correct (consistent) | Consistent with JPL ~100 m and Jezero GDOP 10–>100 m | [Vander Hook 2022](https://www-robotics.jpl.nasa.gov/media/documents/Topographical_Landmarks_for_Ground-Level_Terrain_Relative_Navigation_on_Mars.pdf) |
| 1 | surface_dose_msv_per_sol | 0.67 mSv/sol | Wrong (unit) | 0.64 mSv/day ≈ 0.66 mSv/sol; 0.21 mGy/day | [Hassler 2014](https://www.science.org/doi/10.1126/science.1244797) |
| 2 | cruise_dose_msv_per_day | 1.84 | Correct | 1.84 mSv/day (dose equivalent) | [Zeitlin 2013](https://www.science.org/doi/10.1126/science.1235989) |
| 3 | transit_days | 180 | Unsupported (OK as scenario) | Scenario assumption | [SwRI](https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars) |
| 4 | career_limit_msv | 600 | Correct | 600 mSv effective dose [V1 4030] | [NASA-STD-3001 Rev C](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) |
| 5 | short_term_limit_mgyeq | 250 | Correct | 250 mGy-Eq 30-day BFO (non-cancer table; do not mix with mSv) | [NASA-STD-3001 Rev C](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) |
| 6 | may2024_sep_dose_ugy | 8,100 | Correct (fix URL) | 8,100 µGy absorbed | [NASA](https://www.nasa.gov/solar-system/planets/mars/nasa-watches-mars-light-up-during-epic-solar-storm) |
| 7 | terrain_shielding_pct | 4 | Correct | 4% (19% sky blocked) | [Ehresmann 2021](https://doi.org/10.1029/2021JE006851) |
| 8 | sensorimotor_recovery_days | 7 | Wrong | ~14 (range 6–16) | [Reschke 2015](https://ntrs.nasa.gov/api/citations/20150022287/downloads/20150022287.pdf) |
| 9 | arrival_speed_factor_sol0 | 0.6, linear to day 7 | Unsupported | 0.6 plausible; front-loaded ramp to ~day 14 | [Reschke 2015](https://ntrs.nasa.gov/api/citations/20150022287/downloads/20150022287.pdf) |
| 10 | bone_loss_pct_per_month | 1.25 | Correct (pre-2009) | 1–1.5 (no ARED); 0.3–0.5 with ARED | [NTRS 20170004597](https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf) |
| 11 | sans_diopter_shift | +0.5 to +1.75 D | Correct | Same (n = 7 cohort) | [Mader 2011](https://pubmed.ncbi.nlm.nih.gov/21849212/) |
| 12 | sans_range_factor | 0.8 | Unsupported | 1.0 (affects near vision) | [Mader 2011](https://pubmed.ncbi.nlm.nih.gov/21849212/) |
| 13 | eva_design_hours | 8 (+2) | Correct | 8 h + 2 h (TBR) | [NTRS 20170010189](https://ntrs.nasa.gov/api/citations/20170010189/downloads/20170010189.pdf) |
| 14 | eva_reserve_min | 30 | Correct | 30 min (of 7 h EMU EVA) | [NTRS 20140009556](https://ntrs.nasa.gov/api/citations/20140009556/downloads/20140009556.pdf) |
| 15 | metabolic_avg_btuh | 1024 | Correct | 1024 Btu/h (Mars study: 1194) | [NTRS 20170010189](https://ntrs.nasa.gov/api/citations/20170010189/downloads/20170010189.pdf) |
| 16 | walk_speed_kmh | 3.3 (URL TODO) | Correct (add source) | 3.3 Apollo plan; 2.7 for >1 h; 1.1–2.2 measured | [Bellcomm/ALSJ](https://www.nasa.gov/wp-content/uploads/static/history/alsj/19790073512_1979073512.pdf) |
| 17 | walkback_pad | 1.2× | Correct (app note wrong) | Apollo 20% walkback pad | [Bellcomm/ALSJ](https://www.nasa.gov/wp-content/uploads/static/history/alsj/19790073512_1979073512.pdf) |
| 18 | max_slope_early_deg | 10° | Unsupported | Team choice; Artemis landing <10° | [NTRS 20240009596](https://ntrs.nasa.gov/api/citations/20240009596/downloads/ArtemisHLSUpdate_2024.pdf) |
| 19 | max_slope_deg | 15° | Unsupported (conservative) | NASA Artemis EVA limit <20° | [NTRS 20240009596](https://ntrs.nasa.gov/api/citations/20240009596/downloads/ArtemisHLSUpdate_2024.pdf) |
| 20 | sublimator_max_pressure_pa | 933 Pa | **Wrong** | 611.657 Pa; never works at Jezero | [NTRS 20240005670](https://ntrs.nasa.gov/api/citations/20240005670/downloads/ICES-2024-463_SWME_FINALv2.pdf) |
| 21 | jezero_pressure_pa | 718, ±10% | Correct (range off) | 718 typical; 625–761 Pa (−13/+6%) | [Sánchez-Lavega 2023](https://arxiv.org/pdf/2401.12931.pdf) |
| 22 | jezero_mean_temp_c | −55 °C; 50–60 °C swing | Correct | Same; air −83 to −23 °C | [NASA MEDA blog](https://science.nasa.gov/blogs/daily-records-of-atmospheric-temperature-with-perseverance/) |
| 23 | cold_amber_c | −70 °C | Unsupported (plausible) | Team threshold | [NASA MEDA blog](https://science.nasa.gov/blogs/daily-records-of-atmospheric-temperature-with-perseverance/) |
| 24 | cold_return_ltst | 16.5 h | Unsupported (plausible) | Team threshold; cooling ~17:00 | [Munguira 2023](https://eld.bl.uk/catalog/100183927930_0x000001) |
| 25 | dust_devil_peak_start_ltst | 11 h | Unsupported (sound window) | Peak 12–13 LTST; ">4 dust devils" → ">4 vortices, ~25% dusty" | [Newman 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9132482/) |
| 26 | dust_devil_peak_end_ltst | 14 h | Unsupported (sound window) | As above | [Newman 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9132482/) |
| 27 | dust_devil_max_wind_ms | 32 (270 m, 6.5 Pa) | Correct | Same (maxima; typical diameter ~29 m) | [Newman 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9132482/) |
| 28 | mars_wind_earth_equiv_ms | 3.6 (ρ ≈ 1/80) | Correct (approx.) | 3.8 m/s, ρ ≈ 1/70 at 718 Pa, −55 °C | [NSSDC](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) (calc.) |
| 29 | tau_typical | 0.4 ("0.3–0.5") | Correct (fix note) | ~0.3 pre-storm, ~0.4 post-storm | [Lemmon 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/) |
| 30 | tau_jan2022_storm | 2.0 | Correct | ~2 (1.7 retrieved); 5–11 Jan 2022 | [Lemmon 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/) |
| 31 | tau_amber | 1.0 | Unsupported | No NASA threshold exists | [NESC 2018](https://ntrs.nasa.gov/api/citations/20180006321/downloads/20180006321.pdf) |
| 32 | tau_red | 3.0 | Unsupported | No NASA threshold exists | [NESC 2018](https://ntrs.nasa.gov/api/citations/20180006321/downloads/20180006321.pdf) |
| 33 | vis_dust_scale_height_km (Koschmieder) | 15 km | Wrong | ~10.5 km (well mixed); 6–20 km effective | [Lemmon 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/), [Guzewich 2019](https://ntrs.nasa.gov/api/citations/20190001691/downloads/20190001691.pdf) |
| 34 | perchlorate_pct | 0.75 ("0.5–1%") | Wrong (imprecise) | 0.4–0.6 wt% (Phoenix); 0.05–1.05 (Gale) | [Hecht 2009](https://doi.org/10.1126/science.1172466) |
| 35 | sol_drift_min | 39.6 | Correct | 39.587 | [Mars24](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) |
| 36 | mars_hour_min | 61.65 | Correct | 61.649 | [Mars24](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) |
| 37 | eye_height_m | 1.7 | Unsupported (plausible) | 1.6–1.75; horizon ≈3.4 km | No source found |
| 38 | dead_reckoning_drift_pct | 3% (step + compass) | Unsupported value; mechanism wrong | 1–2% ZUPT IMU; heading from Sun-aligned gyro | [NTRS 20250000720](https://ntrs.nasa.gov/api/citations/20250000720/downloads/Lunar_Surface_Nav_Survey_AAS_GNC_011825.pdf) |
| 39 | dust_devil_drift_ms | 5 | Correct (measured analogues) | ~5 m/s; tracks ambient wind | [Murdoch 2022](https://www.nature.com/articles/s41467-022-35100-z) |

## Recommended changes to the app, in order of importance

1. **Fix the cooling check.** Replace `sublimator_max_pressure_pa = 933` with the water triple point (611.657 Pa). Rewrite the message so Jezero shows that a sublimator cannot work and a membrane evaporator with a pump is required. Drop "Cooling OK: 718 Pa vs 933 Pa".
2. **Change `vis_dust_scale_height_km` from 15 to 10.5.** Add a pessimistic "settled dust" case (H ≈ 6 km, calibrated on Gale's 2.7 km at τ ≈ 8). Label visibility as a model with roughly ×0.5–×2 uncertainty.
3. **Frame Horizon Match as a coarse, ~100 m-class fix.**
   - Never let a fix set uncertainty below about 100 m.
   - Reject fixes far outside the dead-reckoning circle, to catch failures like the 2.77 km one.
   - Require full 360° coverage.
   - Warn in enclosed channels and at high τ.
   - Use the reworded JPL and LVS claims.
4. **Change `sensorimotor_recovery_days` from 7 to about 14** (range 6–16), with a front-loaded ramp instead of a linear one. Cite Reschke et al. 2015.
5. **Set `sans_range_factor` to 1.0, or remove it.** Reword the SANS message to say the shift affects near vision.
6. **Correct the dead-reckoning mechanism.** Use a Sun-referenced gyro, since Mars has no global magnetic field, and cite the Apollo ±2% and ZUPT 1–2% benchmarks.
7. **Fix the radiation units and citations.**
   - Use 0.66 mSv/sol (0.64 mSv/day) and note solar-max conditions.
   - Flag the Gale-to-Jezero extrapolation.
   - Never add mSv to the mGy-Eq limit.
   - Cite NASA-STD-3001 Rev C and the nasa.gov SEP page.
8. **Correct the remaining text and values.**
   - ">4 dust devils" becomes ">4 vortices, ~25% dusty".
   - Wind equivalent becomes 3.8 m/s at 1/70 density.
   - Perchlorate becomes 0.5% with primary citations.
   - The τ_typical note matches what Lemmon et al. actually say.
   - The pressure range becomes 625–761 Pa.
9. **Fill in citations.** Add the Bellcomm/ALSJ source for the 3.3 km/h walk speed and the 1.2× pad, and remove "no source found". Cite Mars24 for sol length, and the Artemis 20° limit as context for the slope limits.

## Conclusion

Sightline's errors fall into one pattern: values borrowed from a neighbouring context without the condition that made them true. Seven Torr is a membrane-evaporator test pressure, not a sublimator limit. A per-day dose was relabelled per sol. A near-vision symptom became a distance penalty. A compass was assumed on a planet without a global magnetic field. A scale height was chosen so the visibility numbers looked reasonable, not derived from atmospheric physics. Each looks fine on its own and fails when traced to its source. That makes the fix process straightforward: for every constant, record the conditions the source measured, as well as the number.

The bigger lesson concerns Horizon Match. The published record does not show it is too inaccurate. It shows its value depends on the requirement. Against a rover's 5 m requirement it fails; against Apollo's "get the crew within sight of the lander" requirement it passes easily. Sightline's most defensible position is to adopt the Apollo framing explicitly. It should treat a skyline fix as an independent, globally registered sanity check with a known ~100 m error and a known chance of gross failure, and gate it against dead reckoning rather than trust it outright. The open research gap is that no one has measured how skyline error grows with Martian dust opacity. Sightline's own Navcam tests across different τ values could supply the first data on that.
