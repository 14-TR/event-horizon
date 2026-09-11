import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Group, DataUtils } from 'three';
import { BlackHoleRenderer } from '../src/black-hole.js';
import { buildLayout } from '../src/layout.js';
import { Observatory } from '../src/scene.js';
import { rayFragment } from '../src/black-hole-shaders.js';

test('picking rejects a real node behind composite depth but allows the same foreground star', () => {
  const view = Object.create(Observatory.prototype);
  view.graph = { clusters: [{ id: 0, count: 1 }], nodes: [{ id: 'n000001', cluster: 0 }], edges: [] };
  view.layout = buildLayout(view.graph);
  view.layout.nodes[0].position = [0, 0, -8];
  view.clusterObjects = new Map();
  view.orbital = new Group();
  view.camera = new PerspectiveCamera(48, 1, 0.1, 250);
  view.camera.position.set(0, 0, 30);
  view.camera.lookAt(0, 0, 0);
  view.camera.updateMatrixWorld(true);
  view.blackHole = new BlackHoleRenderer();
  view.blackHole.resize(200, 200, 3);
  view.renderer = {
    getPixelRatio: () => 1,
    domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
    readRenderTargetPixels: (target, x, y, width, height, buffer) => {
      assert.equal(x, 100); assert.equal(y, 100);
      buffer[3] = DataUtils.toHalfFloat(-29);
    },
  };
  view.addConstellations();
  view.orbital.updateMatrixWorld(true);
  assert.equal(view.pick(100, 100), null, 'shader-hidden notes must not be clickable');
  const node = view.layout.nodes[0];
  node.position[2] = 10;
  const points = view.clusterObjects.get(0).points;
  points.geometry.attributes.position.setXYZ(0, ...node.position);
  points.geometry.computeBoundingSphere();
  assert.equal(view.pick(100, 100)?.id, node.id, 'foreground stars remain pickable');
  view.blackHole.dispose();
});

test('gas structure has no periodic radial sine gratings', () => {
  const disk = rayFragment.slice(rayFragment.indexOf('vec4 disk('), rayFragment.indexOf('vec3 acceleration('));
  assert.doesNotMatch(disk, /sin\s*\(\s*r\s*\*/, 'radial sine bands look like woven wicker rather than gas');
  assert.match(rayFragment, /verticalProfile/, 'finite disk thickness must feather rather than expose a hard-edged slab');
});

test('observatory installs a bounded world-space ray renderer without decorative point layers', () => {
  const view = Object.create(Observatory.prototype);
  view.host = { clientWidth: 1440 };
  view.scene = new Scene();
  view.addBlackHole();
  assert.ok(view.blackHole?.anchor, 'world-space BlackHoleRenderer replaces the billboard');
  assert.equal(view.blackHole.uniforms.uDust?.value, 0, 'the note-disk is not covered by a procedural gas disk');
  assert.equal(view.addStars, undefined, 'no duplicate unlensed sky or orange dust');
  view.blackHole.resize(1440, 1000, 1.75);
  assert.ok(view.blackHole.target.width * view.blackHole.target.height <= 1100000);
  const camera = new PerspectiveCamera(48, 1.44, 0.1, 250);
  camera.position.set(0, 6, 28);
  camera.lookAt(0, 0, 0);
  view.blackHole.update(camera, 3);
  const fixed = view.blackHole.anchor.quaternion.clone();
  camera.position.set(20, 25, -12);
  view.blackHole.update(camera, 4);
  assert.ok(view.blackHole.anchor.quaternion.equals(fixed));
  view.blackHole.dispose();
});

test('actual moving point buffers carry white-gold inner light and subdued copper outer light', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseGraph } = await import('../src/graph.js');
  const { createInfall } = await import('../src/motion.js');
  const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
  const view = Object.create(Observatory.prototype);
  view.graph = graph; view.layout = buildLayout(graph); view.infall = createInfall(view.layout);
  view.clusterObjects = new Map(); view.orbital = new Group();
  view.renderer = { getPixelRatio: () => 1 };
  view.addConstellations();
  const initialSizes = [...view.clusterObjects.values()].map(({ points }) => points.geometry.attributes.aSize.array.slice());
  for (const time of [0, 8, 70, 192.1]) {
    view.updateInfall(time);
    const inner = [], outer = [];
    for (const { points } of view.clusterObjects.values()) {
      const colors = points.geometry.attributes.aColor;
      for (const [i, node] of points.userData.nodes.entries()) {
        const color = [colors.getX(i), colors.getY(i), colors.getZ(i)];
        assert.ok(color.every(v => Number.isFinite(v) && v > 0), 'no star is removed by a zero emission mask');
        const r = Math.hypot(node.position[0], node.position[2]);
        if (r < 5) inner.push(color);
        if (r > 9.5) outer.push(color);
      }
    }
    const mean = (colors, channel) => colors.reduce((sum, color) => sum + color[channel], 0) / colors.length;
    assert.ok(mean(inner, 0) > mean(outer, 0) * 3, 'the actual source radiance concentrates inward, not just postprocess glow');
    assert.ok(mean(inner, 2) / mean(inner, 0) > 0.65, 'white-gold inner stars');
    assert.ok(mean(outer, 1) / mean(outer, 0) < 0.5, 'copper outer stars');
    assert.ok(mean(outer, 2) / mean(outer, 0) < 0.25, 'outer light is not equally white');
  }
  assert.deepEqual([...view.clusterObjects.values()].map(({ points }) => points.geometry.attributes.aSize.array), initialSizes, 'stellar size identity survives motion and recycling');
  for (const { points, line } of view.clusterObjects.values()) {
    points.geometry.dispose(); points.material.dispose(); line.geometry.dispose(); line.material.dispose();
  }
});

