import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`title-only opening discloses every tool without page overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
    const title = page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: 'Event Horizon', exact: true })).toBeVisible();
    await expect(page.locator('#explore-tools')).toBeHidden();
    await expect(page.locator('#sectors-panel')).toBeHidden();
    await expect(page.locator('#inspector')).toBeHidden();
    const visibleButtons = await page.locator('button:visible').all();
    expect(visibleButtons).toHaveLength(1);
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(viewport);
    const canvas = await page.locator('#observatory canvas').boundingBox();
    expect(canvas.width).toBe(viewport.width);
    expect(canvas.height).toBe(viewport.height);
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#explore-tools')).toBeVisible();
    await expect(page.locator('#title-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Render quality')).toBeEnabled();
    await expect(page.locator('.sector-button')).toHaveCount(8);
    await page.locator('.sector-button').first().click();
    await expect(page.getByLabel('Inspect an anonymous node')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#explore-tools')).toBeHidden();
    await expect(title).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
  });
}

test('selecting a stream brings its anonymous inspector into the drawer viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.locator('#title-toggle').click();
  await page.locator('.sector-button').first().click();
  await expect(page.getByLabel('Inspect an anonymous node')).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
});

test('small-phone flight controls stay inside the drawer with full touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.locator('#title-toggle').click();
  await page.getByRole('button', { name: 'Fly mode', exact: true }).click();
  const bounds = await page.locator('#explore-tools').evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(bounds.scroll).toBe(bounds.width);
  for (const button of await page.locator('[data-flight]').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('the keyboard skip link opens inert tools and Escape returns focus to the title', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#explore-tools')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to sector controls' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sector-list')).toBeFocused();
  await expect(page.locator('.sector-button').first()).toBeInViewport();
  await expect(page.locator('#explore-tools')).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#explore-tools')).toBeHidden();
  await expect(page.locator('#title-toggle')).toBeFocused();
});
