import { test, expect } from '@playwright/test';
import { openTools } from './tools.js';
import { makeFixture } from '../fixture.js';

const frame = page => page.locator('#observatory canvas').screenshot({ style: '.intro, #explore-tools, [data-hud], .vignette { visibility: hidden !important; }' });

async function load(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/graph.json', route => route.fulfill({ json: makeFixture() }));
  await page.goto('./');
  await openTools(page);
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
}

test('Fly mode translates with WASD/QE, drag looks, Orbit and reset remain available', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const home = await frame(page);
  await expect(page.getByRole('button', { name: 'Fly mode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fly mode', exact: true }).click();
  await expect(page.locator('#flight-help')).toBeVisible();
  await expect(page.locator('#flight-help')).toContainText('WASD');
  await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'fly');
  for (const key of ['w', 's', 'a', 'd', 'q', 'e']) {
    const before = await frame(page);
    await page.keyboard.down(key);
    await page.waitForTimeout(350);
    await page.keyboard.up(key);
    expect((await frame(page)).equals(before), `${key} translates the paused 3D camera`).toBe(false);
  }
  const beforeLook = await frame(page);
  await page.mouse.move(770, 400);
  await page.mouse.down();
  await page.mouse.move(950, 465, { steps: 8 });
  await page.mouse.up();
  expect((await frame(page)).equals(beforeLook)).toBe(false);
  const stopped = await frame(page);
  await page.waitForTimeout(200);
  expect((await frame(page)).equals(stopped), 'releasing inputs has no drift').toBe(true);
  await page.getByRole('button', { name: 'Orbit mode', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'orbit');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(async () => (await frame(page)).equals(home)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('touch flight', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('touch thrust moves in every direction and cancellation stops movement', async ({ page }) => {
    await load(page);
    await page.getByRole('button', { name: 'Fly mode', exact: true }).tap();
    const session = await page.context().newCDPSession(page);
    for (const direction of ['forward', 'back', 'left', 'right', 'down', 'up']) {
      const button = page.getByRole('button', { name: `Fly ${direction}`, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const before = await frame(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await page.waitForTimeout(350);
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      expect((await frame(page)).equals(before), `${direction} touch control moves camera`).toBe(false);
    }
    const stopped = await frame(page);
    await page.waitForTimeout(250);
    expect((await frame(page)).equals(stopped)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/flight-mobile-controls.png', fullPage: true });
  });
});

test('real topology stars move, pause exactly and remain raycastable at their new positions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await openTools(page);
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('.sector-button').first().click();
  const reticle = page.locator('#node-reticle');
  // Low-angle views correctly occlude some direct stars. Exercise a genuinely
  // visible member rather than requiring a far-side node to pierce the shadow.
  let id;
  const ids = await page.locator('#node-select option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
  for (const candidate of ids) {
    await page.getByLabel('Inspect an anonymous node').selectOption(candidate);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await reticle.isVisible()) { id = candidate; break; }
  }
  expect(id, 'at least one real member must be directly inspectable').toBeTruthy();
  await expect(reticle).toBeVisible();
  const initial = await reticle.getAttribute('style');
  const frozen = await frame(page);
  await page.waitForTimeout(200);
  expect((await frame(page)).equals(frozen), 'reduced motion freezes the rendered scene').toBe(true);
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await expect(reticle).toBeVisible();
  expect(await reticle.getAttribute('style')).not.toBe(initial);
  const pausedFrame = await frame(page);
  await page.waitForTimeout(250);
  expect((await frame(page)).equals(pausedFrame), 'pause freezes moved geometry and lens').toBe(true);
  const box = await reticle.boundingBox();
  await page.getByLabel('Inspect an anonymous node').selectOption('');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#node-id')).toHaveText(id);
  await expect(page.locator('#node-facts')).toBeVisible();
  await page.screenshot({ path: 'test-results/infall-real-selected.png', fullPage: true });
});

test('context loss exits flight and disables controls that require WebGL', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Fly mode', exact: true }).click();
  await page.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'fallback');
  await expect(page.getByRole('button', { name: 'Fly mode', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Orbit mode', exact: true })).toBeDisabled();
  await expect(page.locator('#flight-pad')).toBeHidden();
  await expect(page.locator('#view-state')).toHaveText('TOPOLOGY MODE');
});