test('all quality levels build a one-to-one GPU point buffer for the entire actual graph', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseGraph } = await import('../src/graph.js');
  const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
  const snapshot = structuredClone(graph);
  for (const quality of ['mobile', 'desktop', 'cinematic']) {
    const view = Object.create(Observatory.prototype);
    view.quality = quality;
    view.graph = graph; view.layout = buildLayout(graph);
    view.host = { dataset: {} };
    view.clusterObjects = new Map(); view.orbital = new Group();
    view.renderer = { getPixelRatio: () => 1 };
    view.addConstellations();
    const drawn = [...view.clusterObjects.values()].flatMap(({ points, glow }) => {
      assert.ok(glow?.isMesh, 'actual notes also supply flow-aligned finite light envelopes, not a separate procedural gas disk');
      assert.equal(glow.geometry.instanceCount, points.userData.nodes.length);
      assert.equal(glow.geometry.attributes.aPosition.array, points.geometry.attributes.position.array, 'envelopes borrow live actual positions');
      assert.equal(glow.geometry.attributes.aEmission.array, points.geometry.attributes.aColor.array, 'envelopes borrow actual radial emission');
      assert.equal(glow.geometry.attributes.aSize.array, points.geometry.attributes.aSize.array, 'envelopes share the actual stellar hierarchy');
      assert.equal(glow.userData.nodes, undefined, 'light envelopes do not own duplicate node identities');
      assert.ok(glow.parent === points, 'hiding/removing a source also hides/removes its light envelope');
      assert.equal(points.geometry.attributes.position.count, points.userData.nodes.length);
      assert.deepEqual(points.geometry.attributes.position.array, new Float32Array(points.userData.nodes.flatMap(n => n.position)), 'every GPU point is at its actual node coordinate');
      return points.userData.nodes.map(n => n.id);
    });
    assert.deepEqual(drawn.sort(), graph.nodes.map(n => n.id).sort());
    assert.equal(new Set(drawn).size, 1675);
    const sizes = [...view.clusterObjects.values()].flatMap(({ points }) => [...points.geometry.attributes.aSize.array]);
    assert.ok(new Set(sizes.map(size => size.toFixed(2))).size > 80, 'the actual stars need a continuous luminosity hierarchy, not two identical bead sizes');
    assert.ok(sizes.every(size => size >= 2.5 && size <= 16), 'every note retains a nonzero, bounded direct/captured footprint');
    const rankedSizes = sizes.toSorted((a, b) => a - b);
    assert.ok(rankedSizes[Math.floor(sizes.length * 0.75)] < 6, 'most actual stars are fine-grained, not equally prominent beads');
    assert.ok(rankedSizes[Math.floor(sizes.length * 0.95)] > 10, 'rare bright stars lead the hierarchy');
    assert.ok(sizes.filter(size => size > 10).length < sizes.length * 0.1, 'large stellar cores are genuinely rare');
    assert.equal(view.host.dataset.noteStars, '1675', 'expose the actual buffer population, not a promised count');
    for (const { points, line } of view.clusterObjects.values()) {
      points.geometry.dispose(); points.material.dispose(); line.geometry.dispose(); line.material.dispose();
    }
  }
  assert.deepEqual(graph, snapshot, 'no quality preset changes valid topology');
});
