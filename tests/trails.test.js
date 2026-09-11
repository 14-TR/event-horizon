import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/graph.js';
import { buildLayout, DISK, diskPosition } from '../src/layout.js';
import { createInfall } from '../src/motion.js';
import { StarTrails } from '../src/star-trails.js';

const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));

test('every real note supplies bounded stellar light trails even in the initial reduced-motion disk', () => {
  for (const [quality, segments] of [['mobile', 3], ['desktop', 5], ['cinematic', 7]]) {
    const layout = buildLayout(graph), infall = createInfall(layout);
    const trails = new StarTrails(layout, quality);
    assert.equal(trails.entries.length, graph.nodes.length, 'quality changes trail detail, never note coverage');
    assert.equal(new Set(trails.entries.map(entry => entry.node.id)).size, 1675);
    assert.ok(trails.entries.every(entry => layout.nodes.includes(entry.node)));
    infall(0); trails.update(0);
    assert.ok(trails.mesh.geometry.drawRange.count > 1675, 'frozen opening has true orbital exposure, not sparse points');
    assert.ok(trails.mesh.geometry.drawRange.count <= 1675 * segments * 2);
    const before = trails.mesh.geometry.attributes.position.array.slice();
    trails.update(0);
    assert.deepEqual(trails.mesh.geometry.attributes.position.array, before, 'pause does not grow or fade trails');
    for (const entry of trails.entries) assert.ok(entry.history.length <= segments);
    assert.equal(trails.mesh.material.depthTest, true);
    assert.equal(trails.mesh.material.depthWrite, false);
    trails.dispose();
  }
});

test('stellar exposures stay shorter than half a second instead of joining into luminous wires', () => {
  const layout = buildLayout(graph), infall = createInfall(layout), trails = new StarTrails(layout);
  const time = 8;
  infall(time); trails.update(time);
  for (const entry of trails.entries) {
    if (!entry.history.length || Math.floor(entry.node.orbit.phase - time / DISK.period) !== Math.floor(entry.node.orbit.phase - (time - 0.5) / DISK.period)) continue;
    const limit = diskPosition(entry.node.orbit, time - 0.5);
    const last = entry.history.at(-1);
    assert.ok(Math.hypot(last[0], last[2]) <= Math.hypot(limit[0], limit[2]) + 1e-7, 'no real-note exposure exceeds half a second');
  }
  assert.ok(trails.mesh.material.opacity <= 0.4, 'the luminous stars lead; trails do not become continuous wire rails');
  trails.dispose();
});

test('micro-exposures never reveal long orbital rails at any quality or simulation age', () => {
  for (const quality of ['mobile', 'desktop', 'cinematic']) {
    const layout = buildLayout(graph), infall = createInfall(layout), trails = new StarTrails(layout, quality);
    for (const time of [0, 8, 96, 42008, -1]) {
      infall(time); trails.update(time);
      const lengths = [];
      for (const entry of trails.entries) {
        assert.ok(entry.exposure >= 0.03 && entry.exposure <= 0.12, 'short ID-stable exposure, not a half-second wire');
        let from = entry.node.position, length = 0;
        for (const to of entry.history) {
          length += Math.hypot(...to.map((v, axis) => v - from[axis])); from = to;
        }
        lengths.push(length);
        assert.ok(length <= 0.24, 'world-length bound matters as well as exposure time');
      }
      lengths.sort((a, b) => a - b);
      assert.ok(lengths[Math.floor(lengths.length * 0.95)] < 0.16, 'the typical trail is a compact glint, not orbit scaffolding');
    }
    trails.dispose();
  }
});

test('per-note recycling truncates exposure without connecting inner and outer radii', () => {
  const layout = buildLayout(graph), infall = createInfall(layout), trails = new StarTrails(layout);
  const note = layout.nodes[40], wrap = note.orbit.phase * DISK.period;
  infall(wrap + 0.02); trails.update(wrap + 0.02);
  const recycled = trails.entries.find(entry => entry.node.id === note.id);
  assert.ok(recycled.history.length < trails.segments, 'the short post-wrap exposure is truncated');
  assert.ok(recycled.history.every(p => Math.hypot(p[0], p[2]) > 11), 'no exposure point belongs to the previous inner lap');
  for (const time of [wrap - 0.02, wrap + 0.02, 96, 42008, 3]) {
    infall(time); trails.update(time);
    for (const entry of trails.entries) {
      let previous = entry.node.position, length = 0;
      for (const p of entry.history) {
        length += Math.hypot(...p.map((v, axis) => v - previous[axis]));
        assert.ok(Math.hypot(p[0], p[2]) >= DISK.inner);
        assert.ok(length <= trails.maxLength + 1e-6, 'bounded length, even across a wrap or clock jump');
        previous = p;
      }
    }
    const positions = trails.mesh.geometry.attributes.position.array;
    for (let i = 0; i < trails.mesh.geometry.drawRange.count * 3; i += 6) {
      assert.ok(Math.hypot(positions[i] - positions[i + 3], positions[i + 1] - positions[i + 4], positions[i + 2] - positions[i + 5]) < 1, 'never a bridge across the disk');
    }
  }
  trails.selectedCluster = 0; trails.reset();
  assert.equal(trails.mesh.geometry.drawRange.count, 0, 'Reset clears the exposure while paused');
  infall(3.06); trails.update(3.06);
  assert.ok(trails.mesh.geometry.drawRange.count <= graph.clusters[0].count * 5 * 2, 'isolation includes only the selected stream');
  trails.dispose();
});
