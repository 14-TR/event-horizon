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
