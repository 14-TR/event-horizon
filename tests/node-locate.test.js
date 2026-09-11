import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { locateRegion, nodeFrame, travelPosition } from '../src/node-locate.js';
import { buildLayout } from '../src/layout.js';
import { createInfall } from '../src/motion.js';
import { parseGraph } from '../src/graph.js';

test('safe-rectangle framing covers every real note at two animation phases and portrait/desktop aspects', () => {
  const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
  const layout = buildLayout(graph), update = createInfall(layout);
  let checked = 0;
  for (const [width, height, rect] of [
    [320, 568, { left: 16, top: 100, width: 288, height: 238 }],
    [1440, 1000, { left: 32, top: 100, width: 990, height: 800 }],
  ]) {
    const camera = new PerspectiveCamera(48, width / height, 0.1, 250);
    camera.up.set(0.1, 1, 0).normalize();
    const region = locateRegion(rect, width, height);
    for (const time of [0, 42]) {
      update(time);
      for (const node of layout.nodes) {
        const point = new Vector3(...node.position), frame = nodeFrame(point, camera, region);
        camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld();
        const projected = point.clone().project(camera);
        assert.ok(Math.abs(projected.x - region.x) < 1e-10 && Math.abs(projected.y - region.y) < 1e-10);
        assert.ok(projected.z > -1 && projected.z < 1);
        assert.ok(camera.position.dot(point) > point.lengthSq(), 'the source lies in front of the hole, not beyond it');
        checked++;
      }
    }
  }
  assert.equal(checked, graph.nodes.length * 4);
});

test('malformed/outside rectangles fall back to centered framing and clipping retains valid intersections', () => {
  for (const rect of [null, {}, { left: NaN, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: -1, height: 10 }, { left: 900, top: 0, width: 10, height: 10 }]) {
    assert.deepEqual(locateRegion(rect, 320, 568), { x: 0, y: 0 });
  }
  const region = locateRegion({ left: -20, top: -10, width: 200, height: 200 }, 320, 568);
  assert.equal(region.x, 180 / 320 - 1);
  assert.equal(region.y, 1 - 190 / 568);
});

test('opposite-side camera journeys are finite, exactly arrive and never cross the horizon', () => {
  const from = new Vector3(0, 0, 20), to = new Vector3(0, 0, -18), output = new Vector3();
  for (let step = 0; step <= 100; step++) {
    travelPosition(from, to, step / 100, output);
    assert.ok(output.toArray().every(Number.isFinite));
    assert.ok(output.length() >= 18 && output.length() <= 26);
  }
  assert.ok(output.distanceTo(to) < 1e-10);
  travelPosition(from, to, 0, output); assert.ok(output.equals(from));
});
