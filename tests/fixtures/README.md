# Fixed rendering regression input

`junction-topology.json` is the unchanged, already-public anonymous topology
from commit `3d9ce8238f138e2e847223ae695fe428ee713cac`, copied for the
inclined corona/disk seam and seeded layout-distribution regressions. It is not today's dataset, a vault export
operation, or an ID-to-source mapping. It is never bundled or deployed.

SHA-256: `93fc70628b132b1a432db87a3fddf75e1d14fdb4cf274cbc6cb25ad886665cc7`.

The ROI (x 330–415, y 400–540), endpoints (371,434)/(398,523), 5px analysis
average and brightness/bottleneck gates were calibrated at 1200×900, DPR 1,
elevation 30°, azimuth 0°, simulation time 0. Different node populations change
source density and seed/rank placement, so these fixed-pixel gates must not be
silently loosened for daily data. `junction.spec.js` intercepts only that test's
network response with this fixture and retains every original threshold.

Current-publication acceptance remains separate: real-graph full-ID/GPU tests,
source provenance tests and production angle captures still consume the current
validated graph. Additions/removals are tested with synthetic fixtures, never by
rewriting `public/graph.json` or reading a private source.
