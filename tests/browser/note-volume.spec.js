import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Test-only module interception; the public build exposes no renderer handles.
test('one real note retains finite light at true edge-on and loses all emission when hidden', async ({ page }, testInfo) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    'note-light.js': '../../src/note-light.js',
  };
  await page.route('**/__volume/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'") });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const T = await import('/__volume/three.js');
    const { createNoteLight } = await import('/__volume/note-light.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0, 0);
    const target = new T.WebGLRenderTarget(256, 256, { type: T.FloatType });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([6, 0, 0], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0.6, 0.2], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([3.1], 1));
    geometry.setDrawRange(0, 0);
    const point = new T.Points(geometry, new T.PointsMaterial());
    const envelope = createNoteLight(point); point.add(envelope);
    const scene = new T.Scene(); scene.add(point);
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 100);
    const sample = (position, up) => {
      camera.up.fromArray(up); camera.position.fromArray(position); camera.lookAt(6, 0, 0);
      envelope.onBeforeRender(); renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Float32Array(256 * 256 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      let energy = 0, lit = 0, peak = 0, vertical = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const light = pixels[i]; energy += light; peak = Math.max(peak, light);
        if (light > 0.001) lit++;
        vertical += light * (Math.floor(i / 4 / 256) - 127.5) ** 2;
      }
      return { energy, lit, peak, heightRms: Math.sqrt(vertical / Math.max(energy, 1e-9)) };
    };
    const above = sample([6, 6, 0], [0, 0, -1]);
    const edge = sample([6, 0, 6], [0, 1, 0]);
    const frozen = sample([6, 0, 6], [0, 1, 0]);
    const overlap = envelope.clone(); scene.add(overlap);
    const doubled = sample([6, 0, 6], [0, 1, 0]); scene.remove(overlap);
    // A signed capture depth THROUGH the middle of the source must retain its
    // foreground half, not clip the whole volume using a bounding-box face.
    const depth = new T.DataTexture(new Float32Array([0, 0, 0, -6]), 1, 1, T.RGBAFormat, T.FloatType);
    depth.needsUpdate = true;
    Object.assign(envelope.material.uniforms, {
      uRayDepth: { value: depth }, uOcclusion: { value: 1 },
      uViewport: { value: new T.Vector2(256, 256) },
    });
    const clipped = sample([6, 0, 6], [0, 1, 0]);
    depth.image.data[3] = -4; depth.needsUpdate = true;
    const occluded = sample([6, 0, 6], [0, 1, 0]);
    envelope.material.uniforms.uOcclusion.value = 0; depth.dispose();
    point.visible = false; const hidden = sample([6, 0, 6], [0, 1, 0]);
    const error = renderer.getContext().getError();
    geometry.dispose(); point.material.dispose(); envelope.geometry.dispose(); envelope.material.dispose(); target.dispose(); renderer.dispose();
    return { above, edge, frozen, doubled, clipped, occluded, hidden, error };
  });
  await testInfo.attach('edge-on-source-volume.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.above.energy).toBeGreaterThan(1);
  expect(result.edge.energy, 'a real note must not become a zero-area plane at grazing incidence').toBeGreaterThan(result.above.energy * 0.2);
  expect(result.edge.energy).toBeLessThan(result.above.energy * 5);
  expect(result.edge.heightRms, 'finite vertical support, not a one-pixel line').toBeGreaterThan(1.5);
  expect(result.edge).toEqual(result.frozen);
  expect(result.doubled.peak, 'overlapping source volumes roll off instead of hard-clipping a white band').toBeCloseTo(1 - (1 - result.edge.peak) ** 2, 4);
  expect(result.clipped.energy).toBeGreaterThan(result.edge.energy * 0.25);
  expect(result.clipped.energy).toBeLessThan(result.edge.energy * 0.75);
  expect(result.occluded.energy).toBe(0);
  expect(result.hidden.energy).toBe(0);
  expect(result.error).toBe(0);
});
