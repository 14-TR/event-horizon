// Real production motion evidence, with pause verified through actual uniforms.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = resolve(process.env.EH_CAPTURE_DIR || 'test-results/disk-motion');
const url = process.env.EH_CAPTURE_URL || 'http://127.0.0.1:4175/event-horizon/';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] });
const receipts = [];
try {
  for (const view of [
    { name: 'desktop', width: 1440, height: 1000, dpr: 1.75 },
    { name: 'mobile', width: 390, height: 844, dpr: 3 },
  ]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr, reducedMotion: 'reduce', hasTouch: view.name === 'mobile', recordVideo: { dir: directory, size: { width: view.width, height: view.height } } });
    const page = await context.newPage(), errors = [];
    const video = page.video();
    try {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        const proto = WebGL2RenderingContext.prototype, names = new WeakMap();
        const location = proto.getUniformLocation, scalar = proto.uniform1f;
        proto.getUniformLocation = function (program, name) { const result = location.call(this, program, name); if (result) names.set(result, name); return result; };
        proto.uniform1f = function (location, value) { if (names.get(location) === 'uTime') window.__motionTime = value; return scalar.call(this, location, value); };
      });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#observatory')?.dataset.renderer === 'webgl' && window.__motionTime === 0);
      assert.equal(await page.locator('#title-toggle').getAttribute('aria-expanded'), 'false');
      const frames = [];
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const time of [1, 2, 3, 4, 5, 6]) {
        await page.waitForFunction(time => window.__motionTime >= time, time);
        const path = `${directory}/${view.name}-${time}.png`;
        const bytes = await page.screenshot({ path });
        frames.push({ time: await page.evaluate(() => window.__motionTime), path, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      assert.equal(new Set(frames.map(frame => frame.sha256)).size, frames.length, 'actual visible movement, not repeated screenshots');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const pausedAt = await page.evaluate(() => window.__motionTime);
      const paused = await page.screenshot({ path: `${directory}/${view.name}-paused.png` });
      await page.waitForTimeout(500);
      const repeated = await page.screenshot();
      assert.equal(await page.evaluate(() => window.__motionTime), pausedAt);
      assert.ok(paused.equals(repeated), 'reduced-motion freezes the complete canvas byte-for-byte');
      assert.deepEqual(errors, []);
      receipts.push({ ...view, frames, pausedAt, pauseIdentical: true, errors, ...await page.locator('#observatory').evaluate(e => ({ ...e.dataset })) });
    } finally { await context.close(); }
    await video.saveAs(`${directory}/${view.name}-motion.webm`);
    await video.delete();
    await writeFile(`${directory}/receipts.json`, JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify(receipts.at(-1)));
  }
  assert.equal(receipts.length, 2);
} finally { await browser.close(); }
