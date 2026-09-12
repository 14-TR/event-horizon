import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    ...Object.fromEntries(['disk-radiance', 'layout', 'shaders', 'note-light'].map(name => [`${name}.js`, `../../src/${name}.js`])),
  };
  await page.route('**/__flow/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'") });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
});

// Normalize by the SAME compact source column with only its grain removed.
// Independent per-note noise averages away in a dense actual-note disk; nearby
// envelopes must agree on their shared spatial detail without adding sources.
test('overlapping real-note volumes retain coherent turbulent detail', async ({ page }, testInfo) => {
  const receipts = await page.evaluate(async () => {
    const T = await import('/__flow/three.js');
    const { DiskRadiance } = await import('/__flow/disk-radiance.js');
    const { createNoteLight } = await import('/__flow/note-light.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([6, 0, 0], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0, 0], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([3.1], 1));
    geometry.setDrawRange(0, 0);
    const point = new T.Points(geometry, new T.PointsMaterial());
    const envelope = createNoteLight(point); point.add(envelope);
    const trail = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial());
    trail.geometry.setAttribute('position', new T.Float32BufferAttribute([], 3));
    trail.geometry.setAttribute('color', new T.Float32BufferAttribute([], 3));
    const receipts = [];
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      const capture = new DiskRadiance([point], trail, quality, [envelope]);
      const material = capture.envelopeMaterial, smooth = material.clone();
      smooth.fragmentShader = smooth.fragmentShader.replace(/noteStructure\([^\n]+\) \* light/, '1.0 * light');
      if (smooth.fragmentShader === material.fragmentShader) throw new Error('missing one-factor grain ablation');
      const sample = material => {
        capture.envelopes[0].image.material = material;
        capture.render(renderer);
        const raw = new Uint16Array(capture.target.width ** 2 * 4);
        renderer.readRenderTargetPixels(capture.target, 0, 0, capture.target.width, capture.target.height, raw);
        return Array.from({ length: raw.length / 4 }, (_, i) => T.DataUtils.fromHalfFloat(raw[i * 4]));
      };
      const source = (position, size) => {
        geometry.attributes.position.setXYZ(0, ...position); geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aSize.setX(0, size); geometry.attributes.aSize.needsUpdate = true;
        return { textured: sample(material), smooth: sample(smooth) };
      };
      const first = source([6, 0, 0], 3.1), second = source([6.08, 0, 0.09], 14.1);
      const pairs = first.smooth.flatMap((v, i) => v > 0.02 && second.smooth[i] > 0.02 ? [[first.textured[i] / v, second.textured[i] / second.smooth[i]]] : []);
      const mean = pairs.reduce((sum, p) => sum + p[0], 0) / pairs.length;
      const variance = pairs.reduce((sum, p) => sum + (p[0] - mean) ** 2, 0) / pairs.length;
      const disagreement = pairs.reduce((sum, p) => sum + Math.abs(p[0] - p[1]), 0) / pairs.length;
      point.visible = false; const empty = sample(material); point.visible = true;
      receipts.push({ quality, samples: pairs.length, mean, contrast: Math.sqrt(variance) / mean, disagreement,
        hiddenEnergy: empty.reduce((sum, value) => sum + value, 0), error: renderer.getContext().getError() });
      smooth.dispose(); capture.dispose();
    }
    geometry.dispose(); point.material.dispose(); envelope.geometry.dispose(); envelope.material.dispose(); trail.geometry.dispose(); trail.material.dispose(); renderer.dispose();
    return receipts;
  });
  await testInfo.attach('source-flow-coherence.json', { body: JSON.stringify(receipts, null, 2), contentType: 'application/json' });
  for (const r of receipts) {
    expect(r.samples).toBeGreaterThan(100);
    expect(r.disagreement, `${r.quality}: neighboring source footprints must reinforce the same detail, not unrelated seeded noise`).toBeLessThan(0.025);
    expect(r.contrast, 'coherence must not be achieved by a flat field').toBeGreaterThan(0.25);
    expect(r.mean, 'bounded modulation still retains source light').toBeGreaterThan(0.1);
    expect(r.mean).toBeLessThan(2);
    expect(r.hiddenEnergy).toBe(0);
    expect(r.error).toBe(0);
  }
});

test('source turbulence advances on the same simulation clock in direct and lensed captures', async ({ page }, testInfo) => {
  const receipts = await page.evaluate(async () => {
    const T = await import('/__flow/three.js');
    const { DiskRadiance } = await import('/__flow/disk-radiance.js');
    const { createNoteLight, NoteLightPass } = await import('/__flow/note-light.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([6, 0, 0], 3));
    geometry.setAttribute('aColor', new T.Float32BufferAttribute([1, 0.6, 0.2], 3));
    geometry.setAttribute('aSize', new T.Float32BufferAttribute([3.1], 1));
    geometry.setDrawRange(0, 0);
    const point = new T.Points(geometry, new T.PointsMaterial());
    const envelope = createNoteLight(point); point.add(envelope);
    const direct = new NoteLightPass([envelope]); direct.resize(128, 128);
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(6, 5, 0); camera.up.set(0, 0, -1); camera.lookAt(6, 0, 0);
    const trail = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial());
    trail.geometry.setAttribute('position', new T.Float32BufferAttribute([], 3));
    trail.geometry.setAttribute('color', new T.Float32BufferAttribute([], 3));
    const read = target => {
      const raw = new Uint16Array(target.width * target.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, raw);
      return Array.from({ length: raw.length / 4 }, (_, i) => T.DataUtils.fromHalfFloat(raw[i * 4]));
    };
    const receipts = [];
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      const capture = new DiskRadiance([point], trail, quality, [envelope]);
      const sample = time => {
        capture.render(renderer, time); direct.render(renderer, camera, time);
        return { captured: read(capture.target), direct: read(direct.target) };
      };
      const initial = sample(0), advanced = sample(12), frozen = sample(12), rewound = sample(0);
      point.visible = false; const hidden = sample(18); point.visible = true;
      for (const layer of ['direct', 'captured']) {
        const energy = initial[layer].reduce((sum, value) => sum + value, 0);
        receipts.push({ quality, layer, energy,
          motion: initial[layer].reduce((sum, value, i) => sum + Math.abs(value - advanced[layer][i]), 0) / energy,
          frozen: advanced[layer].every((value, i) => value === frozen[layer][i]),
          rewound: initial[layer].every((value, i) => value === rewound[layer][i]),
          hidden: hidden[layer].every(value => value === 0), error: renderer.getContext().getError() });
      }
      capture.dispose();
    }
    direct.dispose(); geometry.dispose(); point.material.dispose(); envelope.geometry.dispose(); envelope.material.dispose(); trail.geometry.dispose(); trail.material.dispose(); renderer.dispose();
    return receipts;
  });
  await testInfo.attach('source-flow-clock.json', { body: JSON.stringify(receipts, null, 2), contentType: 'application/json' });
  for (const r of receipts) {
    expect(r.energy).toBeGreaterThan(1);
    expect(r.motion, `${r.quality}/${r.layer}: source detail must not stand still as notes flow through it`).toBeGreaterThan(0.1);
    expect(r.frozen).toBe(true);
    expect(r.rewound).toBe(true);
    expect(r.hidden).toBe(true);
    expect(r.error).toBe(0);
  }
});
