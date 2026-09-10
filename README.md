# Event Horizon

A cinematic, interactive observatory of a second brain’s connection topology. Actual anonymous note stars spiral through 3D space toward an orange-gold black hole. Orbit a constellation or fly freely among its moving stars.

Built with **Vite, Three.js, and plain JavaScript**. All artwork is procedural. Fonts are local system fonts. There are no remote textures, font services, analytics, or runtime third-party requests.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, under `/event-horizon/`.

```sh
npm test                       # topology, infall, renderer, depth policy, bounded trails
npm run build                  # production output in dist/
npm run preview                # preview the production build
npx playwright install chromium
npm run test:smoke              # browser tests against Vite
EH_PREVIEW=1 npm run test:smoke  # browser tests against dist/; build first
# Optional macOS real-GPU verification (full Chromium, ANGLE Metal):
EH_PREVIEW=1 npx playwright test --config tests/production.config.js
```

The production base is **`/event-horizon/`**, suitable for a GitHub Pages project site. Deployment and topology export are managed separately; the application does not access a vault. Browser tests use synthetic network-intercepted fixtures plus read-only tests of the real `public/graph.json`. They never overwrite that file. Screenshots are written to ignored `test-results/`.

## Explore

- **Orbit mode:** drag to orbit in 3D; **scroll or pinch** to zoom. Right-drag pans.
- **Fly mode:** **WASD** moves forward/back/left/right relative to your view; **Q / E** moves down/up. **Drag** on the sky to look around. The six visible **hold-to-move thrust buttons** also work with touch or Space/Enter. Releasing or cancelling input stops movement immediately; changing tabs or losing focus clears held inputs. Flight stays within the starfield and outside the central horizon.
- Select a **sector button or orbital label** to isolate and approach its constellation in tracking Orbit mode. The camera follows that sector's moving center, so inspection remains useful during infall. Selecting an active sector again clears isolation. Switching to Fly releases tracking without clearing the selected sector.
- **Click a colored star** to inspect an anonymous node ID and its total unique neighbors, including connections outside the displayed sample and sector.
- The native **anonymous node selector** offers the same inspection path without pointer picking.
- **Reset view** restores Orbit mode, the home camera and all sectors. **Escape** clears the selection, or closes the About dialog when it is open.
- **Cinematic view** hides the HUD without changing the simulation or render quality. A persistent **Exit cinematic view** button remains visible, focused, keyboard/touch accessible, and at least 44px high. **Escape** exits cinematic before clearing a selection. Hidden controls are inert.
- **Render quality** independently selects Mobile, Desktop, or Cinematic. Narrow viewports default to Mobile; an explicit preference is remembered locally. This is a render budget, not device/GPU detection, and never changes graph identities or sample counts.
- **Pause motion** freezes the note positions, their edges, short trails, and shader animation. The system’s `prefers-reduced-motion` setting starts the scene paused and disables automatic camera approaches. Deliberate Orbit/Fly navigation remains available while paused; Resume opts back into simulation motion.
- Sector controls have native keyboard activation, pressed states, focus indicators, and a skip link. Mobile controls remain at least 44px high; the inspector expands below the scene.
- If WebGL2/float targets cannot start, a shader fails (including after a quality change), depth readback fails, or the context is lost, **accessible topology mode** stops rendering and preserves sector and node inspection. Missing or invalid data fails closed with a retry message.

## What the picture means

Colored stars are notes, and the drawn constellation lines are **real within-sector connections**. Cross-sector links are included in the full graph and node neighbor counts but are not drawn, preserving separation between constellations. The black hole, turbulent accretion flow and lensed procedural sky are artwork—not additional notes or links. There is no separate decorative dust cloud or duplicate unlensed star sphere. Faint short colored trails are histories of actual sampled note positions, not invented particles.

**Infall is a visual simulation, not data destruction.** The actual sampled node coordinates spiral inward, turn faster near the center and stretch into tidal streams. Each sector completes a deterministic repeating loop (42–70 seconds for the current eight sectors), then its same notes return to the outer orbit. IDs, sector membership, topology and counts never change. This is an art-directed animation, not a numerical gravity model or a representation of changing knowledge. GPU star positions, drawn edge endpoints, raycasting, markers and inspection reticles all use the updated coordinates.

