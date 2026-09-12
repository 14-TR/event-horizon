import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTopology as parseGraph } from './topology.js';
import { buildLayout, SECTOR_COLORS } from '../src/layout.js';
// Seed/rank-sensitive distribution thresholds belong to the reviewed snapshot.
const distributionGraph = parseGraph(JSON.parse(readFileSync(new URL('./fixtures/junction-topology.json', import.meta.url))));

const raw = JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url)));

test('every actual note maps exactly once into a shared thin 3D spiral disk, not detached clouds', () => {
  const graph = parseGraph(raw), before = structuredClone(graph);
  const layout = buildLayout(graph);
  assert.deepEqual(layout, buildLayout(graph), 'deterministic placement');
  assert.ok(graph.nodes.length > 0, 'verify a nonempty supplied topology');
  assert.deepEqual(layout.nodes.map(n => n.id).sort(), graph.nodes.map(n => n.id).sort());
  assert.equal(new Set(layout.nodes.map(n => n.id)).size, graph.nodes.length);
  assert.deepEqual(layout.clusters.map(c => c.color), graph.clusters.map((_, i) => SECTOR_COLORS[i % SECTOR_COLORS.length]));
  for (const node of layout.nodes) {
    const [x, y, z] = node.position, r = Math.hypot(x, z);
    assert.ok(node.position.every(Number.isFinite));
    assert.ok(r >= 3.6 && r <= 12, `${node.id} is in the stellar accretion annulus outside the horizon`);
    assert.ok(Math.abs(y) < 0.65, 'disk thickness is bounded, not a cloud');
    assert.equal(node.cluster, graph.nodes.find(n => n.id === node.id).cluster);
  }
  assert.deepEqual(graph, before, 'the full valid graph remains unchanged');
});

test('fixed reviewed populous streams have true depth and span the complete disk', () => {
  const layout = buildLayout(distributionGraph);
  assert.ok(new Set(layout.nodes.map(n => Math.round(n.position[1] * 100))).size > 30, 'true depth, not a flat plane');
  for (const cluster of layout.clusters.filter(c => c.count > 100)) {
    const nodes = layout.nodes.filter(n => n.cluster === cluster.id);
    const azimuths = new Set(nodes.map(n => Math.floor((Math.atan2(n.position[2], n.position[0]) + Math.PI) / (Math.PI * 2) * 12)));
    const radii = nodes.map(n => Math.hypot(n.position[0], n.position[2]));
    assert.ok(azimuths.size >= 10, 'each populous stream winds around the SAME disk');
    assert.ok(Math.max(...radii) - Math.min(...radii) > 7, 'streams span the annulus rather than separate balls');
  }
});

test('fixed reviewed populous streams have broad, irregular cross-sections rather than three narrow light rails', () => {
  const layout = buildLayout(distributionGraph);
  for (const cluster of layout.clusters.filter(c => c.count > 100)) {
    const nodes = layout.nodes.filter(n => n.cluster === cluster.id);
    // The threefold harmonic measures how tightly the actual source notes
    // collapse onto three evenly spaced spiral rails after unwinding the flow.
    const real = nodes.reduce((sum, n) => sum + Math.cos(3 * n.orbit.angle), 0) / nodes.length;
    const imaginary = nodes.reduce((sum, n) => sum + Math.sin(3 * n.orbit.angle), 0) / nodes.length;
    const coherence = Math.hypot(real, imaginary);
    assert.ok(coherence < 0.65, `${cluster.id}: narrow source rails create concentric lensed bands (${coherence})`);
    assert.ok(coherence > 0.08, 'streams retain direction rather than becoming uniform random dust');
  }
});

test('fixed reviewed source density concentrates inward in coherent, irregular streams with a sparse outer edge', () => {
  const layout = buildLayout(distributionGraph);
  const radius = node => Math.hypot(node.position[0], node.position[2]);
  const inner = layout.nodes.filter(node => radius(node) < 5.8).length;
  const outer = layout.nodes.filter(node => radius(node) > 9.5).length;
  assert.ok(inner > layout.nodes.length * 0.58, 'most actual notes, not added gas, form the inner light reservoir');
  assert.ok(outer < layout.nodes.length * 0.13, 'the outer edge is genuinely sparse, not uniformly populated at lower bloom');
  const rim = layout.nodes.filter(node => radius(node) < 3.8).length;
  assert.ok(rim < inner * 0.2, 'the inner reservoir has radial breadth instead of piling notes onto an infinitesimal bright rim');
  for (const cluster of layout.clusters.filter(c => c.count > 100)) {
    for (let bin = 0; bin < 5; bin++) {
      const nodes = layout.nodes.filter(n => n.cluster === cluster.id && Math.floor(n.orbit.phase * 5) === bin);
      const coherence = Math.hypot(
        nodes.reduce((sum, n) => sum + n.position[0] / radius(n), 0),
        nodes.reduce((sum, n) => sum + n.position[2] / radius(n), 0),
      ) / nodes.length;
      assert.ok(coherence > 0.68, `${cluster.id}/${bin}: neighboring radial phases share a stream, not uniform azimuthal dust (${coherence})`);
    }
  }
});

test('a singleton sector has a real star at its marker within the same disk', () => {
  const layout = buildLayout({ nodes: [{ id: 'n000001', cluster: 0 }], clusters: [{ id: 0, count: 1 }], edges: [] });
  assert.deepEqual(layout.nodes[0].position, layout.clusters[0].center);
});
