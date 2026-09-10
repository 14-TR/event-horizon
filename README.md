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

- **Orbit mode:** drag to orbit in 3D; **scroll or pinch** to zoom. Right-drag pans.
- **Fly mode:** **WASD** moves forward/back/left/right relative to your view; **Q / E** moves down/up. **Drag** on the sky to look around. The six **hold-to-move thrust buttons** also work with touch or Space/Enter. Releasing or cancelling input stops movement immediately; changing tabs or losing focus clears held inputs. Flight stays within the scene and outside the central horizon.
- Select a **sector button** to isolate its colored stream within the same disk. Its real within-sector connections become visible. Large streams keep the disk-wide view; tiny sectors are approached for inspection. Orbit follows the selected sector’s center. Selecting an active sector again clears isolation. Switching to Fly releases tracking without clearing the selected stream.
- **Click a colored star** to inspect its anonymous ID and total unique neighbors, including connections outside the isolated sector. Picking and selected reticles use the same approximate depth as the black-hole image.
- The native **anonymous node selector** includes every node in that sector, providing the same data inspection without pointer picking. No IDs are truncated by a display cap.
- **Reset view** restores Orbit mode, the home camera and all sectors, without resetting simulation time. **Escape** clears the selection, or closes the About dialog when open.
- **Cinematic view** hides the HUD without changing simulation or quality. A persistent **Exit cinematic view** button remains visible, focused, keyboard/touch accessible, and at least 44px high. **Escape** exits cinematic before clearing a selection. Hidden controls are inert.
- **Render quality** independently selects Mobile, Desktop, or Cinematic. Narrow viewports default to Mobile; an explicit preference is remembered locally. Quality changes ray resolution and trail detail, **never the graph or note population**.
- **Pause motion** freezes note positions, edges and orbital exposures. `prefers-reduced-motion` starts paused and disables automatic camera approaches. The frozen opening still has the complete luminous disk. Deliberate Orbit/Fly navigation remains available while paused; Resume opts back into simulation motion.
- Sector controls have native keyboard activation, pressed states, focus indicators and a skip link. Mobile controls remain at least 44px high; the inspector expands below the scene.
- If WebGL2/float targets cannot start, a shader fails (including after a quality change), depth readback fails, or the context is lost, **accessible topology mode** stops rendering and preserves the complete sector/node index. Missing or invalid data fails closed with a retry message.

## What the picture means

### The notes are the disk

There is **one luminous star per actual node**, with no detached sector clouds, desktop/mobile subsampling, or invented particles filling gaps. Sector membership supplies colors and interleaved spiral bands in the same annulus. The current graph’s two largest sectors dominate the gold/copper light naturally; tiny sectors remain real, inspectable members of the disk rather than being inflated with synthetic notes.

The stellar disk lies in world-space XZ, with bounded vertical thickness and a shallow warp. Its artistic radius spans **3.65–11.8 world units**, outside the absorbing horizon (radius 1.15). It is genuinely three-dimensional when viewed from above, below, edge-on or in free flight—not a camera-facing billboard. Layout is seeded and repeatable; positions, sizes and colors are not semantic or physical measurements.

**Infall is animation, not data destruction.** Each note moves inward along its spiral and wraps to the outer edge on its own staggered phase in a 96-second radial cycle. The whole disk also rotates, so a radial wrap is not a whole-scene reset. No sector disappears or returns as a detached cloud. IDs, membership, links and counts never change. GPU point buffers, edge endpoints, picking and reticles use the same moving coordinates.

Short trails are **orbital exposures of those exact notes**, not extra stars or graph links. They evaluate the same deterministic trajectory up to 0.85 seconds into its past. This gives a complete frozen/reduced-motion opening rather than waiting for frame history. Exposures stop at each note’s recycle boundary, never bridging the inner and outer disk. Pause freezes them exactly; quality and selection/reset rebuild the exposure at the current simulation time, with no stale streaks. The longest trail is 1.2 world units on Mobile or 1.5 otherwise.

### Black hole and decorative sky

**Procedural gas is disabled in the observatory.** The disk’s luminous structure comes from actual note sprites and bounded trails, not an opaque gas layer. A dormant optional dust uniform in the ray module adds only restrained emission and never opaque disk depth.