Sector membership comes from the supplied export. The current export uses anonymized folder-derived sectors, **not inferred semantic communities**. All displayed sector labels are generated as `Sector 01`, `Sector 02`, and so on. Coordinates, sizes, colors, and black-hole lensing are artistic, not physical or semantic measurements. The fixed world-space ray pass reconstructs the actual camera rays, bends them through a bounded central-potential approximation, intersects a finite-thickness disk and samples the escaping sky. It is **not a full general-relativity simulation**. Differentially sheared, domain-warped multiscale noise creates broken gas filaments and darker lanes around a smoother hot inner body; there are no regular radial sine gratings. The view changes above, below, edge-on and during free flight. The ray pass writes approximate foreground depth; picking and the selected reticle read that same depth so shader-hidden notes cannot be selected through the horizon. Ordinary note stars remain unlensed world-space graph objects. Semi-transparent boundaries and nearest-pixel occlusion remain approximate.

### Renderer and trail budgets

| Quality | Ray steps | Maximum ray pixels | Stars with short trails |
| --- | ---: | ---: | ---: |
| Mobile | 96 | 340,000 | 96 |
| Desktop | 144 | 1,100,000 | 320 |
| Cinematic | 192 | 2,100,000 | 512 |

The ray target is independent of display DPR (ray DPR caps: 1 / 1 / 1.5). Foreground DPR is capped at 1.75. Glow is restrained and capture-aware rather than broad full-screen bloom. Each trail has at most four fading world-space segments, sampled about every 55ms, and is capped at 0.85 world units on Mobile or 1.3 otherwise. Pause freezes them. Sector recycling, clock discontinuities, quality changes and view/sector resets clear their history, preventing cross-scene streaks. No note or connection is created or removed by trails.

`tests/browser/render-acceptance.spec.js` records real-topology desktop/mobile/above/edge/reverse/below/close-flight screenshots and bounded requestAnimationFrame pacing in `test-results/`. Those measurements identify the actual GPU and are not physical-phone or Safari performance guarantees. WebGL depth is additionally checked at DPR 1, 1.75 and 3. The one-pixel readback for selected-node reticles/picking can add synchronization cost; the unselected scene does no pixel readback.

### Display budgets and truthful counts

- Desktop: at most **1,800 notes overall and 260 per sector**.
- Narrow screens: at most **900 notes overall and 160 per sector**.
- At most **8,000 real within-sector edges** are drawn.
- Sampling sorts anonymous IDs within each sector, caps each sector, then takes notes round-robin across sectors. This is deterministic coverage, **not a statistically representative sample**.
- Small sectors are retained before large sectors consume the budget. Single-node sectors have a star at their marker, and sectors with four or fewer displayed notes use larger star sprites.
- The top totals describe the full validated graph. The bottom numerator counts notes enabled in the current scene—including isolation changes—against the full graph total; it is not an on-screen pixel/occlusion count. The inspector separately reports rendered/total notes in the chosen sector. WebGL fallback reports zero rendered notes.

The initial reviewed topology contains **1,675 notes, 1,762 connections, and 8 sectors**. At current budgets it displays **577 notes on desktop** or **377 on narrow screens**, before isolation. Future exports may change these totals.

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

Node IDs must be `n` followed by 6–12 digits. Sector IDs must be nonnegative safe integers. IDs must be unique, and edges must reference existing nodes. The client rejects malformed graphs and dangling references, copies only allowed anonymous fields, ignores supplied labels and metadata, and recomputes totals from the validated arrays. It does not normalize malformed identifiers or place input into HTML.

## Privacy: topology can fingerprint a graph

**Removing titles and content does not guarantee anonymity.** Degree patterns, distinctive subgraphs, sector sizes, and repeated exports can fingerprint a source graph or enable linkage to outside information. Sampling in the visualizer is not a privacy boundary: the full published JSON remains downloadable.

The browser’s allowlist is also **not** the publication boundary. Any extra private fields accidentally committed to `public/graph.json` are public even if the UI ignores them. Review the actual exported file before publishing. Never publish note text, titles, filenames, paths, semantic labels, or an ID-to-source lookup. Previously published versions may remain in repository history or caches.

## Structure

- `src/graph.js` — anonymous schema boundary and deterministic bounded sampling
- `src/layout.js` — seeded 3D orbital placement and sector colors
- `src/motion.js` — deterministic, time-driven note infall and non-destructive recycling
- `src/flight.js` — free camera movement, drag-look and held-input lifecycle
- `src/black-hole.js`, `src/black-hole-shaders.js`, `src/black-hole-math.js` — bounded world-space rays, turbulent gas, lensed sky, depth and quality budgets
- `src/star-trails.js` — bounded histories of real moving notes with reset/recycle guards
- `src/shaders.js` — luminous actual-node point shaders
- `src/scene.js` — Three.js scene, camera controls, raycasting, isolation, lifecycle
- `src/main.js` — accessible UI, counts, loading/error/fallback states
- `src/style.css` — responsive observatory composition and motion preferences
- `tests/` — unit tests, synthetic fixtures, real-data browser tests and resilience checks

## License

MIT. Copyright © 2026 TR Ingram. See [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
