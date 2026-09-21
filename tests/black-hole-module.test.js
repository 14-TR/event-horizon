import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import * as blackHole from '../src/black-hole.js';

test('the module owns disposable render targets and tracks camera in a fixed hole frame', () => {
  assert.equal(typeof blackHole.BlackHoleRenderer, 'function', 'reusable renderer must exist');
  const hole = new blackHole.BlackHoleRenderer({ horizonRadius: 1.15 });
  const parent = new Group();
  parent.position.set(3, -2, 1);
  parent.rotation.z = 0.3;
  parent.add(hole.anchor);
  const camera = new PerspectiveCamera(48, 1.6, 0.1, 250);
  camera.position.set(-2, 4, 43);
  camera.lookAt(0, 0, 0);
  hole.update(camera, 12);
  const expected = camera.position.clone().applyMatrix4(hole.anchor.matrixWorld.clone().invert());
  const actual = new Vector3().setFromMatrixPosition(hole.uniforms.uCameraToHole.value);
  assert.ok(actual.distanceTo(expected) < 1e-9);
  assert.equal(hole.uniforms.uTime.value, 12);
  const fixed = hole.anchor.quaternion.clone();
  camera.position.set(20, 25, -12);
  camera.lookAt(0, 0, 0);
  hole.update(camera, 13);
  assert.ok(hole.anchor.quaternion.equals(fixed), 'orbiting must not billboard the world frame');
  hole.resize(1600, 1000, 2);
  assert.ok(hole.target.width * hole.target.height <= 1100000);
  hole.setQuality('mobile');
  assert.equal(hole.rayMaterial.defines.MAX_STEPS, 96);
  assert.ok(hole.target.width * hole.target.height <= 340000);
  assert.throws(() => hole.setQuality('garbage'), /Unknown quality/);
  let disposed = false;
  hole.target.addEventListener('dispose', () => { disposed = true; });
  hole.dispose();
  assert.equal(disposed, true);
});

test('direct volume light is folded into the existing composite before crisp foreground geometry', () => {
  const hole = new blackHole.BlackHoleRenderer();
  const camera = new PerspectiveCamera(48, 1, 0.1, 100);
  const foreground = new Group(), order = [], times = [];
  const light = { target: { texture: {} }, render: (renderer, camera, time) => { order.push('volumes'); times.push(time); } };
  hole.setDiskRadiance({ target: { texture: {} }, extent: 12.5, render: (renderer, time) => { order.push('capture'); times.push(time); } });
  let target = null;
  const renderer = {
    extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getScissorTest: () => false, setScissorTest() {}, getScissor() {}, setScissor() {}, clear() {},
    render: scene => order.push(scene === hole.rayScene ? 'rays' : scene === hole.compositeScene ? 'composite' : 'foreground'),
  };
  hole.render(renderer, camera, 12, foreground, light);
  assert.deepEqual(order, ['capture', 'rays', 'volumes', 'composite', 'foreground'], 'no second fullscreen MSAA composite is needed');
  assert.deepEqual(times, [12, 12], 'the actual simulation timestamp reaches both source-light passes before drawing');
  assert.equal(hole.uniforms.uForegroundLight.value, light.target.texture);
  assert.equal(hole.uniforms.uForegroundEnabled.value, 1);
  hole.render(renderer, camera, 0);
  assert.equal(hole.uniforms.uForegroundEnabled.value, 0, 'omitting a borrowed pass must not retain stale light');
  assert.equal(hole.uniforms.uForegroundLight.value, null);
  assert.equal(renderer.autoClear, true);
  assert.equal(target, null);
  hole.dispose();
});

test('invalid hole scale and unsupported cameras fail before NaN ray uniforms', () => {
  assert.throws(() => new blackHole.BlackHoleRenderer({ horizonRadius: 0 }), /positive/);
  const hole = new blackHole.BlackHoleRenderer();
  const camera = new PerspectiveCamera(48, 1, 0.1, 200);
  hole.anchor.scale.set(1, 2, 1);
  assert.throws(() => hole.update(camera, 0), /uniform scale/);
  hole.anchor.scale.setScalar(1);
  assert.throws(() => hole.update(camera, NaN), /finite/);
  assert.throws(() => hole.update(new Group(), 0), /PerspectiveCamera/);
  hole.dispose();
});
