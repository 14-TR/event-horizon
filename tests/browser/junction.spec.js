import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { validateTopology } from '../topology.js';

// Fixed image regression, not acceptance of today's changing publication.
const raw = JSON.parse(readFileSync(new URL('../fixtures/junction-topology.json', import.meta.url)));
const graph = validateTopology(raw);
import { observeJunction, hideJunctionOverlays, aimJunction, junctionStrength } from './junction-tools.js';

for (const quality of ['mobile', 'desktop', 'cinematic']) {
  test(`fixed-topology actual-note corona joins the direct disk at the reproduced inclined seam: ${quality}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await observeJunction(page);
      await page.addInitScript(quality => localStorage.setItem('eh-render-quality', quality), quality);
      await page.route('**/graph.json', route => route.fulfill({ json: raw }));
      await page.goto(baseURL);
      await page.waitForFunction(() => window.__junction.camera);
      await hideJunctionOverlays(page);
      const actual = await aimJunction(page, 30, 0);
      const screenshot = await page.screenshot();
      const repeat = await page.screenshot();
      expect(screenshot.equals(repeat), 'identical frozen production frame').toBe(true);
      const strength = await junctionStrength(page, screenshot);
      await testInfo.attach('inclined-junction.png', { body: screenshot, contentType: 'image/png' });
      await testInfo.attach('junction.json', { body: JSON.stringify({ actual, strength, errors }, null, 2), contentType: 'application/json' });
      expect(actual.noteStars).toBe(String(graph.nodes.length)); expect(actual.diskSourceStars).toBe(String(graph.nodes.length));
      expect(actual.time).toBe(0); expect(actual.quality).toBe(quality); expect(errors).toEqual([]);
      expect(strength.arc, 'non-vacuous actual lensed source light').toBeGreaterThan(0.7);
      expect(strength.disk, 'non-vacuous direct actual-note disk').toBeGreaterThan(0.9);
      expect(strength.ratio, 'the local junction must not collapse between two bright source-bound layers').toBeGreaterThan(0.8);
    } finally { await context.close(); }
  });
}
