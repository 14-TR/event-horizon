import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as light from '../src/note-light.js';
import { qualitySettings } from '../src/black-hole-math.js';

const source = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([6, 0, 0], 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute([1, 0.6, 0.2], 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute([3.1], 1));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial());
  const volume = light.createNoteLight(points); points.add(volume);
  return { points, volume };
};

test('volume capture follows ancestor transforms/visibility and restores renderer state on failure', () => {
  const { points, volume } = source();
  points.position.set(2, 1, -3); points.rotation.y = 0.4; points.scale.setScalar(1.5); points.visible = false;
  const pass = new light.NoteLightPass([volume]);
  pass.resize(100, 80);
  const destination = {}, originalColor = new THREE.Color(0.2, 0.3, 0.4);
  const originalScissor = new THREE.Vector4(1, 2, 3, 4);
  let target = destination, color = originalColor.clone(), alpha = 0.7, scissor = originalScissor.clone(), scissorTest = true;
  const renderer = {
    autoClear: true, getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getClearColor: out => out.copy(color), getClearAlpha: () => alpha,
    setClearColor: (value, a) => { color.set(value); alpha = a; },
    getScissor: out => out.copy(scissor), setScissor: value => scissor.copy(value),
    getScissorTest: () => scissorTest, setScissorTest: value => { scissorTest = value; },
    clear() {}, render() { throw new Error('diagnostic draw failure'); },
  };
  assert.throws(() => pass.render(renderer, new THREE.PerspectiveCamera()), /diagnostic draw failure/);
  assert.equal(pass.entries[0].image.visible, false);
  assert.ok(pass.entries[0].image.matrix.equals(volume.matrixWorld));
  assert.equal(target, destination); assert.equal(renderer.autoClear, true);
  assert.ok(color.equals(originalColor)); assert.equal(alpha, 0.7);
  assert.ok(scissor.equals(originalScissor)); assert.equal(scissorTest, true);
  pass.dispose(); points.geometry.dispose(); points.material.dispose(); volume.geometry.dispose(); volume.material.dispose();
});

test('soft direct volumes have a bounded single-sample target without reducing source geometry', () => {
  assert.equal(typeof light.NoteLightPass, 'function', 'full-DPR volume overdraw needs its own bounded pass');
  const { points, volume } = source();
  const pass = new light.NoteLightPass([volume]);
  for (const quality of ['mobile', 'desktop', 'cinematic']) {
    for (const [width, height, dpr] of [[390, 844, 3], [1440, 1000, 1.75], [3840, 2160, 2], [0, 0, 1]]) {
      const settings = qualitySettings(quality, width, height, dpr);
      pass.resize(settings.width, settings.height);
      assert.equal(pass.target.width, settings.width);
      assert.equal(pass.target.height, settings.height);
      assert.equal(pass.target.samples, 0);
      assert.equal(pass.target.depthBuffer, false);
      assert.equal(pass.target.texture.type, THREE.HalfFloatType, 'screen accumulation must not quantize faint sources to 8-bit steps');
      assert.equal(pass.entries.length, 1);
      assert.equal(pass.entries[0].image.geometry, volume.geometry);
      assert.equal(pass.entries[0].image.material, volume.material);
      assert.deepEqual(volume.material.uniforms.uViewport.value.toArray(), [settings.width, settings.height], 'signed-depth UVs use this pass framebuffer, not canvas DPR');
    }
  }
  let disposed = false, targetDisposed = false;
  volume.geometry.addEventListener('dispose', () => { disposed = true; });
  pass.target.addEventListener('dispose', () => { targetDisposed = true; });
  pass.dispose();
  assert.equal(disposed, false, 'the pass borrows actual source GPU buffers');
  assert.equal(targetDisposed, true);
  points.geometry.dispose(); points.material.dispose(); volume.geometry.dispose(); volume.material.dispose();
});
