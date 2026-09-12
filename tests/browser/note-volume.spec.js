import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Test-only module interception; the public build exposes no renderer handles.
for (const bounded of [false, true]) test(`one real note retains finite light at true edge-on and loses all emission when hidden (${bounded ? 'bounded pass' : 'full resolution'})`, async ({ page }, testInfo) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    'note-light.js': '../../src/note-light.js',
    'layout.js': '../../src/layout.js',
    'black-hole-shaders.js': '../../src/black-hole-shaders.js',
  };
  await page.route('**/__volume/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'") });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const result = await page.evaluate(async bounded => {
    const T = await import('/__volume/three.js');
    const { createNoteLight, NoteLightPass } = await import('/__volume/note-light.js');
    const { fullscreenVertex, compositeFragment } = await import('/__volume/black-hole-shaders.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0, 0);
    const target = new T.WebGLRenderTarget(256, 256, { type: T.FloatType });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([6, 0, 0], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0.6, 0.2], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([3.1], 1));
    geometry.setDrawRange(0, 0);
    const point = new T.Points(geometry, new T.PointsMaterial());
    const envelope = createNoteLight(point); point.add(envelope);
    // Include both entries up front so the overlap test exercises the real pass.
    const overlap = envelope.clone(); overlap.visible = false;
    const pass = bounded ? new NoteLightPass([envelope, overlap]) : null;
    pass?.resize(128, 128);
    // Exercise the production composite, with a black diagnostic background.
    const background = new T.DataTexture(new Float32Array([0, 0, 0, 60000]), 1, 1, T.RGBAFormat, T.FloatType);
    background.needsUpdate = true;
    const composite = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
      glslVersion: T.GLSL3, vertexShader: fullscreenVertex, fragmentShader: compositeFragment,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        uImage: { value: background }, uTexel: { value: new T.Vector2(1, 1) },
        uForegroundLight: { value: pass?.target.texture ?? null }, uForegroundEnabled: { value: 1 },
        uExposure: { value: 1 }, uGlow: { value: 0 },
        uInverseProjection: { value: new T.Matrix4() }, uProjection: { value: new T.Matrix4() },
      },
    }));
    composite.frustumCulled = false;
    const compositeScene = new T.Scene(); compositeScene.add(composite);
    const scene = new T.Scene(); scene.add(point);
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 100);
    const sample = (position, up) => {
      camera.up.fromArray(up); camera.position.fromArray(position); camera.lookAt(6, 0, 0);
      if (!pass) envelope.onBeforeRender();
      renderer.setRenderTarget(target);
      if (pass) { pass.render(renderer, camera); renderer.render(compositeScene, new T.Camera()); }
      else renderer.render(scene, camera);
      const pixels = new Float32Array(256 * 256 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      let energy = 0, greenEnergy = 0, lit = 0, peak = 0, vertical = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const light = pixels[i]; energy += light; peak = Math.max(peak, light);
        greenEnergy += pixels[i + 1];
        if (light > 0.001) lit++;
        vertical += light * (Math.floor(i / 4 / 256) - 127.5) ** 2;
      }
      let accumulationPeak = peak;
      if (pass) {
        const raw = new Uint16Array(128 * 128 * 4);
        renderer.readRenderTargetPixels(pass.target, 0, 0, 128, 128, raw);
        accumulationPeak = 0;
        for (let i = 0; i < raw.length; i += 4) accumulationPeak = Math.max(accumulationPeak, T.DataUtils.fromHalfFloat(raw[i]));
      }
      return { energy, greenEnergy, lit, peak, accumulationPeak, heightRms: Math.sqrt(vertical / Math.max(energy, 1e-9)) };
    };
    const above = sample([6, 6, 0], [0, 0, -1]);
    const edge = sample([6, 0, 6], [0, 1, 0]);
    const frozen = sample([6, 0, 6], [0, 1, 0]);
    overlap.visible = true; scene.add(overlap);
    const doubled = sample([6, 0, 6], [0, 1, 0]); scene.remove(overlap); overlap.visible = false;
    // A signed capture depth THROUGH the middle of the source must retain its
    // foreground half, not clip the whole volume using a bounding-box face.
    const depth = new T.DataTexture(new Float32Array([0, 0, 0, -6]), 1, 1, T.RGBAFormat, T.FloatType);
    depth.needsUpdate = true;
    Object.assign(envelope.material.uniforms, {
      uRayDepth: { value: depth }, uOcclusion: { value: 1 },
      uViewport: { value: new T.Vector2(bounded ? 128 : 256, bounded ? 128 : 256) },
    });
    const clipped = sample([6, 0, 6], [0, 1, 0]);
    depth.image.data[3] = 6; depth.needsUpdate = true;
    const positiveClipped = sample([6, 0, 6], [0, 1, 0]);
    depth.image.data[3] = -4; depth.needsUpdate = true;
    const occluded = sample([6, 0, 6], [0, 1, 0]);
    envelope.material.uniforms.uOcclusion.value = 0; depth.dispose();
    // A settled paused source edit must reach this very next direct capture,
    // without relying on DiskRadiance's earlier synchronization in the app.
    for (let i = 0; i < 3; i++) sample([6, 0, 6], [0, 1, 0]);
    geometry.attributes.aColor.array.set([0, 1, 0]); geometry.attributes.aColor.needsUpdate = true;
    const recolored = sample([6, 0, 6], [0, 1, 0]);
    point.visible = false; const hidden = sample([6, 0, 6], [0, 1, 0]);
    const error = renderer.getContext().getError();
    background.dispose(); composite.geometry.dispose(); composite.material.dispose();
    pass?.dispose(); geometry.dispose(); point.material.dispose(); envelope.geometry.dispose(); envelope.material.dispose(); target.dispose(); renderer.dispose();
    return { above, edge, frozen, doubled, clipped, positiveClipped, occluded, recolored, hidden, error };
  }, bounded);
  await testInfo.attach('edge-on-source-volume.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.above.energy).toBeGreaterThan(1);
  expect(result.edge.energy, 'a real note must not become a zero-area plane at grazing incidence').toBeGreaterThan(result.above.energy * 0.2);
  expect(result.edge.energy).toBeLessThan(result.above.energy * 5);
  expect(result.edge.heightRms, 'finite vertical support, not a one-pixel line').toBeGreaterThan(1.5);
  expect(result.edge).toEqual(result.frozen);
  // Check the compositing identity BEFORE the nonlinear expression is bilinearly
  // filtered. Use half-float precision only for the bounded pass's own target.
  expect(result.doubled.accumulationPeak, 'overlapping source volumes roll off instead of hard-clipping a white band').toBeCloseTo(1 - (1 - result.edge.accumulationPeak) ** 2, bounded ? 3 : 4);
  expect(result.doubled.peak).toBeGreaterThan(result.edge.peak);
  expect(result.clipped.energy).toBeGreaterThan(result.edge.energy * 0.25);
  expect(result.clipped.energy).toBeLessThan(result.edge.energy * 0.75);
  expect(result.positiveClipped).toEqual(result.clipped);
  expect(result.recolored.energy).toBe(0);
  expect(result.recolored.greenEnergy).toBeGreaterThan(1);
  expect(result.occluded.energy).toBe(0);
  expect(result.hidden.energy).toBe(0);
  expect(result.hidden.greenEnergy).toBe(0);
  expect(result.error).toBe(0);
});
