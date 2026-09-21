import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('periapsis transition has no staircase cut across continuous source radiance', async ({ page }, testInfo) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    ...Object.fromEntries(['black-hole', 'black-hole-math', 'black-hole-shaders'].map(name => [`${name}.js`, `../../src/${name}.js`])),
  };
  await page.route('**/__arc/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'") });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('./');
  const receipts = await page.evaluate(async () => {
    const T = await import('/__arc/three.js');
    const { BlackHoleRenderer } = await import('/__arc/black-hole.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(480, 480);
    // Constant diagnostic input isolates the visibility gate from source detail.
    // This texture exists only in the test, never as an application disk source.
    const pixels = new Float32Array(16 * 16 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([1, 1, 1, 0], i);
    const image = new T.DataTexture(pixels, 16, 16, T.RGBAFormat, T.FloatType);
    image.generateMipmaps = true; image.minFilter = T.LinearMipmapLinearFilter; image.needsUpdate = true;
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 250);
    camera.position.set(0, 14, 11); camera.lookAt(0, 0, 0);
    const result = [];
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      const hole = new BlackHoleRenderer({ quality }); hole.resize(480, 480);
      hole.uniforms.uStars.value = 0; hole.uniforms.uDiskImage.value = image;
      hole.uniforms.uDiskExtent.value = 12.5; hole.uniforms.uDiskEnabled.value = 1;
      hole.render(renderer, camera, 0);
      const w = hole.target.width, h = hole.target.height, data = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(hole.target, 0, 0, w, h, data);
      const at = (x, y, c) => T.DataUtils.fromHalfFloat(data[(y * w + x) * 4 + c]);
      let maxJump = 0, bright = 0, jumpAt = null;
      for (let y = Math.ceil(h * 0.56); y < h * 0.82; y++) for (let x = Math.ceil(w * 0.22); x < w * 0.78; x++) {
        if (at(x, y, 3) <= 0 || at(x + 1, y, 3) <= 0 || at(x, y + 1, 3) <= 0) continue;
        const value = at(x, y, 0);
        if (value > 0.1) bright++;
        const jump = Math.max(Math.abs(value - at(x + 1, y, 0)), Math.abs(value - at(x, y + 1, 0)));
        if (jump > maxJump) { maxJump = jump; jumpAt = { x, y, w, h, value, right: at(x + 1, y, 0), up: at(x, y + 1, 0) }; }
      }
      result.push({ quality, maxJump, jumpAt, bright, error: renderer.getContext().getError() }); hole.dispose();
    }
    image.dispose(); renderer.dispose(); return result;
  });
  await testInfo.attach('continuous-arcs.json', { body: JSON.stringify(receipts, null, 2), contentType: 'application/json' });
  for (const result of receipts) {
    expect(result.bright).toBeGreaterThan(100);
    expect(result.maxJump, `${result.quality}: no hard outgoing-step cutoff in an otherwise continuous light field`).toBeLessThan(0.18);
    expect(result.error).toBe(0);
  }
});
