import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout } from '../src/layout.js';
import { createInfall } from '../src/motion.js';

const graph = { clusters: [{ id: 0, count: 240 }], nodes: Array.from({ length: 240 }, (_, i) => ({ id: `n${String(i + 1).padStart(6, '0')}`, cluster: 0 })), edges: [] };

test('short trails follow only actual stars within a modest mobile budget and freeze with time', async () => {
  const { StarTrails } = await import('../src/star-trails.js').catch(() => ({}));
  assert.equal(typeof StarTrails, 'function', 'bounded actual-star trail history exists');
  const layout = buildLayout(graph), infall = createInfall(layout);
  const trails = new StarTrails(layout, 'mobile');
  assert.ok(trails.entries.length <= 96);
  assert.ok(trails.entries.every(entry => layout.nodes.includes(entry.node)));
  for (let i = 0; i <= 6; i++) { infall(i * 0.06); trails.update(i * 0.06); }
  assert.ok(trails.mesh.geometry.drawRange.count > 0);
  assert.ok(trails.mesh.geometry.drawRange.count <= 96 * 4 * 2);
  const before = trails.mesh.geometry.attributes.position.array.slice();
  trails.update(0.36);
  assert.deepEqual(trails.mesh.geometry.attributes.position.array, before, 'pause does not grow or fade trails');
  for (const entry of trails.entries) assert.ok(entry.history.length <= 5);
  assert.equal(trails.mesh.material.depthTest, true);
  assert.equal(trails.mesh.material.depthWrite, false);
  trails.dispose();
});

test('recycling, discontinuous clocks and reset never connect unrelated trail positions', async () => {
  const { StarTrails } = await import('../src/star-trails.js');
  const layout = buildLayout(graph), infall = createInfall(layout);
  const trails = new StarTrails(layout, 'desktop');
  for (const time of [41.82, 41.88, 41.94, 41.99, 42]) { infall(time); trails.update(time); }
  assert.ok(trails.entries.every(entry => entry.history.length === 1), 'sector cycle clears every previous orbit position');
  for (const time of [42.06, 42.12]) { infall(time); trails.update(time); }
  assert.ok(trails.mesh.geometry.drawRange.count > 0);
  infall(3); trails.update(3);
  assert.equal(trails.mesh.geometry.drawRange.count, 0, 'a backwards clock clears history');
  infall(3.06); trails.update(3.06);
  trails.reset();
  assert.equal(trails.mesh.geometry.drawRange.count, 0, 'Reset view clears residual streaks even while paused');
  trails.dispose();
});
