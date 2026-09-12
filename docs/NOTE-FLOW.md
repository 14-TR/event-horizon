# Coherent actual-note flow

## Visual change

Independent, size-seeded noise within overlapping note volumes averages away in a dense disk. Its outer copper light then reads as smooth polished rings. Neighboring finite volumes now sample one continuous disk-space modulation at each column's closest point. High-contrast wisps fade in across source-space radii 4.8–5.8; a supported inner exposure preserves the incandescent reservoir and continuous lensed roots instead of applying the outskirts' dark troughs to the bright body. This support still multiplies only the existing finite source column, never empty space. Twisted Cartesian coordinates stretch irregular eddies along the flow without an angular wrap seam. The common rotation is advected using the existing `DISK.rotation` and simulation timestamp, in both the direct and HDR source passes. Pause and reduced motion freeze that same clock.

This is **light grading inside actual-note volumes**, not replacement gas. Each source retains its existing position, color, size, compact kernel, curved support, signed-depth clipping and source-center height moment. The bounded modulation has a positive floor; hiding every source still produces exactly zero disk light. No graph IDs, picking geometry, trails, topology, camera framing, controls or quality populations change.

## Budget and limitations

- The same three bounded value-noise evaluations per contributing source column; additional coordinate rotation/shear arithmetic, but no new texture taps, marching loops, draws, targets or instanced buffers.
- One simulation-derived phase uniform per source-light material. The existing renderer sends the timestamp to both passes before drawing; no independent wall clock or persistent animation state.
- The field is an artistic, commonly rotating exposure grade, not a fluid simulation, a material trajectory for each note, or conserved transport. Individual sources continue their own inward/recycling paths through it.
- The unchanged closest-point/curvature approximation can give direct and captured columns different samples at oblique angles. The lensed source image still averages height; precisely edge-on images remain ring-like and the bright inner band can remain smooth. This increment is not a full match for the reference animation.

## Regression evidence

`tests/browser/note-flow.spec.js` uses the production volume shader and actual GPU draws. A one-factor grain ablation divides out the unchanged compact column, then compares two neighboring real-source footprints with different positions and minimum/maximum production sizes. Their shared spatial modulation must agree while retaining nonzero contrast, at every quality. Constant light cannot pass. Hiding the parent must eliminate all light.

A separate real-GPU clock test requires changed direct/captured light when simulation time advances, exact repeated and rewound frames, and zero light after source removal. Existing provenance, signed-height, partial-depth, edge-on, screen-compositing, all-ID, navigation and junction gates remain unchanged. Before accepting a release, inspect matched frozen views plus actual orbit/flight/source motion and measure the complete source-capture/direct-render GPU workload against the released build.
