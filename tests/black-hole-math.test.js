import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from '../src/black-hole-math.js';
import { Group, PerspectiveCamera, Vector3 } from 'three';

test('quality budgets cap pixel cost and keep a bounded ray count', () => {
  assert.equal(typeof math.qualitySettings, 'function', 'quality settings must exist');
  const desktop = math.qualitySettings('desktop', 1600, 1000, 2);
  const mobile = math.qualitySettings('mobile', 390, 844, 3);
  assert.equal(desktop.steps, 144);
  assert.equal(mobile.steps, 96);
  assert.ok(desktop.width * desktop.height <= 1100000);
  assert.ok(mobile.width * mobile.height <= 340000);
  assert.ok(Math.abs(desktop.width / desktop.height - 1.6) < 0.01);
  assert.ok(Math.abs(mobile.width / mobile.height - 390 / 844) < 0.01);
  assert.ok(mobile.stepScale > desktop.stepScale);
});

test('invalid quality names fail explicitly and zero-size resize is safe', () => {
  assert.throws(() => math.qualitySettings('imaginary', 800, 600), /Unknown quality/);
  const tiny = math.qualitySettings('mobile', 0, 0, 0);
  assert.equal(tiny.width, 1);
  assert.equal(tiny.height, 1);
  assert.throws(() => math.qualitySettings('desktop', NaN, 600), /finite/);
});

test('camera rays follow actual FOV, orientation, translation and parent transforms', () => {
  assert.equal(typeof math.cameraRay, 'function', 'camera-ray reconstruction must exist');
  const rig = new Group();
  rig.position.set(4, 2, -3);
  rig.rotation.y = 0.7;
  const camera = new PerspectiveCamera(60, 2, 0.1, 250);
  camera.position.set(0, 3, 20);
  rig.add(camera);
  const center = math.cameraRay(camera, 0, 0);
  assert.ok(center.origin.distanceTo(camera.getWorldPosition(new Vector3())) < 1e-9);
  assert.ok(center.direction.distanceTo(camera.getWorldDirection(new Vector3())) < 1e-9);
  const corner = math.cameraRay(camera, 1, 1);
  const expected = new Vector3(2 * Math.tan(Math.PI / 6), Math.tan(Math.PI / 6), -1)
    .normalize().transformDirection(camera.matrixWorld);
  assert.ok(corner.direction.distanceTo(expected) < 1e-9);
  camera.rotation.x = 1.1;
  assert.ok(math.cameraRay(camera, 0, 0).direction.distanceTo(center.direction) > 0.5);
});


