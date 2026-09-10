import test from 'node:test';
import assert from 'node:assert/strict';

const load = async () => import('../src/layout.js').catch(() => ({}));

test('lays out repeatable separated 3D constellations beyond the accretion disk', async () => {
  const { buildLayout } = await load();
  assert.equal(typeof buildLayout, 'function', 'orbital layout is implemented');
  const graph = {
    clusters: Array.from({ length: 8 }, (_, id) => ({ id, label: `Sector ${id}`, count: 12 })),
    nodes: Array.from({ length: 96 }, (_, i) => ({ id: `n${String(i + 1).padStart(6, '0')}`, cluster: i % 8 })),
    edges: [['n000001', 'n000009']],
  };
  const layout = buildLayout(graph);
  assert.deepEqual(layout, buildLayout(graph));
  assert.equal(layout.clusters.length, 8);
  assert.equal(layout.nodes.length, 96);
  assert.ok(layout.nodes.every(node => node.position.length === 3 && node.position.every(Number.isFinite)));
  assert.ok(layout.clusters.every(cluster => Math.hypot(...cluster.center) > 12));
  assert.ok(layout.nodes.every(node => Math.hypot(...node.position) > 10));
  assert.equal(new Set(layout.clusters.map(cluster => cluster.color)).size, 8);
});

test('a singleton sector has a visible star exactly at its orbital marker', async () => {
  const { buildLayout } = await load();
  const layout = buildLayout({ nodes: [{ id: 'n000001', cluster: 0 }], clusters: [{ id: 0, count: 1 }], edges: [] });
  assert.deepEqual(layout.nodes[0].position, layout.clusters[0].center);
});
