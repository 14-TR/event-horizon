# Event Horizon

A cinematic, interactive observatory of a second brain’s connection topology. An orange-gold accretion disk and gravitationally lensed arc surround a black center; separate numbered constellations orbit beyond it.

Built with **Vite, Three.js, and plain JavaScript**. All artwork is procedural. Fonts are local system fonts. There are no remote textures, font services, analytics, or runtime third-party requests.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, under `/event-horizon/`.

```sh
npm test                       # graph validation, sampling, orbital layout
npm run build                  # production output in dist/
npm run preview                # preview the production build
npx playwright install chromium
npm run test:smoke              # browser tests against Vite
EH_PREVIEW=1 npm run test:smoke  # browser tests against dist/; build first
```

The production base is **`/event-horizon/`**, suitable for a GitHub Pages project site. Deployment and topology export are managed separately; the application does not access a vault. Browser tests use synthetic network-intercepted fixtures plus read-only tests of the real `public/graph.json`. They never overwrite that file. Screenshots are written to ignored `test-results/`.

## Explore

- **Drag** to orbit in 3D; **scroll or pinch** to zoom. Right-drag pans.
- Select a **sector button or orbital label** to isolate and approach its constellation. Selecting an active sector again clears isolation.
- **Click a colored star** to inspect an anonymous node ID and its total unique neighbors, including connections outside the displayed sample and sector.
- The native **anonymous node selector** offers the same inspection path without pointer picking.
- **Reset view** restores the home camera and all sectors. **Escape** clears the selection, or closes the About dialog when it is open.
- **Pause motion** freezes orbital and shader animation. The system’s `prefers-reduced-motion` setting starts the scene paused and disables camera fly-to animation.
- Sector controls have native keyboard activation, pressed states, focus indicators, and a skip link. Mobile controls remain at least 44px high; the inspector expands below the scene.
- If WebGL cannot start or its context is lost, **accessible topology mode** preserves sector and node inspection. Missing or invalid data fails closed with a retry message.

## What the picture means

Colored stars are notes, and the drawn constellation lines are **real within-sector connections**. Cross-sector links are included in the full graph and node neighbor counts but are not drawn, preserving separation between constellations. The central black hole, gold particle dust, and background starfield are decorative—not additional notes or links.

Sector membership comes from the supplied export. The current export uses anonymized folder-derived sectors, **not inferred semantic communities**. All displayed sector labels are generated as `Sector 01`, `Sector 02`, and so on. Coordinates, sizes, colors, and black-hole lensing are artistic, not physical or semantic measurements. The procedural lens is an art-directed camera-facing shader inside the real Three.js scene, not a general-relativity simulation.

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
- `src/shaders.js` — procedural lens, accretion disk, and luminous point shaders
- `src/scene.js` — Three.js scene, camera controls, raycasting, isolation, lifecycle
- `src/main.js` — accessible UI, counts, loading/error/fallback states
- `src/style.css` — responsive observatory composition and motion preferences
- `tests/` — unit tests, synthetic fixtures, real-data browser tests and resilience checks

## License

MIT. Copyright © 2026 TR Ingram. See [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
