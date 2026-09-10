import { test, expect } from '@playwright/test';
import { openTools } from './tools.js';
import { readFileSync, writeFileSync } from 'node:fs';

// Diagnostic scenes live only in intercepted test modules, not the deployed app.
test('actual far-side source light reaches both shadow arcs and follows camera and source identity', async ({ page }) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    ...Object.fromEntries(['black-hole', 'black-hole-math', 'black-hole-shaders', 'disk-radiance', 'layout', 'shaders'].map(name => [`${name}.js`, `../../src/${name}.js`])),
  };
  await page.route('**/__lens/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'");
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await openTools(page);
  const result = await page.evaluate(async () => {
    const T = await import('/__lens/three.js');
    const { BlackHoleRenderer } = await import('/__lens/black-hole.js');
    const { DiskRadiance } = await import('/__lens/disk-radiance.js');
    if (!DiskRadiance.prototype.render || !BlackHoleRenderer.prototype.setDiskRadiance) return { supported: false };
    const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(480, 480); renderer.setClearColor(0);
    const geometry = new T.BufferGeometry();
    // One diagnostic anonymous note, wholly on the FAR side, no gas or sky light.
    geometry.setAttribute('position', new T.Float32BufferAttribute([0.7, 0, -6], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0, 0], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([30], 1));
    const point = new T.Points(geometry, new T.PointsMaterial());
    point.userData.nodes = [{ id: 'n000001' }];
    const trail = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ opacity: 0.62 }));
    trail.geometry.setAttribute('position', new T.Float32BufferAttribute([], 3));
    trail.geometry.setAttribute('color', new T.Float32BufferAttribute([], 3));
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 250);
    camera.position.set(0, 3, 30); camera.lookAt(0, 0, 0);
    const receipts = [];
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      const light = new DiskRadiance([point], trail, quality);
      const hole = new BlackHoleRenderer({ quality });
      hole.uniforms.uStars.value = 0;
      hole.setDiskRadiance(light); hole.resize(480, 480);
      const sample = () => {
        hole.render(renderer, camera, 0);
        const buffer = new Uint16Array(hole.target.width * hole.target.height * 4);
        renderer.readRenderTargetPixels(hole.target, 0, 0, hole.target.width, hole.target.height, buffer);
        let upper = 0, lower = 0, red = 0, blue = 0, center = 0, checksum = 0;
        for (let y = 0; y < hole.target.height; y++) for (let x = 0; x < hole.target.width; x++) {
          const i = (y * hole.target.width + x) * 4;
          const r = T.DataUtils.fromHalfFloat(buffer[i]), b = T.DataUtils.fromHalfFloat(buffer[i + 2]);
          const delta = Math.max(0, Math.max(r, b) - 0.002); // excludes constant dark sky floor
          if (delta > 0.003) { if (y > hole.target.height / 2 + 5) upper++; if (y < hole.target.height / 2 - 5) lower++; }
          red += r; blue += b; checksum += delta * (x + y * 0.123);
          if (Math.hypot(x - hole.target.width / 2, y - hole.target.height / 2) < 12) center = Math.max(center, r, b);
        }
        const sourcePixel = new Uint16Array(4);
        renderer.readRenderTargetPixels(light.target,
          Math.floor((0.7 / (2 * light.extent) + 0.5) * light.target.width),
          Math.floor((-6 / (2 * light.extent) + 0.5) * light.target.height), 1, 1, sourcePixel);
        const rgba = Array.from(sourcePixel, T.DataUtils.fromHalfFloat);
        const emission = rgba[0] * 0.2126 + rgba[1] * 0.7152 + rgba[2] * 0.0722;
        return { upper, lower, red, blue, center, checksum, sourceHeight: emission > 1e-8 ? rgba[3] / emission : 0 };
      };
      geometry.attributes.aColor.setXYZ(0, 1, 0, 0); geometry.attributes.aColor.needsUpdate = true;
      camera.position.set(0, 3, 30); camera.lookAt(0, 0, 0);
      const original = sample();
      const corePixels = new Uint16Array(3 * 3 * 4);
      const sx = Math.floor((0.7 / (2 * light.extent) + 0.5) * light.target.width);
      const sy = Math.floor((-6 / (2 * light.extent) + 0.5) * light.target.height);
      renderer.readRenderTargetPixels(light.target, sx - 1, sy - 1, 3, 3, corePixels);
      const sourcePeak = Math.max(...Array.from(corePixels).filter((_, i) => i % 4 === 0).map(T.DataUtils.fromHalfFloat));
      geometry.attributes.position.setY(0, 0.35); geometry.attributes.position.needsUpdate = true;
      const raised = sample();
      geometry.attributes.position.setY(0, -0.35); geometry.attributes.position.needsUpdate = true;
      const lowered = sample();
      geometry.attributes.position.setY(0, 0); geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.setXYZ(0, 0, 0, 1); geometry.attributes.aColor.needsUpdate = true;
      const blue = sample();
      camera.position.set(9, 12, 25); camera.lookAt(0, 0, 0);
      const moved = sample();
      camera.position.set(0, 16, 29); camera.lookAt(0, 0, 0);
      hole.uniforms.uLensing.value = 0;
      const straight = sample();
      hole.uniforms.uLensing.value = 1;
      camera.position.set(0, 3, 30); camera.lookAt(0, 0, 0);
      point.visible = false;
      const empty = sample();
      point.visible = true;
      // Production-size isolated stars must be discoverable at the displaced
      // intersection, not merely disappear when the first plane lookup is empty.
      geometry.attributes.aColor.setXYZ(0, 1, 0, 0); geometry.attributes.aColor.needsUpdate = true;
      geometry.attributes.aSize.setX(0, 6.5); geometry.attributes.aSize.needsUpdate = true;
      camera.position.set(0, 0.15, 30); camera.lookAt(0, 0, 0);
      const grazingFlat = sample();
      geometry.attributes.position.setY(0, 0.35); geometry.attributes.position.needsUpdate = true;
      const grazingRaised = sample();
      geometry.attributes.position.setY(0, -0.35); geometry.attributes.position.needsUpdate = true;
      const grazingLowered = sample();
      point.visible = false; const grazingEmpty = sample(); point.visible = true;
      geometry.attributes.position.setY(0, 0); geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aSize.setX(0, 30); geometry.attributes.aSize.needsUpdate = true;
      receipts.push({ quality, sourcePeak, original, raised, lowered, blue, moved, straight, empty, grazingFlat, grazingRaised, grazingLowered, grazingEmpty, glError: renderer.getContext().getError() });
      light.dispose(); hole.dispose();
    }
    geometry.dispose(); point.material.dispose(); trail.geometry.dispose(); trail.material.dispose(); renderer.dispose();
    return { supported: true, receipts };
  });
  expect(result.supported, 'actual radiance must be integrated into the ray pass').toBe(true);
  writeFileSync('test-results/disk-lensing-source-identity.json', JSON.stringify(result, null, 2));
  for (const r of result.receipts) {
    expect(r.sourcePeak, `${r.quality}: compact HDR stellar cores, not flat beads`).toBeGreaterThan(3);
    expect(Math.abs(r.raised.checksum - r.original.checksum), `${r.quality}: the actual note height changes its lensed image`).toBeGreaterThan(0.1);
    expect(Math.abs(r.lowered.checksum - r.original.checksum), `${r.quality}: signed below-plane height is retained`).toBeGreaterThan(0.1);
    expect(Math.abs(r.lowered.checksum - r.raised.checksum), `${r.quality}: opposite source heights are not flattened together`).toBeGreaterThan(0.1);
    expect(r.raised.sourceHeight, `${r.quality}: positive signed HDR height moment`).toBeCloseTo(0.35, 2);
    expect(r.lowered.sourceHeight, `${r.quality}: negative signed HDR height moment`).toBeCloseTo(-0.35, 2);
    const grazingEnergy = r.grazingFlat.red - r.grazingEmpty.red;
    expect(r.grazingRaised.red - r.grazingEmpty.red, `${r.quality}: off-plane upper source is not erased at grazing incidence`).toBeGreaterThan(grazingEnergy * 0.1);
    expect(r.grazingLowered.red - r.grazingEmpty.red, `${r.quality}: off-plane lower source is not erased at grazing incidence`).toBeGreaterThan(grazingEnergy * 0.1);
    expect(r.original.upper, `${r.quality}: far-side upper image`).toBeGreaterThan(0);
    expect(r.original.lower, `${r.quality}: far-side lower image`).toBeGreaterThan(0);
    expect(r.original.center).toBe(0);
    expect(r.original.red).toBeGreaterThan(r.empty.red + 0.1);
    expect(r.blue.blue).toBeGreaterThan(r.empty.blue + 0.1);
    expect(r.blue.red).toBeCloseTo(r.empty.red, 3);
    expect(Math.abs(r.moved.checksum - r.blue.checksum)).toBeGreaterThan(0.1);
    expect(r.empty.upper + r.empty.lower).toBe(0);
    expect(r.straight.upper + r.straight.lower, 'unbent primary rays must not duplicate the direct disk').toBe(0);
    expect(r.glError).toBe(0);
  }
});

