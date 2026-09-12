import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Observatory, openingFrame } from '../src/scene.js';
import { buildLayout, DISK } from '../src/layout.js';
import { createInfall } from '../src/motion.js';
import { validateTopology as parseGraph, connectedPair } from './topology.js';

const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
const pair = connectedPair(graph);

test('Locate flushes residual orbit damping and reduced-motion/pausing settles the live target immediately', () => {
  const view = makeView(390, 844, false), id = pair.id;
  view.controls = new OrbitControls(view.camera, null);
  view.controls.target.copy(view.homeTarget);
  view.controls.enableDamping = true;
  view.controls._sphericalDelta.theta = 0.5;
  view.controls.update();
  view.motionQuery = { matches: true };
  view.locateNode(id);
  assert.equal(view.flight, null, 'reduced motion is immediate even if caller did not pause the sky');
  const located = view.camera.position.clone();
  for (let i = 0; i < 20; i++) view.controls.update();
  assert.ok(view.camera.position.distanceTo(located) < 1e-8, 'old orbit damping cannot undo Locate');
  view.motionQuery.matches = false;
  view.locateNode(id);
  assert.ok(view.flight);
  view.updateInfall(1);
  view.setPaused(true);
  assert.equal(view.flight, null);
  const point = screen(view, view.layout.nodes.find(node => node.id === id));
  assert.ok(Math.abs(point.x - 195) < 1e-6 && Math.abs(point.y - 422) < 1e-6, 'pausing during transit finishes rather than stranding it');
  view.setNavigationMode('fly');
  view.locateNode(id);
  assert.equal(view.locating, null, 'completed Fly locate releases tracking so thrust is immediately independent');
});
test('a followed note recycling restarts a bounded transit instead of teleporting the camera', () => {
  const view = makeView(390, 844, false), id = pair.id;
  view.locateNode(id);
  view.updateNavigation(view.flight.start + 1300);
  const before = view.camera.position.clone();
  view.updateInfall(96);
  view.updateNavigation(performance.now());
  assert.ok(view.flight, 'identity-preserving node recycle must not become a camera teleport');
  assert.ok(view.camera.position.distanceTo(before) < 1e-6);
  view.updateNavigation(view.flight.start + 1300);
  assert.equal(view.flight, null);
  inside(screen(view, view.layout.nodes.find(node => node.id === id)), { left: 1, top: 1, width: 388, height: 842 });
});

test('renderer failure and disposal stop navigation, clear context and dispose the overlay once', () => {
  const view = makeView(390, 844, false);
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  view.onUnavailable = () => {};
  view.observer = { disconnect() {} };
  view.pointerAbort = new AbortController();
  view.controls.dispose = () => {};
  view.diskRadiance = view.noteLight = { dispose() {} };
  view.blackHole.dispose = () => {};
  view.renderer.dispose = () => {};
  view.renderer.domElement = { remove() {} };
  view.scene = new THREE.Scene(); view.scene.add(view.orbital);
  try {
    view.selectNode(pair.id);
    view.setConnectionContext(pair.id);
    view.locateNode(pair.id);
    let geometries = 0, materials = 0;
    view.connections.line.geometry.addEventListener('dispose', () => geometries++);
    view.connections.line.material.addEventListener('dispose', () => materials++);
    view.unavailable();
    assert.equal(view.locating, null, 'failure must stop automatic tracking');
    assert.equal(view.connections.line.visible, false);
    assert.equal(view.locateNode(pair.id), false);
    assert.deepEqual(view.setConnectionContext(pair.id), { id: null, neighborId: null, rendered: 0, displayed: 0, total: 0 });
    view.dispose(); view.dispose();
    assert.equal(geometries, 1);
    assert.equal(materials, 1);
    assert.equal(view.pointerAbort.signal.aborted, true);
    assert.equal(view.host.dataset.connectionRendered, '0');
  } finally {
    if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancel;
  }
});

test('Locate uses edge safe rectangles for selected reticles but rejects a zero-sized viewport', () => {
  const view = makeView(320, 568), node = view.layout.nodes.find(n => n.id === pair.neighborId);
  const rect = { left: 202, top: 10, width: 100, height: 40 };
  view.locateNode(node.id, { safeRect: rect });
  inside(view.project(node.position, true), rect);
  view.host.clientWidth = 0;
  const before = view.camera.position.clone();
  assert.equal(view.locateNode(node.id), false, 'a hidden host has no usable view');
  assert.ok(view.camera.position.equals(before));
});

