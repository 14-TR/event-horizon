# Corona / actual-note disk junction

## Scope and correction

The renderer retains the same actual-note HDR exposure, source geometry, signed-height moment, direct volume pass, exposure, composite, shadow depth, quality targets and integration steps. No topology, controls or generated gas are changed.

The hybrid lens image previously required an outgoing (after-periapsis) disk crossing. The direct image does not have that requirement. At inclined views a continuous source branch crosses periapsis before it reaches the direct disk, so multiplying by that extra gate cuts the apparent junction. Merely widening the source-occultation gate restores a displaced duplicate primary disk instead.

The correction accepts crossings on either side of periapsis. Direction-dependent weights and the shallow-height slope use the actual crossing velocity, not the integration segment midpoint. Two bounded candidates are retained by geometric contribution weight: a later invisible crossing cannot overwrite earlier visible light. Sampling stays outside the integration loop.

## Budget and approximation

- Same ray steps, pixel targets, source populations, draws and GPU allocations.
- At most two retained source images, each with one signed-height lookup and eight bounded directional radiance taps (up to eighteen lookups rather than nine). Branches with zero contribution do not sample.
- Candidate ranking is geometric, not based on sampled source brightness. More than two image orders can still omit light. This is not full volumetric transport.
- The world-XZ capture still averages overlapping signed heights and bounds its shallow-depth correction. The original soft source-occultation/weak-bend fades still deliberately suppress some secondary light.
- Direct note cores remain directly projected and pickable; repeated lensed light has no new IDs.
- A visible dark channel between distinct direct/lensed bands at steep inclinations is still possible. Joined endpoints are not a claim of physically exact, universally seamless imaging.

## Reproduction and evidence commands

Run the production build, then the normal production GPU browser configuration. `tests/browser/junction.spec.js` measures the reproduced 30-degree actual-note seam at all three qualities using the explicitly pinned [reviewed topology fixture](../tests/fixtures/README.md), not the mutable daily publication. The ROI, endpoint brightness and bottleneck thresholds are unchanged; source density and seed/rank placement make this a fixed rendering regression, separate from current-data acceptance. It finds the brightest connected path through a bounded local junction and measures its bottleneck relative to the real arc/disk endpoints. It cannot pass by routing around the opposite side of the hole; a small analysis-only pixel average rejects a single stellar glint. The existing continuous-field test separately catches stepping and overwritten crossings; source identity/height/empty-source tests remain in force.

`tests/capture-junction.mjs` captures elevation, azimuth, edge-on, below-plane and distance cases at every quality in desktop/mobile viewports. It asserts actual camera uniforms and repeated frozen pixels, saves actual orbit/free-flight/source-motion video, verifies pause, and records resource hashes. Supply `EH_CAPTURE_URL`, `EH_CAPTURE_DIR` and `EH_CAPTURE_SHA`. Run the candidate with `EH_COMPARE_DIR` pointing to the baseline receipt to require matched frozen cameras and identical projections, times and budgets. Raw uniforms are retained; only near-zero camera components permit less than 1e-12 spherical-reconstruction roundoff, with the observed maximum reported explicitly.

Use `tests/measure-gpu.mjs` for counterbalanced immutable baseline/candidate hardware timing. Do not confuse headless animation pacing or mobile emulation with physical-device frame rates. Release review must bind screenshots, motion and timing to the exact candidate SHA; candidate preparation alone does not authorize publication.
