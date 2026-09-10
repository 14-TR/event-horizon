import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/graph.js';
import { buildLayout } from '../src/layout.js';

const raw = JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url)));

test('every actual note maps exactly once into a shared thin 3D spiral disk, not detached clouds', () => {
  const graph = parseGraph(raw), before = structuredClone(graph);
  const layout = buildLayout(graph);
  assert.deepEqual(layout, buildLayout(graph), 'deterministic placement');
  assert.equal(graph.nodes.length, 1675, 'verify the actual reviewed topology, not a small fixture');
  assert.deepEqual(layout.nodes.map(n => n.id).sort(), graph.nodes.map(n => n.id).sort());
  assert.equal(new Set(layout.nodes.map(n => n.id)).size, graph.nodes.length);
  assert.equal(new Set(layout.clusters.map(c => c.color)).size, graph.clusters.length);
  for (const node of layout.nodes) {
    const [x, y, z] = node.position, r = Math.hypot(x, z);
    assert.ok(node.position.every(Number.isFinite));
    assert.ok(r >= 3.6 && r <= 12, `${node.id} is in the stellar accretion annulus outside the horizon`);
    assert.ok(Math.abs(y) < 0.65, 'disk thickness is bounded, not a cloud');
    assert.equal(node.cluster, graph.nodes.find(n => n.id === node.id).cluster);
  }
  assert.ok(new Set(layout.nodes.map(n => Math.round(n.position[1] * 100))).size > 30, 'true depth, not a flat plane');
  for (const cluster of layout.clusters.filter(c => c.count > 100)) {
    const nodes = layout.nodes.filter(n => n.cluster === cluster.id);
    const azimuths = new Set(nodes.map(n => Math.floor((Math.atan2(n.position[2], n.position[0]) + Math.PI) / (Math.PI * 2) * 12)));
    const radii = nodes.map(n => Math.hypot(n.position[0], n.position[2]));
    assert.ok(azimuths.size >= 10, 'each populous stream winds around the SAME disk');
    assert.ok(Math.max(...radii) - Math.min(...radii) > 7, 'streams span the annulus rather than separate balls');
  }
  assert.deepEqual(graph, before, 'the full valid graph remains unchanged');
});

test('populous streams have broad, irregular cross-sections rather than three narrow light rails', () => {
  const layout = buildLayout(parseGraph(raw));
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

test('a singleton sector has a real star at its marker within the same disk', () => {
  const layout = buildLayout({ nodes: [{ id: 'n000001', cluster: 0 }], clusters: [{ id: 0, count: 1 }], edges: [] });
  assert.deepEqual(layout.nodes[0].position, layout.clusters[0].center);
});
