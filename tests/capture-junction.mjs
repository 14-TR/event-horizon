// Production angle/azimuth/distance evidence, plus actual orbit and flight video.
// EH_CAPTURE_URL=... EH_CAPTURE_DIR=... EH_CAPTURE_SHA=<40 hex> node tests/capture-junction.mjs
// EH_COMPARE_DIR=<baseline> checks frozen poses, reporting tiny near-zero roundoff.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateTopology } from './topology.js';
import { observeJunction, hideJunctionOverlays, aimJunction, settleJunction } from './browser/junction-tools.js';
import { openTools } from './browser/tools.js';

const directory = resolve(process.env.EH_CAPTURE_DIR || 'test-results/junction');
const url = process.env.EH_CAPTURE_URL || 'http://127.0.0.1:4173/event-horizon/';
const sha = process.env.EH_CAPTURE_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/, 'pin the served production build');
const views = [
  { e: 13.2, a: 0 }, { e: 30, a: 0 }, { e: 50, a: 60 }, { e: 75, a: 90 },
  { e: 30, a: 90 }, { e: 30, a: 180 }, { e: 30, a: 270 },
  { e: 13.2, a: 270 }, { e: 1, a: 300 }, { e: 0, a: 0 }, { e: -1, a: 30 },
  { e: -13.2, a: 60 }, { e: -30, a: 90 }, { e: -50, a: 150 }, { e: -75, a: 180 },
  { e: -30, a: 240 }, { e: 0, a: 270 },
  { e: 30, a: 0, distance: 0.65 }, { e: 30, a: 0, distance: 1.65 },
  { e: -30, a: 180, distance: 0.65 }, { e: -30, a: 180, distance: 1.65 },
];
const profiles = [
  { name: 'desktop', width: 1200, height: 900, dpr: 1.75 },
  { name: 'mobile', width: 390, height: 844, dpr: 3 },
];
const qualities = ['mobile', 'desktop', 'cinematic'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { sha, url, views, profiles, qualities, frozen: [], motion: [] };
const save = () => writeFile(`${directory}/receipts.json`, JSON.stringify(receipt, null, 2));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] });
receipt.browser = browser.version();
try {
  for (const profile of profiles) for (const quality of qualities) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
      reducedMotion: 'reduce', hasTouch: profile.name === 'mobile', recordVideo: { dir: directory, size: { width: profile.width, height: profile.height } } });
    const page = await context.newPage(), errors = [], resources = [];
    const label = `${profile.name}-${quality}`, video = page.video();
    try {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.ok()) resources.push(response.body().then(bytes => ({ url: response.url(), bytes: bytes.length, sha256: hash(bytes) }))); });
      await observeJunction(page);
      await page.addInitScript(quality => localStorage.setItem('eh-render-quality', quality), quality);
      const topologyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
      await page.goto(url);
      const graph = validateTopology(await (await topologyResponse).json());
      await page.waitForFunction(() => window.__junction.camera);
      const gpu = await page.evaluate(() => {
        const gl = document.querySelector('#observatory canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info');
        return gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      });
      assert.ok(!/swiftshader|llvmpipe|software/i.test(gpu));
      await page.screenshot({ path: `${directory}/${label}-opening.png` });
      await hideJunctionOverlays(page);
      const depth = Math.max(19, 25 / (profile.width / profile.height));
      const targetY = depth * 0.052;
      const initial = await page.evaluate(() => window.__junction.camera);
      const orbitRadius = camera => Math.hypot(camera[12] * 1.15, camera[13] * 1.15 - targetY, camera[14] * 1.15);
      const homeRadius = orbitRadius(initial);
      for (const view of views) {
        // Re-establish the same application home state for each frozen matrix.
        // This avoids accumulating spherical reconstruction roundoff from the
        // prior pose; the continuous movement sweep is recorded separately below.
        await page.locator('#reset-button').evaluate(button => button.click());
        await settleJunction(page);
        const current = await page.evaluate(() => window.__junction.camera);
        const goal = homeRadius * (view.distance || 1), radius = orbitRadius(current);
        if (Math.abs(goal - radius) > 0.001) {
          await page.mouse.move(profile.width * 0.5, profile.height * 0.5);
          // Chromium's CDP wheel delta is in physical pixels at emulated DPR.
          const delta = -Math.log(goal / radius) * profile.dpr / (0.7 * 0.01 * Math.log(0.95));
          await page.mouse.wheel(0, delta);
          // Playwright wheel delivery is asynchronous; wait for the real camera
          // before starting a drag (an in-flight wheel is ignored while dragging).
          await page.waitForFunction(({ goal, targetY }) => {
            const camera = window.__junction.camera;
            const radius = Math.hypot(camera[12] * 1.15, camera[13] * 1.15 - targetY, camera[14] * 1.15);
            return Math.abs(radius - goal) / goal < 0.001;
          }, { goal, targetY });
          await settleJunction(page);
        }
        const actual = await aimJunction(page, view.e, view.a, { steps: 16 });
        assert.ok(Math.abs(orbitRadius(actual.camera) - goal) / goal < 0.001, 'actual requested distance');
        const name = `${label}-e${view.e}-a${view.a}-d${view.distance || 1}`;
        const file = `${directory}/${name}.png`, bytes = await page.screenshot({ path: file });
        const repeat = await page.screenshot();
        assert.ok(bytes.equals(repeat), `${name}: frozen repetition`);
        assert.equal(actual.time, 0); assert.equal(actual.quality, quality);
        assert.equal(actual.noteStars, String(graph.nodes.length)); assert.equal(actual.diskSourceStars, String(graph.nodes.length));
        receipt.frozen.push({ name, profile, view, ...actual, worldDistance: Math.hypot(...actual.camera.slice(12, 15)) * 1.15, gpu, file, sha256: hash(bytes) });
        await save();
      }
      // Continuous real pointer motion, without resetting between sweep poses.
      await page.locator('#reset-button').evaluate(button => button.click()); await settleJunction(page);
      const sweep = [];
      for (const [e, a] of [[13.2, 0], [40, 60], [75, 120], [30, 180], [0, 240], [-30, 300], [-75, 360], [-30, 60], [0, 120], [13.2, 180]]) {
        const actual = await aimJunction(page, e, a, { steps: 24 });
        const file = `${directory}/${label}-sweep-${sweep.length}.png`;
        const bytes = await page.screenshot({ path: file });
        sweep.push({ e, a, camera: actual.camera, time: actual.time, file, sha256: hash(bytes) });
      }
      assert.equal(new Set(sweep.map(frame => frame.sha256)).size, sweep.length, 'actual changing orbit frames');
      // Exercise genuine flight separately from paused orbit and source animation.
      await page.evaluate(() => { for (const element of document.querySelectorAll('style')) if (element.textContent.includes('visibility: hidden !important')) element.remove(); });
      await openTools(page); await page.locator('#fly-button').click(); await page.locator('#title-toggle').click();
      await hideJunctionOverlays(page);
      const beforeFlight = await page.evaluate(() => window.__junction.camera);
      await page.locator('#observatory canvas').focus(); await page.keyboard.down('w');
      await page.waitForFunction(before => Math.hypot(...window.__junction.camera.slice(12, 15).map((value, i) => value - before[12 + i])) > 0.5, beforeFlight);
      await page.keyboard.up('w'); await settleJunction(page);
      const afterFlight = await page.evaluate(() => window.__junction.camera);
      assert.notDeepEqual(afterFlight, beforeFlight);
      const flight = await page.screenshot({ path: `${directory}/${label}-flight.png` });
      const animated = [];
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const time of [1, 2, 3]) {
        await page.waitForFunction(time => window.__junction.time >= time, time);
        const bytes = await page.screenshot({ path: `${directory}/${label}-motion-${time}.png` });
        animated.push({ time: await page.evaluate(() => window.__junction.time), sha256: hash(bytes) });
      }
      assert.equal(new Set(animated.map(frame => frame.sha256)).size, animated.length);
      await page.emulateMedia({ reducedMotion: 'reduce' }); await settleJunction(page);
      const paused = await page.screenshot(); await page.waitForTimeout(200); const repeated = await page.screenshot();
      assert.ok(paused.equals(repeated), 'pause freezes actual source motion');
      assert.deepEqual(errors, []);
      receipt.motion.push({ label, gpu, sweep, beforeFlight, afterFlight, flightSha256: hash(flight), animated, pauseIdentical: true, errors, resources: await Promise.all(resources), video: `${directory}/${label}-orbit-flight-motion.webm` });
    } finally { await context.close(); }
    await video.saveAs(`${directory}/${label}-orbit-flight-motion.webm`); await video.delete();
    await save(); console.log(`${label}: ${views.length} frozen angles/distances, actual orbit + flight + source motion verified`);
  }
  assert.equal(receipt.frozen.length, views.length * profiles.length * qualities.length);
  assert.equal(receipt.motion.length, profiles.length * qualities.length);
  assert.equal(new Set(receipt.frozen.map(view => view.name)).size, receipt.frozen.length);
  if (process.env.EH_COMPARE_DIR) {
    const before = JSON.parse(await readFile(resolve(process.env.EH_COMPARE_DIR, 'receipts.json'), 'utf8'));
    assert.equal(before.frozen.length, receipt.frozen.length);
    let maxCameraRoundoff = 0;
    for (const actual of receipt.frozen) {
      const baseline = before.frozen.find(view => view.name === actual.name); assert.ok(baseline);
      for (const key of ['camera', 'projection', 'time', 'profile', 'quality', 'raySteps', 'rayPixels', 'diskImageSize']) {
        if (key === 'camera') {
          assert.equal(actual.camera.length, 16); assert.equal(baseline.camera.length, 16);
          actual.camera.forEach((value, index) => {
            const expected = baseline.camera[index], error = Math.abs(value - expected);
            // OrbitControls spherical reconstruction can differ by one float
            // ULP near a zero axis. Retain raw uniforms and report that error;
            // reject any meaningful pose difference, never normalize evidence.
            assert.ok(value === expected || (Math.max(Math.abs(value), Math.abs(expected)) < 1e-6 && error < 1e-12), `${actual.name}: matched camera component ${index}`);
            maxCameraRoundoff = Math.max(maxCameraRoundoff, error);
          });
        } else {
          assert.deepEqual(JSON.parse(JSON.stringify(actual[key])), baseline[key], `${actual.name}: identical frozen ${key}`);
        }
      }
    }
    receipt.comparison = { baselineSha: before.sha, matchedFrozenPoses: receipt.frozen.length, maxCameraRoundoff };
  }
  await save(); console.log(JSON.stringify({ frozen: receipt.frozen.length, videos: receipt.motion.length, comparison: receipt.comparison }));
} finally { await browser.close(); }
