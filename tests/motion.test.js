import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, DISK } from '../src/layout.js';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/graph.js';
import * as THREE from 'three';
import { Observatory } from '../src/scene.js';
import { createInfall } from '../src/motion.js';

const graph = {
  clusters: [{ id: 0, count: 2 }],
  nodes: [{ id: 'n000001', cluster: 0 }, { id: 'n000002', cluster: 0 }],
  edges: [['n000001', 'n000002']],
};

test('all actual notes rotate inward inside the same thin disk and recycle individually without losing topology', () => {
  const actual = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
  const before = structuredClone(actual), layout = buildLayout(actual), update = createInfall(layout);
  update(0);
  const initial = structuredClone(layout.nodes);
  const references = [...layout.nodes];
  update(8);
  let wrapped = 0;
  for (const [i, node] of layout.nodes.entries()) {
    assert.equal(node, references[i], 'never replace or remove the actual node');
    const r = n => Math.hypot(n.position[0], n.position[2]);
    if (node.cycle !== initial[i].cycle) { wrapped++; assert.ok(r(node) > r(initial[i])); }
    else assert.ok(r(node) < r(initial[i]), 'each non-recycling note travels inward');
    assert.ok(node.position.every((v, axis) => v !== initial[i].position[axis]), 'motion is truly 3D');
  }
  assert.ok(wrapped > 0 && wrapped < actual.nodes.length / 5, 'staggered recycling never empties a stream');
  const atEight = structuredClone(layout);
  update(8);
  assert.deepEqual(layout, atEight, 'a frozen simulation clock freezes positions');
  for (const time of [24, 42, 70, 96, 192.1, 42008, -1]) {
    update(time);
    assert.equal(layout.nodes.length, 1675);
    for (const node of layout.nodes) {
      const [x, y, z] = node.position;
      assert.ok(node.position.every(Number.isFinite));
      assert.ok(Math.hypot(x, z) >= DISK.inner && Math.hypot(x, z) <= DISK.outer);
      assert.ok(Math.abs(y) < 0.65, 'no inflating clouds or vertical escape during infall');
    }
    const azimuths = new Set(layout.nodes.map(n => Math.floor((Math.atan2(n.position[2], n.position[0]) + Math.PI) * 6 / Math.PI)));
    assert.equal(azimuths.size, 12, 'the disk stays populated around its entire circumference');
  }
  assert.deepEqual(actual, before, 'IDs, full links and membership remain unchanged');
});

test('drawn stars, real edge endpoints, picking and sector centers share the moving coordinates', () => {
  const observatory = Object.create(Observatory.prototype);
  observatory.graph = graph;
  observatory.layout = buildLayout(graph);
  observatory.infall = createInfall(observatory.layout);
  observatory.clusterObjects = new Map();
  observatory.orbital = new THREE.Group();
  observatory.renderer = { getPixelRatio: () => 1, domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } };
  observatory.addConstellations();
  assert.equal(typeof observatory.updateInfall, 'function', 'moving geometry is synchronized');
  observatory.updateInfall(8);
  observatory.orbital.updateMatrixWorld(true);
  const { points, line, cluster } = observatory.clusterObjects.get(0);
  const expected = new Float32Array(observatory.layout.nodes.flatMap(node => node.position));
  assert.deepEqual(points.geometry.attributes.position.array, expected);
  assert.deepEqual(line.geometry.attributes.position.array, expected, 'links end on their actual moving nodes');
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(cluster.center[axis], (observatory.layout.nodes[0].position[axis] + observatory.layout.nodes[1].position[axis]) / 2);
  }
  const node = observatory.layout.nodes[0];
  observatory.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 250);
  observatory.camera.position.set(node.position[0], node.position[1], node.position[2] + 10);
  observatory.camera.lookAt(new THREE.Vector3(...node.position));
  observatory.camera.updateMatrixWorld(true);
  assert.equal(observatory.pick(500, 500)?.id, node.id, 'raycasting follows the moved star');
});

test('Orbit follows an isolated moving sector without moving a free-flight camera', () => {
  const observatory = Object.create(Observatory.prototype);
  observatory.layout = buildLayout(graph);
  observatory.infall = createInfall(observatory.layout);
  observatory.clusterObjects = new Map();
  observatory.updateInfall(0);
  observatory.selectedCluster = 0;
  observatory.navigationMode = 'orbit';
  observatory.camera = new THREE.PerspectiveCamera();
  observatory.camera.position.set(0, 0, 40);
  observatory.controls = { target: new THREE.Vector3(...observatory.layout.clusters[0].center) };
  const offset = observatory.camera.position.clone().sub(observatory.controls.target);
  observatory.updateInfall(8);
  assert.ok(observatory.controls.target.distanceTo(new THREE.Vector3(...observatory.layout.clusters[0].center)) < 1e-8, 'isolated sector stays centered as it falls');
  assert.ok(observatory.camera.position.clone().sub(observatory.controls.target).distanceTo(offset) < 1e-8);
  observatory.navigationMode = 'fly';
  const position = observatory.camera.position.clone();
  observatory.updateInfall(12);
  assert.deepEqual(observatory.camera.position, position, 'Fly is independent of selected stars');
});