function makeView(width = 1440, height = 1000, paused = true) {
  const view = Object.create(Observatory.prototype);
  Object.assign(view, { graph, layout: buildLayout(graph), host: { clientWidth: width, clientHeight: height, dataset: {} }, paused, time: 0, navigationMode: 'orbit', clusterObjects: new Map(), orbital: new THREE.Group() });
  view.infall = createInfall(view.layout);
  view.renderer = { getPixelRatio: () => 1 };
  view.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 250);
  const opening = openingFrame(width, height);
  view.homePosition = new THREE.Vector3(...opening.position);
  view.homeTarget = new THREE.Vector3(...opening.target);
  view.camera.position.copy(view.homePosition);
  view.camera.up.fromArray(opening.up).normalize();
  view.controls = { target: view.homeTarget.clone(), update() { view.camera.lookAt(this.target); view.camera.updateMatrixWorld(); }, reset() {}, enableDamping: !paused };
  view.flyControls = { keys: new Set(), thrust: new Set(), clear() { this.keys.clear(); this.thrust.clear(); }, setEnabled() {}, update() {}, dispose() {} };
  view.controls.update();
  view.addConstellations();
  view.trails = { reset() {}, update() {}, entries: [], mesh: { geometry: { drawRange: { count: 0 } } } };
  view.updateInfall(0);
  view.blackHole = { isOccluded: () => false };
  return view;
}

function screen(view, node) { return view.project(node.position); }
function inside(point, rect) {
  assert.ok(point.visible, `source must project visibly: ${JSON.stringify(point)}`);
  assert.ok(point.x > rect.left && point.x < rect.left + rect.width, 'horizontal source framing');
  assert.ok(point.y > rect.top && point.y < rect.top + rect.height, 'vertical source framing');
}

test('paused Locate frames the actual animated destination inside mobile and desktop safe rectangles', () => {
  assert.equal(typeof Observatory.prototype.locateNode, 'function', 'scene needs true-node locating');
  for (const [width, height, rect] of [
    [1440, 1000, { left: 360, top: 120, width: 1040, height: 800 }],
    [390, 844, { left: 12, top: 86, width: 366, height: 370 }],
    [320, 740, { left: 12, top: 84, width: 296, height: 290 }],
  ]) {
    const view = makeView(width, height);
    view.updateInfall(8);
    const node = view.layout.nodes.find(node => node.id === pair.id);
    assert.equal(view.locateNode(node.id, { safeRect: rect }), true);
    inside(screen(view, node), rect);
    assert.equal(view.flight, null, 'paused navigation is immediate');
    assert.equal(view.selectedCluster, undefined, 'locate does not silently alter sector visibility');
    assert.equal(view.selectedNode, undefined, 'UI retains selection ownership');
  }
});

test('cinematic Locate arcs outside the hole and lands on the moving source rather than its departure position', () => {
  const view = makeView(390, 844, false);
  const node = view.layout.nodes.find(node => node.id === pair.id);
  const rect = { left: 12, top: 86, width: 366, height: 370 };
  // Start safely after this note's wrap; recycling has its own transit test above.
  const simulationStart = node.orbit.phase * DISK.period + 1;
  view.updateInfall(simulationStart);
  const cycle = node.cycle, departure = [...node.position];
  const before = view.camera.position.clone();
  view.locateNode(node.id, { safeRect: rect });
  assert.ok(view.flight, 'unpaused locate must travel, not teleport');
  assert.deepEqual(view.camera.position, before);
  const { start } = view.flight;
  for (let tick = 1; tick <= 18; tick++) {
    view.updateInfall(simulationStart + tick / 20);
    assert.equal(node.cycle, cycle, 'this moving-source transit must not recycle');
    view.updateNavigation(start + tick * 50);
    assert.ok(view.camera.position.length() >= 4, 'transition never tunnels through the horizon');
    assert.ok(view.camera.position.toArray().every(Number.isFinite));
  }
  assert.equal(view.flight, null);
  assert.notDeepEqual(node.position, departure, 'source must move during transit');
  inside(screen(view, node), rect);
  view.updateInfall(simulationStart + 3);
  assert.equal(node.cycle, cycle, 'continued tracking must not recycle');
  view.updateNavigation(start + 3000);
  inside(screen(view, node), rect);
});

