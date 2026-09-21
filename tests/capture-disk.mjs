// Frozen, production-page visual evidence; no application debug hooks.
// EH_CAPTURE_DIR=/tmp/event-horizon-disk-before node tests/capture-disk.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateTopology } from './topology.js';

const directory = resolve(process.env.EH_CAPTURE_DIR || 'test-results/disk-frozen');
const url = process.env.EH_CAPTURE_URL || 'http://127.0.0.1:4175/event-horizon/';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] });
const receipts = [];
try {
  for (const view of [
    { name: 'desktop', width: 1440, height: 1000, dpr: 1.75 },
    { name: 'mobile', width: 390, height: 844, dpr: 3 },
    { name: 'inclined', width: 1440, height: 1000, dpr: 1.75, dy: 245 },
    { name: 'edge-on', width: 1440, height: 1000, dpr: 1.75, dy: -82.5264421234233 },
  ]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr, reducedMotion: 'reduce', hasTouch: view.name === 'mobile' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        const names = new WeakMap(), proto = WebGL2RenderingContext.prototype;
        const location = proto.getUniformLocation, matrix = proto.uniformMatrix4fv, scalar = proto.uniform1f;
        window.__frozenDisk = {};
        proto.getUniformLocation = function (program, name) {
          const result = location.call(this, program, name);
          if (result) names.set(result, name);
          return result;
        };
        proto.uniformMatrix4fv = function (location, transpose, value, ...rest) {
          if (names.get(location) === 'uCameraToHole') window.__frozenDisk.camera = Array.from(value);
          if (names.get(location) === 'uInverseProjection') window.__frozenDisk.projection = Array.from(value);
          return matrix.call(this, location, transpose, value, ...rest);
        };
        proto.uniform1f = function (location, value) {
          if (names.get(location) === 'uTime') window.__frozenDisk.time = value;
          return scalar.call(this, location, value);
        };
      });
      const topologyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
      await page.goto(url);
      const graph = validateTopology(await (await topologyResponse).json());
      await page.waitForFunction(() => document.querySelector('#observatory')?.dataset.renderer === 'webgl' && window.__frozenDisk.camera);
      if (view.dy) {
        await page.mouse.move(750, 490); await page.mouse.down();
        await page.mouse.move(750, 490 + view.dy, { steps: 14 }); await page.mouse.up();
      } else {
        await page.screenshot({ path: `${directory}/${view.name}-opening.png` });
      }
      // Hide only overlay elements, never their scene-containing ancestor.
      await page.addStyleTag({ content: '.intro, #explore-tools, [data-hud], .vignette { visibility: hidden !important; }' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const image = await page.screenshot({ path: `${directory}/${view.name}.png` });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const repeated = await page.screenshot();
      const sha = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha(image), sha(repeated), `${view.name}: repeated frozen canvas is identical`);
      const actual = await page.evaluate(() => ({ ...window.__frozenDisk, ...document.querySelector('#observatory').dataset }));
      assert.equal(actual.time, 0);
      assert.equal(actual.noteStars, String(graph.nodes.length));
      assert.equal(actual.diskSourceStars, String(graph.nodes.length));
      if (view.name === 'edge-on') assert.ok(Math.abs(actual.camera[13]) < 0.001, 'edge-on camera really has zero hole-frame height');
      assert.deepEqual(errors, []);
      const receipt = { ...view, ...actual, sha256: sha(image), path: `${directory}/${view.name}.png` };
      receipts.push(receipt);
      await writeFile(`${directory}/receipts.json`, JSON.stringify(receipts, null, 2));
      console.log(JSON.stringify(receipt));
    } finally { await context.close(); }
  }
  assert.equal(receipts.length, 4);
  if (process.env.EH_COMPARE_DIR) {
    const baseline = JSON.parse(await readFile(resolve(process.env.EH_COMPARE_DIR, 'receipts.json'), 'utf8'));
    assert.equal(baseline.length, receipts.length);
    for (const actual of receipts) {
      const before = baseline.find(view => view.name === actual.name);
      for (const key of ['camera', 'projection', 'time', 'width', 'height', 'dpr', 'quality']) {
        // Match JSON's representation of signed zero in the saved receipt.
        assert.deepEqual(JSON.parse(JSON.stringify(actual[key])), before[key], `${actual.name}: identical before/after ${key}`);
      }
      assert.notEqual(actual.sha256, before.sha256, `${actual.name}: disk material/structure changed`);
    }
    console.log('Verified identical frozen cameras, projections, times, sizes and qualities for all 4 before/after views.');
  }
} finally { await browser.close(); }
