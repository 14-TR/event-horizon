import { test, expect } from '@playwright/test';
import { openTools } from './tools.js';
import { makeFixture } from '../fixture.js';

for (const mode of ['missing', 'invalid']) {
  test(`${mode} topology fails closed without leaking a source token`, async ({ page }) => {
    const graph = makeFixture();
    graph.nodes[0].id = 'PRIVATE_PATH_OR_TITLE';
    await page.route('**/graph.json', route => route.fulfill(mode === 'missing' ? { status: 503, body: 'unavailable' } : { json: graph }));
    await page.goto('./');
    await openTools(page);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#fallback')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('PRIVATE_PATH_OR_TITLE');
    await expect(page.locator('#pause-button')).toBeDisabled();
    await expect(page.locator('#loading-notice')).toBeHidden();
    await expect(page.locator('.sector-button')).toHaveCount(0);
  });
}

test('context loss gracefully switches from WebGL to accessible topology', async ({ page }) => {
  await page.route('**/graph.json', route => route.fulfill({ json: makeFixture() }));
  await page.goto('./');
  await openTools(page);
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'fallback');
  await expect(page.locator('#fallback-title')).toHaveText('3D is unavailable.');
  await expect(page.locator('#render-count')).toHaveText('0 / 432');
});

test('an empty valid graph renders zero notes without inventing topology', async ({ page }) => {
  await page.route('**/graph.json', route => route.fulfill({ json: { version: 1, nodes: [], edges: [], clusters: [] } }));
  await page.goto('./');
  await openTools(page);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#render-count')).toHaveText('0 / 0');
  await expect(page.locator('.sector-button')).toHaveCount(0);
  await expect(page.locator('#notes-total')).toHaveText('0');
});
