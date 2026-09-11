# Event Horizon

A cinematic, interactive observatory of a second brain’s connection topology. **Every actual note forms the accretion disk itself**: luminous gold, copper and colored stars in shared three-dimensional spiral streams around a black core. Orbit the disk or fly among its moving notes.

Built with **Vite, Three.js, and plain JavaScript**. All artwork is generated locally. Fonts are local system fonts. There are no remote textures, font services, analytics, or runtime third-party requests.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, under `/event-horizon/`.

```sh
npm test                       # full topology, disk geometry, motion, renderer and trails
npm run build                  # production output in dist/
npm run preview                # preview the production build
npx playwright install chromium
npm run test:smoke              # browser tests against Vite
EH_PREVIEW=1 npm run test:smoke  # browser tests against dist/; build first
# Optional macOS real-GPU verification (full Chromium, ANGLE Metal):
EH_PREVIEW=1 npx playwright test --config tests/production.config.js
```

The production base is **`/event-horizon/`**, suitable for a GitHub Pages project site. Deployment and topology export are managed separately; the application does not access a vault. Browser tests use synthetic network-intercepted fixtures plus read-only tests of the real `public/graph.json`. They never overwrite that file. Screenshots and coverage receipts are written to ignored `test-results/`.

## Explore

- **The opening is the title and the scene.** Select **EVENT HORIZON** to reveal a single scrollable exploration drawer; select it again or press **Escape** to return to the scene. The title is a keyboard/touch button with an explicit accessible label and expanded state. Hidden tools are inert, not deleted. No dashboard or exit-button chrome competes with the opening.
- **Orbit mode:** drag to orbit in 3D; **scroll or pinch** to zoom. Right-drag pans.
- **Fly mode:** **WASD** moves forward/back/left/right relative to your view; **Q / E** moves down/up. **Drag** on the sky to look around. The six **hold-to-move thrust buttons** also work with touch or Space/Enter. Releasing or cancelling input stops movement immediately; changing tabs or losing focus clears held inputs. Flight stays within the scene and outside the central horizon.
- Select a **sector button** to isolate its colored stream within the same disk. Its real within-sector connections become visible. Large streams keep the disk-wide view; tiny sectors are approached for inspection. Orbit follows the selected sector’s center. Selecting an active sector again clears isolation. Switching to Fly releases tracking without clearing the selected stream.
- **Click a direct colored star** to inspect its anonymous ID and total unique neighbors, including connections outside the isolated sector. Picking and selected reticles use the same approximate depth as the black-hole image. **Warped arcs are noninteractive repeated light**, not extra notes or independently pickable stars; use the direct star or the complete ID selector.
- The native **anonymous node selector** includes every node in that sector, providing the same data inspection without pointer picking. No IDs are truncated by a display cap.
- **Reset view** restores Orbit mode, the home camera and all sectors, without resetting simulation time. **Escape** closes About first, or conceals the exploration drawer without discarding selection.
- **Return to scene** conceals the tools without changing simulation, camera, selection or quality. Focus returns to the title. Its hit target exceeds 44px on mobile; a hover/keyboard-focus hint explains the disclosure without permanent extra chrome.
- **Render quality** independently selects Mobile, Desktop, or Cinematic. Narrow viewports default to Mobile; an explicit preference is remembered locally. Quality changes ray resolution and trail detail, **never the graph or note population**.
- **Pause motion** freezes note positions, edges and orbital exposures. `prefers-reduced-motion` starts paused and disables automatic camera approaches. The frozen opening still has the complete luminous disk. Deliberate Orbit/Fly navigation remains available while paused; Resume opts back into simulation motion.
- Sector controls have native keyboard activation, pressed states, focus indicators and a skip link that opens the drawer. Mobile tools use a scrollable bottom sheet; the scene always remains one viewport tall, even during inspection.
- If WebGL2/float targets cannot start, a shader fails (including after a quality change), depth readback fails, or the context is lost, **accessible topology mode** stops rendering and preserves the complete sector/node index. Missing or invalid data fails closed with a retry message.

## What the picture means

### The notes are the disk

There is **one luminous star per actual node**, with no detached sector clouds, desktop/mobile subsampling, or invented particles filling gaps. Each sector follows one broad, seeded, irregular spiral stream rather than three equally spaced rails. A finite-slope radial residence curve concentrates actual notes into a broad inner reservoir, leaving a sparse outer edge without piling them onto an infinitesimal rim. ID-stable sprite sizes span 3.1–14.1 shader size units: most stars are fine-grained and fewer than one in ten have sizes above 10. Tiny sectors are not inflated with giant stars or synthetic notes; the complete selector preserves their discoverability.

