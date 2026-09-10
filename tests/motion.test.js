import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout } from '../src/layout.js';
import * as THREE from 'three';
import { Observatory } from '../src/scene.js';
import { createInfall } from '../src/motion.js';

const graph = {
  clusters: [{ id: 0, count: 2 }],
  nodes: [{ id: 'n000001', cluster: 0 }, { id: 'n000002', cluster: 0 }],
  edges: [['n000001', 'n000002']],
};

test('actual note coordinates spiral inward in three dimensions and recycle without losing topology', async () => {
  const { createInfall } = await import('../src/motion.js').catch(() => ({}));
  assert.equal(typeof createInfall, 'function', 'time-driven note infall is implemented');
  const layout = buildLayout(graph);
  const initial = structuredClone(layout.nodes);
  const update = createInfall(layout);
  update(8);
  for (const [i, node] of layout.nodes.entries()) {
    assert.equal(node.id, initial[i].id);
    assert.equal(node.cluster, initial[i].cluster);
    assert.ok(Math.hypot(...node.position) < Math.hypot(...initial[i].position) - 1);
    assert.ok(node.position.every((v, axis) => v !== initial[i].position[axis]));
    const [x, y] = initial[i].position;
    assert.ok(Math.abs(x * node.position[1] - y * node.position[0]) > 1, 'infall turns rather than only shrinking');
  }
  const atEight = structuredClone(layout);
  update(8);
  assert.deepEqual(layout, atEight, 'a frozen simulation clock freezes positions');
  update(42);
  assert.deepEqual(layout.nodes, initial, 'the same anonymous notes reappear after a visual cycle');
  update(42008);
  assert.ok(layout.nodes.every(node => node.position.every(Number.isFinite)));
  assert.equal(layout.nodes.length, graph.nodes.length);
  assert.deepEqual(graph.edges, [['n000001', 'n000002']]);
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
