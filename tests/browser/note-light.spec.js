import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

test('finite note envelopes have radial breadth, follow live sources and disappear with them', async ({ page }) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    ...Object.fromEntries(['disk-radiance', 'layout', 'shaders', 'note-light'].map(name => [`${name}.js`, `../../src/${name}.js`])),
  };
  await page.route('**/__envelope/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'") });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const receipts = await page.evaluate(async () => {
    const T = await import('/__envelope/three.js');
    const { DiskRadiance } = await import('/__envelope/disk-radiance.js');
    const { createNoteLight } = await import('/__envelope/note-light.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([6, 0.35, 0], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0, 0], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([6.5], 1));
    geometry.setDrawRange(0, 0); // Diagnose only this actual source's envelope.
    const point = new T.Points(geometry, new T.PointsMaterial());
    const glow = createNoteLight(point); point.add(glow);
    const trail = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial());
    trail.geometry.setAttribute('position', new T.Float32BufferAttribute([], 3));
    trail.geometry.setAttribute('color', new T.Float32BufferAttribute([], 3));
    const receipts = [];
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      const light = new DiskRadiance([point], trail, quality, [glow]);
      const sample = () => {
        light.render(renderer);
        const size = light.target.width, buffer = new Uint16Array(size * size * 4);
        renderer.readRenderTargetPixels(light.target, 0, 0, size, size, buffer);
        let energy = 0, red = 0, blue = 0, x = 0, z = 0, xx = 0, zz = 0, height = 0, peak = 0;
        for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
          const i = (row * size + col) * 4;
          const r = T.DataUtils.fromHalfFloat(buffer[i]), b = T.DataUtils.fromHalfFloat(buffer[i + 2]);
          peak = Math.max(peak, r, b);
          const w = r * 0.2126 + b * 0.0722;
          const px = ((col + 0.5) / size - 0.5) * 2 * light.extent, pz = ((row + 0.5) / size - 0.5) * 2 * light.extent;
          energy += w; red += r; blue += b; x += px * w; z += pz * w; xx += px * px * w; zz += pz * pz * w;
          height += T.DataUtils.fromHalfFloat(buffer[i + 3]);
        }
        return { energy, red, blue, peak, x: x / energy, z: z / energy, rmsX: Math.sqrt(Math.max(0, xx / energy - (x / energy) ** 2)), rmsZ: Math.sqrt(Math.max(0, zz / energy - (z / energy) ** 2)), height: height / energy };
      };
      geometry.attributes.position.setXYZ(0, 6, 0.35, 0); geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.setXYZ(0, 1, 0, 0); geometry.attributes.aColor.needsUpdate = true;
      const original = sample();
      sample(); sample(); // Settle pending uploads before a paused source edit.
      geometry.attributes.position.setXYZ(0, 4, -0.35, 1); geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.setXYZ(0, 0, 0, 1); geometry.attributes.aColor.needsUpdate = true;
      const moved = sample();
      point.visible = false; const empty = sample(); point.visible = true;
      receipts.push({ quality, original, moved, empty, error: renderer.getContext().getError() });
      light.dispose();
    }
    geometry.dispose(); point.material.dispose(); glow.geometry.dispose(); glow.material.dispose(); trail.geometry.dispose(); trail.material.dispose(); renderer.dispose();
    return receipts;
  });
  writeFileSync('test-results/note-light-provenance.json', JSON.stringify(receipts, null, 2));
  for (const r of receipts) {
    expect(r.original.energy).toBeGreaterThan(0);
    expect(r.original.peak, 'overlapping light envelopes support stellar cores instead of bleaching the whole inner reservoir').toBeLessThan(0.12);
    expect(r.original.rmsX, `${r.quality}: radial breadth avoids bright wire-like sheets`).toBeGreaterThan(0.115);
    expect(r.original.rmsX).toBeLessThan(0.23);
    expect(r.original.rmsZ).toBeGreaterThan(0.22);
    expect(r.original.rmsZ).toBeLessThan(0.6);
    expect(r.original.height).toBeCloseTo(0.35, 2);
    expect(r.moved.height).toBeCloseTo(-0.35, 2);
    expect(r.moved.x).toBeCloseTo(4, 1);
    expect(r.moved.z).toBeCloseTo(1, 1);
    expect(r.moved.red).toBe(0);
    expect(r.moved.blue).toBeGreaterThan(0);
    expect(r.empty.energy).toBe(0);
    expect(r.error).toBe(0);
  }
});