Current radius grades the **actual point and trail emission** from concentrated white-gold inward to subdued copper outward, with an 8% sector-color blend. The strictly positive outer emission floor never masks a note out. Positions, GPU colors, real edges and picking update together during infall, while stellar size identity stays fixed. The source capture borrows those same live colors and sizes; this is not a bloom-only or camera-framing change. Compact HDR cores and soft halos belong to those real notes.

Each actual note also supplies a finite, flow-aligned **light volume**, centered at its live position with its current color and size. A compact ellipsoidal emission kernel has real radial and vertical support, so its light does not vanish into a zero-area sheet at exactly edge-on. A curved, domain-warped wisp profile modulates only that source's bounded footprint. These are not added gas particles, orbital histories, graph nodes or pickable objects. Hiding a source hides its volume. The direct view and HDR capture use the same geometry and emission kernel. The kernel's optical column is integrated analytically; turbulence and curvature are evaluated at the ray's closest point rather than marched through a full density field. This is an artistic, column-filtered volume approximation, not a physical point-spread function or full radiative transfer.

Direct volumes clip their integration interval against the same signed black-hole ray depth used for the silhouette and picking. A partially foreground source keeps its foreground light instead of being rejected at the bounding box's back face. Direct light uses exponential, screen-blended exposure accumulation, retaining white-gold rolloff where many sources overlap rather than hard-clipping a white slab. Only this soft volume layer renders into a single-sample half-float target at the ray target's bounded dimensions. The existing final composite bilinearly samples that light and applies its screen grade, before all compact stellar cores and trails draw at the original canvas DPR with MSAA. This trades some subpixel wisp detail and a slightly softer volume-occlusion boundary for less high-DPI overdraw; it does not flatten volumes, remove sources or lower stellar-core resolution. Drawing the cores last also prevents other sectors' screen exposure from attenuating their glints. The source capture remains unchanged additive linear HDR with source-center height moments. The direct exposure grade is not an energy-conserving combination with the separately tone-mapped lensed image and compact stellar cores.

The stellar disk lies in world-space XZ, with bounded vertical thickness and a shallow warp. Its note-center radius spans **3.65–11.8 world units**, outside the absorbing horizon (radius 1.15); finite light footprints extend beyond those centers. It is genuinely three-dimensional when viewed from above, below, edge-on or in free flight—not a camera-facing billboard. Each source volume is shallow but has nonzero vertical thickness around its source's height. Layout is seeded and repeatable; positions, sizes and colors are not semantic or physical measurements.

**Infall is animation, not data destruction.** Each note moves inward along its spiral and wraps to the outer edge on its own staggered phase in a 96-second radial cycle. The whole disk also rotates, so a radial wrap is not a whole-scene reset. No sector disappears or returns as a detached cloud. IDs, membership, links and counts never change. GPU point buffers, edge endpoints, picking and reticles use the same moving coordinates.

Short trails are **orbital exposures of those exact notes**, not extra stars or graph links. They evaluate the same deterministic trajectory a stable, per-note **0.035–0.12 seconds** into its past and carry the star's current radial/sector emission with a fading tail. The exposure uses the current color across that short history, not a time-integrated thermal model. This gives a complete frozen/reduced-motion opening rather than waiting for frame history. Exposures stop at each note’s recycle boundary, never bridging the inner and outer disk. Pause freezes them exactly; quality and selection/reset rebuild the exposure at the current simulation time, with no stale streaks. Every quality caps a trail at **0.24 world units**; regression checks additionally bound the actual 95th-percentile length below 0.16 across sampled times. Trails read as short glints, not lines revealing full orbits.

### Black hole and decorative sky

**Procedural gas is disabled in the observatory.** The disk’s luminous structure comes from actual note sprites, their finite light envelopes and bounded trails, not an opaque gas layer or a source-independent density field. A dormant optional dust uniform in the ray module adds only restrained emission and never opaque disk depth.

The dim background sky is **separate decorative artwork, not additional notes**. The fixed world-space ray pass reconstructs the actual camera rays, bends them through a bounded central-potential approximation, and samples the escaping procedural sky. This preserves a dark capture silhouette and view-dependent lensed sky. It is **not a full general-relativity simulation**.

