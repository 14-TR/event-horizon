import { test, expect } from '@playwright/test';
import { makeFixture } from '../fixture.js';

const frame = page => page.locator('#observatory canvas').screenshot({ style: '.intro, #explore-tools, #flight-pad, [data-hud], .vignette { visibility: hidden !important; }' });

test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });
test('explicit touch flight survives closing tools, moves the real camera and stops on cancellation', async ({ page }) => {
  // Small synthetic topology bounds GPU work; the real published graph is exercised separately.
  await page.route('**/graph.json', route => route.fulfill({ json: makeFixture({ sectors: 2, perSector: 12 }) }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#flight-pad')).toBeHidden();
  await expect(page.locator('button:visible')).toHaveCount(1);
  await page.locator('#title-toggle').tap();
  await page.getByRole('button', { name: 'Fly mode', exact: true }).tap();
  await page.getByRole('button', { name: 'Close exploration controls', exact: true }).tap();
  await expect(page.locator('#explore-tools')).toBeHidden();
  await expect(page.locator('#flight-pad')).toBeVisible();
  expect(await page.locator('#flight-pad').evaluate(element => Boolean(element.closest('[inert]')))).toBe(false);
  for (const button of await page.locator('[data-flight]').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const button = page.getByRole('button', { name: 'Fly forward', exact: true });
  const box = await button.boundingBox();
  const session = await page.context().newCDPSession(page);
  const before = await frame(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(350);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const moved = await frame(page);
  expect(moved.equals(before), 'actual frozen-camera pixels must change under thrust').toBe(false);
  await page.waitForTimeout(150);
  expect((await frame(page)).equals(moved), 'released thrust must not drift').toBe(true);
  await page.getByRole('button', { name: 'Exit free flight', exact: true }).tap();
  await expect(page.locator('#flight-pad')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'orbit');
  await page.locator('#title-toggle').tap();
  await page.locator('.sector-button').first().click();
  await page.locator('#node-select').selectOption('n000001');
  await page.locator('#browse-button').click();
  await page.locator('#fly-button').click();
  await page.locator('#resume-inspection').click();
  await page.locator('#neighbor-explorer summary').click();
  await page.locator('#neighbor-next').scrollIntoViewIfNeeded();
  const drawer = await page.locator('#explore-tools').boundingBox();
  const identity = await page.locator('#node-select').boundingBox();
  expect(identity.y, 'expanded flight inspection must not scroll its fixed identity behind the drawer edge').toBeGreaterThanOrEqual(drawer.y + 10);
  const next = await page.locator('#neighbor-next').boundingBox();
  expect(next.y + next.height).toBeLessThanOrEqual(drawer.y + drawer.height - 8);
  await page.locator('[data-neighbor]').first().click();
  await expect(page.locator('#neighbor-explorer')).not.toHaveAttribute('open');
  await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'fly');
});