test('bounded live-motion pacing receipt covers each real-graph quality without dropping notes', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const receipts = [];
  for (const setting of [
    { quality: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
    { quality: 'desktop', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.75 },
    { quality: 'cinematic', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.75 },
  ]) {
    const context = await browser.newContext({ viewport: setting.viewport, deviceScaleFactor: setting.deviceScaleFactor, reducedMotion: 'no-preference' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(quality => localStorage.setItem('eh-render-quality', quality), setting.quality);
      await page.goto(baseURL);
      await openTools(page);
      await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
      await page.bringToFront();
      // Include normal user activation, and record headless scheduler state.
      await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
      const measured = await page.evaluate(async () => {
        const gl = document.querySelector('#observatory canvas').getContext('webgl2');
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        // Time GPU work between source clear and the eighth direct sector draw,
        // rather than mistaking headless rAF/compositor stalls for GPU duration.
        const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const clear = gl.clear, draw = gl.drawArrays, queries = [];
        let active = null, direct = 0;
        if (timer) {
          gl.clear = function (mask) {
            if (!active && (mask & gl.COLOR_BUFFER_BIT) && gl.getParameter(gl.FRAMEBUFFER_BINDING)) {
              active = gl.createQuery(); direct = 0;
              gl.beginQuery(timer.TIME_ELAPSED_EXT, active);
            }
            return clear.call(gl, mask);
          };
          gl.drawArrays = function (mode, first, count) {
            const result = draw.call(gl, mode, first, count);
            if (active && mode === gl.POINTS && !gl.getParameter(gl.FRAMEBUFFER_BINDING) && ++direct === 8) {
              gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(active); active = null;
            }
            return result;
          };
        }
        const samples = [];
        await new Promise(resolve => {
          let warm = 0, last;
          const tick = now => {
            if (++warm > 30 && last !== undefined) samples.push(now - last);
            last = now;
            if (samples.length < 90) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        });
        samples.sort((a, b) => a - b);
        gl.clear = clear; gl.drawArrays = draw;
        if (active) { gl.endQuery(timer.TIME_ELAPSED_EXT); gl.deleteQuery(active); }
        const disjoint = timer ? gl.getParameter(timer.GPU_DISJOINT_EXT) : true;
        const gpuTimes = queries.slice(30).filter(q => !disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
        for (const query of queries) gl.deleteQuery(query);
        return {
          gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)],
          visibility: document.visibilityState, focused: document.hasFocus(), gpuSamples: gpuTimes.length,
          gpuMedianMs: gpuTimes.length ? gpuTimes[Math.floor(gpuTimes.length / 2)] : null,
          gpuP95Ms: gpuTimes.length ? gpuTimes[Math.floor(gpuTimes.length * 0.95)] : null,
          glError: gl.getError(), ...document.getElementById('observatory').dataset,
        };
      });
      expect(measured.noteStars).toBe('1675');
      expect(measured.diskSourceStars).toBe('1675');
      expect(measured.glError).toBe(0);
      expect(errors).toEqual([]);
      receipts.push({ ...setting, ...measured });
    } finally { await context.close(); }
  }
  writeFileSync('test-results/disk-lensing-pacing.json', JSON.stringify(receipts, null, 2));
});