**The actual note light now bends around the shadow.** A second, fixed world-XZ render pass captures the *same live position, color, size and trail geometry buffers* into a linear-HDR disk image. It excludes graph edges, sky, gas and UI. The existing bent rays intersect that image on their outgoing path after closest approach, producing far-side upper/lower arcs and a narrow photon-like inner image. Removing or isolating source notes removes their light from the arcs; changing the camera changes the ray intersections, not the orientation of a painted billboard. The capture is regenerated from the current exposure each frame, including while paused, without changing simulation time.

This is an **explicit thin-disk lensing approximation, not physically exact images or a full relativistic transfer solution**. The XZ capture stores RGB emitted light and emission-weighted actual world height in its alpha channel. One broadly supported height lookup offsets the outgoing plane intersection, so initially empty coordinates can still discover displaced sources at grazing angles; moving a source vertically changes its lensed image. Eight bounded directional radiance taps then filter the elongated ray footprint without imposing its largest mip on both axes. The filter uses the uncorrected plane-intersection derivatives, caps its span and mip level, and remains an approximate finite-footprint reconstruction, not exact anisotropic transport. It retains more narrow-axis source detail than the former isotropic minimum blur. This remains a shallow mean-height approximation: overlapping depths are averaged, not resolved as a true volume. Weakly bent primary light fades out. A soft source-to-observer impact-parameter gate also attenuates repeated light from unobscured sources, preventing a displaced duplicate disk at high inclinations. That gate uses the uncorrected thin-plane hit, not exact visibility or relativistic image-order classification; it deliberately omits some physically possible secondary light. Sources near its broad transition can still overlap their direct images. Higher-order images, lensed volumetric transfer, time delays, energy-conserving magnification and exact redshift are not solved. Near periapsis, a feathered gate uses the estimated direction at the actual disk crossing instead of a hard segment-midpoint cutoff; this removes staircase cuts across continuous inclined arcs, but remains approximate visibility. Precisely edge-on alignment can produce nearly concentric Einstein-like arcs from a radial slice of the actual source image. Very narrow images can alias or change at a quality boundary. The stellar core profile, radial color grade, finite light footprints, exposure gain, directional highlights and thresholded glow are art direction, **not physical temperatures or reflections from a metallic surface**. There is no source-independent luminous disk/rim fill.

Direct note-stars remain ordinary 3D objects, so foreground stars and trails still pass in front of the black core. The ray pass keeps captured radiance black and writes approximate capture depth; picking and reticles read that same depth so hidden direct stars cannot be selected through the horizon. Image-only copies are held in a separate noninteractive capture scene, borrow graph geometry without owning IDs, and never enter picking or totals. Nearest-pixel occlusion and silhouette boundaries remain approximate.

### Connections and membership

Only **real within-sector connections** are drawn, revealed on isolation so straight graph edges do not mask the stellar spiral structure. Cross-sector links remain unchanged in the full graph and total neighbor counts, but are not drawn. There is an 8,000 within-sector edge drawing ceiling; it does not affect the current graph or any note/neighbor count.

Sector membership comes from the supplied export. The current export uses anonymized folder-derived sectors, **not inferred semantic communities**. All labels are generated as `Sector 01`, `Sector 02`, and so on.

### Render budgets and truthful counts

| Quality | Ray steps | Maximum ray pixels | Disk image | Notes included | Trail segments per note |
| --- | ---: | ---: | --- | --- | ---: |
| Mobile | 96 | 340,000 | 512 × 512 | All | 3 |
| Desktop | 144 | 1,100,000 | 768 × 768 | All | 5 |
| Cinematic | 192 | 2,100,000 | 1024 × 1024 | All | 7 |

The ray target is independent of display DPR (ray DPR caps: 1 / 1 / 1.5). Foreground DPR is capped at 1.75. The full graph is retained without an overall or per-sector node cap. Every note has one point in a GPU buffer and one bounded trail entry; no quality preset samples a subset.

