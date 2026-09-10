import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import * as scene from '../src/scene.js';

test('opening composition gives the shadow scale, a low inclination and title breathing room across viewports', () => {
  assert.equal(typeof scene.openingFrame, 'function', 'the camera needs an aspect-aware opening composition');
  for (const [width, height] of [[1440, 900], [1440, 1000], [390, 844], [844, 390]]) {
    const frame = scene.openingFrame(width, height);
    const camera = new PerspectiveCamera(48, width / height, 0.1, 250);
    camera.position.fromArray(frame.position);
    camera.up.fromArray(frame.up).normalize();
    camera.lookAt(new Vector3(...frame.target));
    camera.updateMatrixWorld();
    const left = new Vector3(-11.8, 0, 0).project(camera);
    const right = new Vector3(11.8, 0, 0).project(camera);
    const center = new Vector3().project(camera);
    const widthFraction = (right.x - left.x) / 2;
    assert.ok(widthFraction > 0.6 && widthFraction < 1.1, 'disk fills the frame without being reduced to a thumbnail');
    assert.ok((1 - center.y) / 2 > 0.53 && (1 - center.y) / 2 < 0.59, 'shadow sits below the title, not against it');
    assert.ok(right.y - left.y > 0.08, 'the opening has a deliberate diagonal rather than a flat front elevation');
    const inclination = Math.atan2(camera.position.y, camera.position.z);
    assert.ok(inclination > 0.15 && inclination < 0.3, 'low inclination separates the shadow arcs from the direct disk');
  }
});

test('resizing recomposes home in both directions without teleporting an exploring camera', () => {
  const view = Object.create(scene.Observatory.prototype);
  let width = 1440, height = 900;
  const opening = scene.openingFrame(width, height);
  view.host = { getBoundingClientRect: () => ({ width, height }) };
  view.camera = new PerspectiveCamera(48, width / height, 0.1, 250);
  view.camera.up.fromArray(opening.up).normalize();
  view.homePosition = new Vector3(...opening.position);
  view.homeTarget = new Vector3(...opening.target);
  view.camera.position.copy(view.homePosition);
  view.controls = { target: view.homeTarget.clone(), update() { view.camera.lookAt(this.target); }, saveState() {} };
  view.renderer = { setSize() {}, getPixelRatio: () => 1.75 };
  view.blackHole = { resize() {} };
  view.reportQuality = () => {};
  view.navigationMode = 'orbit';
  view.selectedCluster = null;
  width = 390; height = 844;
  view.resize();
  assert.deepEqual(view.homePosition.toArray(), scene.openingFrame(width, height).position, 'mobile home is recomposed, not the stale desktop camera');
  assert.ok(view.camera.position.equals(view.homePosition));
  width = 1440; height = 900;
  view.resize();
  assert.deepEqual(view.camera.position.toArray(), opening.position, 'returning to desktop restores its intended scale');
  view.camera.position.add(new Vector3(3, 2, 1));
  const explored = view.camera.position.clone();
  width = 390; height = 844;
  view.resize();
  assert.ok(view.camera.position.equals(explored), 'resize does not discard an intentional orbit');
  assert.deepEqual(view.homePosition.toArray(), scene.openingFrame(width, height).position, 'reset destination still updates while exploring');
  view.navigationMode = 'fly';
  view.camera.position.copy(view.homePosition);
  view.controls.target.copy(view.homeTarget);
  const flight = view.camera.position.clone();
  width = 1440; height = 900;
  view.resize();
  assert.ok(view.camera.position.equals(flight), 'free flight is never reframed automatically');
});
