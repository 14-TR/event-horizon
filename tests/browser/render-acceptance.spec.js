import { test, expect } from '@playwright/test';
import { openTools } from './tools.js';
import { readFileSync, writeFileSync } from 'node:fs';

// Serve verification-only source modules through interception, never production routes.
test('GPU depth rejects hidden stars, preserves foreground stars and survives high-DPI targets', async ({ page }) => {
  const files = {
    'three.js': '../../node_modules/three/build/three.module.js',
    'three.core.js': '../../node_modules/three/build/three.core.js',
    'black-hole.js': '../../src/black-hole.js',
    'black-hole-math.js': '../../src/black-hole-math.js',
    'black-hole-shaders.js': '../../src/black-hole-shaders.js',
  };
  await page.route('**/__verify/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = readFileSync(new URL(files[name], import.meta.url), 'utf8').replaceAll("from 'three'", "from './three.js'");
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await openTools(page);
  const results = await page.evaluate(async () => {
    const T = await import('/__verify/three.js');
    const { BlackHoleRenderer } = await import('/__verify/black-hole.js');
    const renderer = new T.WebGLRenderer();
    const hole = new BlackHoleRenderer();
    const camera = new T.PerspectiveCamera(48, 1, 0.1, 250);
    camera.position.set(0, 6, 30); camera.lookAt(0, 0, 0);
    const far = new T.Vector3(0, -2, -10), near = new T.Vector3(0, 4, 20);
    const values = [];
    for (const dpr of [1, 1.75, 3]) {
      renderer.setPixelRatio(dpr); renderer.setSize(200, 200);
      hole.resize(200, 200, dpr);
      hole.render(renderer, camera, 0);
      values.push({ dpr, hidden: hole.isOccluded(renderer, camera, far), visible: !hole.isOccluded(renderer, camera, near), error: renderer.getContext().getError() });
    }
    hole.dispose(); renderer.dispose();
    return values;
  });
  for (const result of results) {
    expect(result.hidden).toBe(true);
    expect(result.visible).toBe(true);
    expect(result.error).toBe(0);
  }
});

test.describe('combined real topology high-DPI visual acceptance', () => {
  test.use({ deviceScaleFactor: 1.75 });
  test('desktop, cinematic, above, edge, reverse, below and close-flight views render without shader errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await openTools(page);
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
    await page.screenshot({ path: 'test-results/integration-desktop.png' });
    await page.getByLabel('Render quality').selectOption('cinematic');
    await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
    const shot = name => page.screenshot({ path: `test-results/integration-${name}.png` });
    const home = async () => {
      await page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true }).click();
      await page.getByRole('button', { name: 'Reset view', exact: true }).click();
      await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
    };
    const drag = async (x, y, dx, dy) => {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 14 }); await page.mouse.up();
    };
    await shot('cinematic');
    await drag(750, 390, 0, 365); await shot('above');
    // Solve world camera.y = 0 with the opening's rolled up vector and raised
    // target; OrbitControls uses 2π * 0.45 per canvas height (1000 here).
    await home(); await drag(750, 490, 0, -82.5264421234233); await shot('edge');
    await home(); await drag(160, 490, 1100, 0); await shot('reverse');
    await home(); await drag(750, 650, 0, -300); await shot('below');
    await home();
    await page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true }).click();
    await page.getByRole('button', { name: 'Fly mode', exact: true }).click();
    await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
    await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w');
    await shot('close-flight');
    await home();
    await page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true }).click();
    await page.getByLabel('Render quality').selectOption('desktop');
    await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
    const metrics = await page.evaluate(async () => {
      const canvas = document.querySelector('#observatory canvas'), gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const times = [];
      await new Promise(resolve => { let warm = 0; const tick = () => { if (++warm < 30) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      await new Promise(resolve => {
        let last;
        const tick = now => { if (last) times.push(now - last); last = now; if (times.length < 90) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
      });
      times.sort((a, b) => a - b);
      return { gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, samples: times.length, rafMedianMs: times[Math.floor(times.length / 2)], rafP95Ms: times[Math.floor(times.length * 0.95)], ...document.getElementById('observatory').dataset };
    });
    writeFileSync('test-results/integration-pacing.json', JSON.stringify(metrics, null, 2));
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
    expect(errors).toEqual([]);
  });
});

test.describe('mobile high-DPI visual acceptance', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
  test('mobile ray/trail budgets and cinematic exit stay usable on the real graph', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await openTools(page);
    const host = page.locator('#observatory');
    await expect(host).toHaveAttribute('data-quality', 'mobile');
    expect(Number(await host.getAttribute('data-ray-pixels'))).toBeLessThanOrEqual(340000);
    await expect(host).toHaveAttribute('data-note-stars', '1675');
    await expect(host).toHaveAttribute('data-trail-stars', '1675');
    expect(Number(await host.getAttribute('data-trail-segments'))).toBeLessThanOrEqual(1675 * 3);
    const caption = page.locator('#singularity-caption');
    if (await caption.isVisible()) {
      const text = await caption.boundingBox(), panel = await page.locator('#sectors-panel').boundingBox();
      expect(text.y + text.height, 'decorative caption must not overlap mobile sector controls').toBeLessThanOrEqual(panel.y);
    }
    await page.screenshot({ path: 'test-results/integration-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Cinematic view', exact: true }).tap();
    await page.screenshot({ path: 'test-results/integration-mobile-cinematic.png' });
    await page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true }).tap();
    await expect(page.locator('#sectors-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
