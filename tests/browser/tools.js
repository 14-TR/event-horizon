import { expect } from '@playwright/test';

// Functional suites intentionally enter the disclosed tools; the opening
// contract is tested separately without this helper in immersive.spec.js.
export async function openTools(page) {
  const title = page.locator('#title-toggle');
  await expect(title).toBeVisible();
  if (await title.getAttribute('aria-expanded') === 'false') await title.click();
  await expect(page.locator('#explore-tools')).toBeVisible();
}

// Compact inspection deliberately conceals global streams; navigate through
// the actual disclosure rather than clicking hidden controls or sampling IDs.
export async function browseStreams(page) {
  await openTools(page);
  if (!await page.locator('#sector-list').isVisible()) {
    await page.getByRole('button', { name: 'Browse streams', exact: true }).click();
  }
  await expect(page.locator('#sector-list')).toBeVisible();
}
