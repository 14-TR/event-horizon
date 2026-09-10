import { test, expect } from '@playwright/test';
import { makeFixture } from '../fixture.js';

async function loadFixture(page, fixture = makeFixture()) {
  await page.route('**/graph.json', route => route.fulfill({ json: fixture }));
  await page.goto('./');
}

test('loads a cinematic observatory with truthful anonymous topology', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = makeFixture();
  await loadFixture(page, fixture);
  await expect(page.getByRole('heading', { name: 'Event Horizon', exact: true })).toBeVisible();
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#notes-total')).toHaveText(String(fixture.nodes.length));
  await expect(page.locator('#links-total')).toHaveText(String(fixture.edges.length));
  await expect(page.getByRole('button', { name: /Sector 01.*72 notes/ }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_NOT_A_SECTOR');
  await expect(page.locator('#render-count')).toContainText('432 / 432');
  await page.screenshot({ path: 'test-results/observatory-desktop.png' });
  expect(errors).toEqual([]);
});

test('keyboard sector isolation, anonymous node inspection and reset work end to end', async ({ page }) => {
  await loadFixture(page);
  const sector = page.getByRole('button', { name: 'Sector 01, 72 notes', exact: true });
  await sector.focus();
  await page.keyboard.press('Enter');
  await expect(sector).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#view-name')).toHaveText('SECTOR 01');
  await expect(page.locator('#selection-title')).toHaveText('Sector 01');
  await expect(page.locator('#render-count')).toHaveText('72 / 432');
  await page.getByLabel('Inspect an anonymous node').selectOption('n000001');
  await expect(page.locator('#node-id')).toHaveText('n000001');
  await expect(page.locator('#node-degree')).toHaveText('6');
  await expect(page.locator('#node-reticle')).toBeVisible();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(sector).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#view-name')).toHaveText('ALL SYSTEMS');
  await expect(page.locator('#node-details')).toBeHidden();
});

test('reduced motion starts paused and orbit, zoom, resume and reset are real', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadFixture(page);
  const canvas = page.locator('#observatory canvas');
  // Element screenshots include overlapping DOM. Hide HUD to compare 3D frames.
  const frame = () => canvas.screenshot({ style: '#app > :not(.observatory) { visibility: hidden !important; }' });
  await expect(page.getByRole('button', { name: 'Resume motion', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await frame();
  await page.mouse.move(790, 410);
  await page.mouse.down();
  await page.mouse.move(955, 485, { steps: 12 });
  await page.mouse.up();
  expect((await frame()).equals(before)).toBe(false);
  const orbited = await frame();
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await frame()).equals(orbited)).toBe(false);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(async () => (await frame()).equals(before)).toBe(true);
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await expect(page.locator('#view-state')).toHaveText('LIVE ORBIT');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await expect(page.locator('#view-state')).toHaveText('MOTION PAUSED');
});

test('picks a real 3D node through raycasting rather than a decorative hotspot', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadFixture(page);
  await page.getByRole('button', { name: 'Sector 01, 72 notes', exact: true }).click();
  await page.getByLabel('Inspect an anonymous node').selectOption('n000001');
  const reticle = page.locator('#node-reticle');
  await expect(reticle).toBeVisible();
  const box = await reticle.boundingBox();
  await page.getByLabel('Inspect an anonymous node').selectOption('');
  await expect(page.locator('#node-facts')).toBeHidden();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#node-facts')).toBeVisible();
  await expect(page.locator('#node-id')).toHaveText('n000001');
});

test('WebGL fallback keeps accessible topology inspection available', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).includes('webgl')) return null;
      return getContext.call(this, type, ...args);
    };
  });
  await loadFixture(page);
  await expect(page.locator('#fallback-title')).toHaveText('3D is unavailable.');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'fallback');
  await page.getByRole('button', { name: 'Explore the topology' }).click();
  await page.getByRole('button', { name: 'Sector 01, 72 notes', exact: true }).click();
  await page.getByLabel('Inspect an anonymous node').selectOption('n000001');
  await expect(page.locator('#node-id')).toHaveText('n000001');
  await expect(page.locator('#pause-button')).toBeDisabled();
  await expect(page.locator('#render-count')).toHaveText('0 / 432');
});