Lensing adds one bounded RGBA16F source target with mipmaps (approximately **2.67 / 6 / 10.67 MiB** by quality), no depth target, and two capture draws per visible sector (points and envelopes) plus one trail draw: 17 with the current 8-sector graph. The direct light pass borrows the same instanced envelope buffers for one draw per sector, using a 12-triangle bounding box per actual note; the box faces themselves never emit light. Its additional non-mipmapped RGBA16F target is capped at the ray pixel budget (at most **2.59 / 8.39 / 16.02 MiB**), with no depth or multisample allocation. It replaces full-DPR volume draws rather than duplicating them. The existing final composite adds one bilinear texture lookup, not another fullscreen draw. Each volume fragment still uses the same bounded polynomial optical-column integral and three local noise evaluations, not a variable ray-march loop. Direct volume fragments read one signed ray-depth texel; their physical target dimensions are synchronized on resize and quality changes. Envelope attributes share the live source CPU arrays but have separate instanced GPU buffers; both light passes reuse those envelope buffers and the lens capture retains all original point/trail geometry. Neither pass generates another node population. At most nine source-image texture lookups occur after ray integration, never inside the step loop: one for height and eight for radiance. Unresolved footprints above 32 source texels instead use one coarse radiance lookup, preventing widely spaced taps from painting separated ghost crescents. Height uses the existing HDR alpha channel. There are no new dependencies or network requests, and no full-frame CPU/GPU readback in the application.

Browser coverage tests assert actual direct/captured instance populations, the direct pass's single-sample framebuffer and its pixel budget at every quality. For optional local hardware timing, `tests/measure-gpu.mjs` accepts `EH_GPU_VARIANTS` (JSON entries with `name`, production `url`, and immutable `sha`) and `EH_GPU_DIR`. It rotates build order over five rounds per desktop/mobile viewport, verifies frozen cameras and served-asset hashes, and records GPU timers around all 36 production draws. `EH_GPU_MAX_RATIO=1.25` additionally gates the median-of-rounds successor/base GPU ratio for variants named `successor` and `base`. Unsupported/software timers or disjoint results fail rather than silently passing. Keep those measurements separate from browser presentation and headless rAF pacing, inspect the recorded round-to-round spread, and do not generalize desktop emulation to physical phone or Safari performance.

The reviewed topology contains **1,675 notes, 1,762 connections and 8 sectors**. Before isolation, both desktop and mobile report **1,675 / 1,675 notes in disk**. During isolation, the numerator is the selected stream’s complete population. These are included-note counts, **not on-screen pixel, visibility or occlusion counts**. The top totals always describe the complete validated graph. The inspector separately reports included/total sector notes. WebGL fallback reports zero rendered notes while retaining every ID in the accessible index. Future exports may change the totals.

## Verification

Unit tests read the actual public graph and require each of its 1,675 IDs to map exactly once into the bounded 3D disk. They check all quality presets’ actual point buffers, repeatability, unchanged input topology, whole-disk coverage through long/negative times, staggered recycling, exact pause, moving edge/picking coordinates and bounded per-note exposure history.

`tests/browser/node-disk.spec.js` separately observes **real WebGL POINTS and instanced envelope draw populations in the direct view and disk-image framebuffer** for all three qualities on desktop/mobile, enumerates every sector’s complete ID selector, verifies the aggregate is exactly the actual 1,675 unique IDs, and checks tail-of-sector IDs and full neighbor counts beyond the former per-sector cap. It records JSON coverage receipts in `test-results/`. Unit tests require the capture to borrow every actual point/trail/envelope buffer, retain one-to-one source identity, and leave borrowed geometry alive on disposal.

`tests/browser/disk-lensing.spec.js` renders a controlled far-side source through the real GPU passes at every quality. It requires light in both upper and lower shadow arcs, a zero-radiance center, color changes matching the source, compact HDR cores, actual source-height response, view-dependent images, no source-free arcs and no duplicates with lens bending disabled. Diagnostic source images are test-only, not production data or additional notes.

`tests/browser/note-light.spec.js` separately verifies finite envelope breadth, bounded emission, movement/color updates, signed height and zero source-free light on the GPU at every quality. The lensing test includes isolated production-size stars down to size 3.1, not just oversized diagnostic sources. GPU timer receipts include the direct envelope draws as well as the point draws.

`tests/browser/note-volume.spec.js` additionally requires nonzero direct emission and finite vertical support at true edge-on for a minimum-size source, exact frozen repetition, soft overlap rolloff, partial foreground volume integration, and zero hidden/occluded light. `tests/browser/continuous-arcs.spec.js` supplies a constant diagnostic radiance field at every quality to expose hard integration-step cutoffs near periapsis; a feathered crossing-direction gate must keep the upper arc continuous. Diagnostic textures and renderer handles exist only in intercepted test modules, never the deployed page.