The dim background sky is **separate decorative artwork, not additional notes**. The fixed world-space ray pass reconstructs the actual camera rays, bends them through a bounded central-potential approximation, and samples the escaping procedural sky. This preserves a dark capture silhouette and view-dependent lensed sky. It is **not a full general-relativity simulation**.

**Note images are not physically lensed.** Note-stars remain ordinary, directly rendered 3D graph objects. The ray pass writes approximate capture depth; picking and reticles read that same depth so hidden stars cannot be selected through the horizon. Foreground stars can cross in front of the black core. Nearest-pixel occlusion and silhouette boundaries remain approximate.

### Connections and membership

Only **real within-sector connections** are drawn, revealed on isolation so straight graph edges do not mask the stellar spiral structure. Cross-sector links remain unchanged in the full graph and total neighbor counts, but are not drawn. There is an 8,000 within-sector edge drawing ceiling; it does not affect the current graph or any note/neighbor count.

Sector membership comes from the supplied export. The current export uses anonymized folder-derived sectors, **not inferred semantic communities**. All labels are generated as `Sector 01`, `Sector 02`, and so on.

### Render budgets and truthful counts

| Quality | Ray steps | Maximum ray pixels | Notes included | Trail segments per note |
| --- | ---: | ---: | --- | ---: |
| Mobile | 96 | 340,000 | All | 3 |
| Desktop | 144 | 1,100,000 | All | 5 |
| Cinematic | 192 | 2,100,000 | All | 7 |

The ray target is independent of display DPR (ray DPR caps: 1 / 1 / 1.5). Foreground DPR is capped at 1.75. The full graph is retained without an overall or per-sector node cap. Every note has one point in a GPU buffer and one bounded trail entry; no quality preset samples a subset.

The reviewed topology contains **1,675 notes, 1,762 connections and 8 sectors**. Before isolation, both desktop and mobile report **1,675 / 1,675 notes in disk**. During isolation, the numerator is the selected stream’s complete population. These are included-note counts, **not on-screen pixel, visibility or occlusion counts**. The top totals always describe the complete validated graph. The inspector separately reports included/total sector notes. WebGL fallback reports zero rendered notes while retaining every ID in the accessible index. Future exports may change the totals.

## Verification

Unit tests read the actual public graph and require each of its 1,675 IDs to map exactly once into the bounded 3D disk. They check all quality presets’ actual point buffers, repeatability, unchanged input topology, whole-disk coverage through long/negative times, staggered recycling, exact pause, moving edge/picking coordinates and bounded per-note exposure history.

`tests/browser/node-disk.spec.js` observes **real WebGL POINTS draw counts** for all three qualities on desktop/mobile, enumerates every sector’s complete ID selector, verifies the aggregate is exactly the actual 1,675 unique IDs, and checks tail-of-sector IDs and full neighbor counts beyond the former per-sector cap. It records JSON coverage receipts in `test-results/`.

`tests/browser/render-acceptance.spec.js` records real-topology desktop/mobile/cinematic/above/edge/reverse/below/close-flight screenshots and bounded requestAnimationFrame pacing. Those measurements identify the actual GPU and are not physical-phone or Safari performance guarantees. GPU depth is additionally checked at DPR 1, 1.75 and 3. The selected-node reticle/picking one-pixel readback can add synchronization cost; the unselected scene does no pixel readback. Production browser tests also exercise WASD/QE, touch cancellation, orbit/reset, reduced motion, isolation, privacy, empty graphs and renderer failure fallbacks.

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
- `src/black-hole.js`, `src/black-hole-shaders.js`, `src/black-hole-math.js` — bounded rays, lensed decorative sky, capture depth and quality budgets
- `src/star-trails.js` — bounded orbital exposures for every real note
- `src/shaders.js` — luminous actual-node point shaders
- `src/scene.js` — Three.js scene, controls, raycasting, isolation and lifecycle
- `src/main.js` — accessible UI, truthful counts, loading/error/fallback states
- `src/style.css` — responsive observatory composition and motion preferences
- `tests/` — unit tests, synthetic fixtures, actual-data GPU/ID coverage, browser and resilience checks

## License

MIT. Copyright © 2026 TR Ingram. See [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