test('selected context shows only bounded genuine incident edges including the requested cross-sector neighbor', () => {
  const view = makeView();
  assert.equal(typeof view.setConnectionContext, 'function', 'selected real relationships need a scene API');
  const id = pair.id, neighborId = pair.neighborId;
  const hub = view.layout.nodes.find(node => node.id === id);
  view.selectCluster(hub.cluster);
  const visibility = [...view.clusterObjects.values()].map(({ group }) => group.visible);
  const result = view.setConnectionContext(id, neighborId);
  const neighbors = new Set(graph.edges.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []));
  assert.equal(result.total, neighbors.size);
  assert.equal(result.rendered, Math.min(12, neighbors.size), 'the preview stays bounded independently of the current hub degree');
  assert.equal(result.displayed, result.rendered, 'UI count alias describes the same bounded draw');
  assert.equal(result.neighborId, neighborId);
  const overlay = view.connections;
  assert.equal(overlay.line.geometry.drawRange.count, result.rendered * 2);
  assert.ok(overlay.neighbors.some(node => node.id === neighborId));
  for (const node of overlay.neighbors) assert.ok(neighbors.has(node.id), 'not an inferred proximity edge');
  assert.deepEqual([...view.clusterObjects.values()].map(({ group }) => group.visible), visibility, 'cross-sector context never reveals an entire hidden sector');
  assert.ok([...view.clusterObjects.values()].every(({ line }) => !line.visible), 'no sector-wide decorative web');
  assert.equal(view.host.dataset.connectionTotal, String(neighbors.size));
  assert.equal(view.host.dataset.connectionRendered, String(Math.min(12, neighbors.size)));
  assert.equal(view.visibleEdgeCount, Math.min(12, neighbors.size), 'reported visible edges mean the actual overlay draw budget');
  const hits = [];
  overlay.line.raycast(new THREE.Raycaster(), hits);
  assert.deepEqual(hits, [], 'overlays never intercept picking');
  assert.equal(overlay.line.userData.nodes, undefined, 'overlay has no fake source-star identities');
  view.updateInfall(8);
  const expected = new Float32Array(overlay.neighbors.flatMap(node => [...hub.position, ...node.position]));
  assert.deepEqual(overlay.line.geometry.attributes.position.array.slice(0, expected.length), expected, 'all endpoints track actual animated nodes');
  assert.equal(view.host.dataset.noteStars, String(graph.nodes.length));
});

test('manual navigation cancellation relinquishes live tracking and selection/sector changes clear stale context', () => {
  const view = makeView(390, 844, false), id = pair.id;
  view.selectNode(id);
  view.setConnectionContext(id);
  view.locateNode(id);
  assert.equal(typeof view.cancelNavigation, 'function', 'manual input needs one cancellation path');
  view.cancelNavigation();
  const stopped = view.camera.position.clone();
  view.updateInfall(2);
  view.updateNavigation(performance.now() + 2000);
  assert.deepEqual(view.camera.position, stopped, 'cancel means no follow or delayed teleport');
  assert.equal(view.flight, null);
  assert.equal(view.locating, null);
  view.locateNode(id);
  view.selectNode(pair.neighborId);
  assert.equal(view.flight, null);
  assert.equal(view.connections.line.visible, false);
  assert.equal(view.host.dataset.connectionTotal, '0');
  view.setConnectionContext(pair.neighborId);
  view.locateNode(pair.neighborId);
  view.selectCluster(null);
  assert.equal(view.locating, null);
  assert.equal(view.connections.line.visible, false);
  assert.ok(view.camera.position.equals(view.homePosition));
  const node = view.layout.nodes.find(node => node.id === id);
  view.selectCluster(node.cluster);
  assert.equal(view.locateNode(pair.neighborId), false, 'a hidden sector is not silently revealed');
  assert.equal(view.locateNode(` ${pair.id}`), false, 'identifiers are never repaired');
  view.locateNode(id);
  view.setNavigationMode('fly');
  assert.equal(view.locating, null);
});

test('pointer, wheel, navigation keys, blur and hidden-document input cancel transits with abortable listeners', () => {
  const view = makeView(390, 844, false);
  assert.equal(typeof view.bindNavigationCancellation, 'function', 'all manual input paths need cancellation');
  const originals = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  view.renderer.domElement = new EventTarget();
  view.pointerAbort = new AbortController();
  try {
    view.bindNavigationCancellation();
    for (const [target, type, properties] of [
      [view.renderer.domElement, 'pointerdown', {}], [view.renderer.domElement, 'wheel', {}],
      [view.renderer.domElement, 'keydown', { code: 'ArrowLeft' }],
      [window, 'keydown', { code: 'KeyW' }], [window, 'blur', {}],
      [document, 'visibilitychange', {}],
    ]) {
      view.navigationMode = 'fly';
      view.locateNode(pair.id);
      assert.ok(view.flight);
      document.hidden = type === 'visibilitychange';
      target.dispatchEvent(Object.assign(new Event(type), properties));
      assert.equal(view.locating, null, `${type} cancels tracking`);
      assert.equal(view.flight, null, `${type} cancels the transit`);
      document.hidden = false;
    }
    view.locateNode(pair.id);
    view.flyControls.thrust.add('forward');
    view.updateNavigation(performance.now());
    assert.equal(view.locating, null, 'opt-in touch thrust takes control too');
    view.flyControls.clear();
    view.pointerAbort.abort();
    view.locateNode(pair.id);
    view.renderer.domElement.dispatchEvent(new Event('pointerdown'));
    assert.ok(view.flight, 'aborting removes the navigation listeners');
  } finally {
    for (const key of ['window', 'document']) {
      if (originals[key] === undefined) delete globalThis[key];
      else globalThis[key] = originals[key];
    }
  }
});