The same suite exercises the production shader's directional source filter on the GPU: narrow-axis detail must survive an elongated footprint, while an isotropic footprint must still average it. `tests/capture-disk.mjs` captures desktop/mobile/inclined/edge-on production views with reduced motion, checks repeat screenshots for identical hashes, observes actual camera/time uniforms, and verifies an edge-on camera height near zero. Set `EH_CAPTURE_DIR` for each output directory, `EH_CAPTURE_URL` for the production preview URL (default port 4175), and `EH_COMPARE_DIR` to the before directory for exact before/after camera, projection, viewport, DPR, quality and time comparisons. It also saves untouched title-only desktop/mobile openings. This local capture uses Chromium with ANGLE Metal; it is not a physical-phone/Safari benchmark.

`tests/browser/render-acceptance.spec.js` records real-topology desktop/mobile/cinematic/above/edge/reverse/below/close-flight screenshots and bounded requestAnimationFrame pacing. Those measurements identify the actual GPU and are not physical-phone or Safari performance guarantees. GPU depth is additionally checked at DPR 1, 1.75 and 3. The selected-node reticle/picking one-pixel readback can add synchronization cost; the unselected scene does no pixel readback. Production browser tests also exercise WASD/QE, touch cancellation, orbit/reset, reduced motion, isolation, privacy, empty graphs and renderer failure fallbacks.

`tests/capture-motion.mjs` uses the same `EH_CAPTURE_DIR` / `EH_CAPTURE_URL` settings to record desktop and emulated-mobile WebM clips plus six actual moving frames per viewport. It observes the real simulation-time uniform, confirms every frame differs, then re-enables reduced motion and requires unchanged time and byte-identical repeated screenshots. It does not open the exploration drawer or add application debug hooks.

## Data contract

The app loads only `${BASE_URL}graph.json`, served from `public/graph.json`:

```json
{
  "version": 1,
  "nodes": [{ "id": "n000001", "cluster": 0 }],
  "edges": [],
  "clusters": [{ "id": 0, "label": "Sector 01", "count": 1 }],
  "meta": {
    "source": "anonymized-vault-topology",
    "notes": 1,
    "links": 0,
    "clusters": 1
  }
}
```

Node IDs must be `n` followed by 6–12 digits. Sector IDs must be nonnegative safe integers. IDs must be unique and edges must reference existing nodes. The client rejects malformed graphs and dangling references, copies only allowed anonymous fields, ignores supplied labels and metadata, and recomputes totals from validated arrays. It does not normalize malformed identifiers or place input into HTML.

## Privacy: topology can fingerprint a graph

**Removing titles and content does not guarantee anonymity.** Degree patterns, distinctive subgraphs, sector sizes and repeated exports can fingerprint a source graph or enable linkage to outside information. The full published JSON is downloadable.

The browser’s allowlist is also **not** the publication boundary. Extra private fields accidentally committed to `public/graph.json` are public even if the UI ignores them. Review the actual exported file before publishing. Never publish note text, titles, filenames, paths, semantic labels, or an ID-to-source lookup. Previously published versions may remain in repository history or caches.

## Structure

- `src/graph.js` — anonymous schema boundary; no sampling API
- `src/layout.js` — seeded all-node 3D spiral disk, shared trajectory and sector colors
- `src/motion.js` — time-driven coordinates and non-destructive per-note recycling
- `src/flight.js` — free camera movement, drag-look and held-input lifecycle
- `src/black-hole.js`, `src/black-hole-shaders.js`, `src/black-hole-math.js` — bounded rays, lensed source light and decorative sky, capture depth and quality budgets
- `src/disk-radiance.js` — bounded disk-space HDR capture borrowing actual node/trail geometry; noninteractive secondary light
- `src/star-trails.js` — bounded orbital exposures for every real note
- `src/stellar-emission.js` — shared current-radius/sector emission for actual points and exposure heads
- `src/note-light.js` — bounded, source-bound curved emission envelopes shared by direct view and capture
- `src/shaders.js` — luminous actual-node point shaders
- `src/scene.js` — Three.js scene, controls, raycasting, isolation and lifecycle
- `src/main.js` — accessible UI, truthful counts, loading/error/fallback states
- `src/style.css` — responsive observatory composition and motion preferences
- `tests/` — unit tests, synthetic fixtures, actual-data GPU/ID coverage, browser and resilience checks

## License

MIT. Copyright © 2026 TR Ingram. See [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
