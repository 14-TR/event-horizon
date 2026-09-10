import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url), 'utf8'));
const fmt = n => new Intl.NumberFormat('en-US').format(n);

test('real public topology has truthful counts and discoverable tiny sectors', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#notes-total')).toHaveText(fmt(raw.nodes.length));
  await expect(page.locator('#links-total')).toHaveText(fmt(raw.edges.length));
  await expect(page.locator('.sector-button')).toHaveCount(raw.clusters.length);
  await expect(page.locator('#render-count')).toHaveText(`${fmt(raw.nodes.length)} / ${fmt(raw.nodes.length)}`);
  await expect(page.locator('#sector-status')).toHaveText('ALL NOTES FORM THE DISK');
  await page.screenshot({ path: 'test-results/real-topology-desktop.png', fullPage: true });
  const smallest = [...raw.clusters].sort((a, b) => a.count - b.count)[0];
  await page.locator(`.sector-button[data-cluster="${smallest.id}"]`).click();
  const node = raw.nodes.find(n => n.cluster === smallest.id);
  await page.getByLabel('Inspect an anonymous node').selectOption(node.id);
  await expect(page.locator('#node-id')).toHaveText(node.id);
  await expect(page.locator('#node-reticle')).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('real mobile observatory stays in bounds and exposes the inspector and privacy dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#render-count')).toHaveText(`${fmt(raw.nodes.length)} / ${fmt(raw.nodes.length)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/real-topology-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'About this observatory' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('fingerprint');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const first = raw.clusters[0];
  await page.locator(`.sector-button[data-cluster="${first.id}"]`).click();
  await expect(page.getByLabel('Inspect an anonymous node')).toBeVisible();
  const node = raw.nodes.find(n => n.cluster === first.id);
  await page.getByLabel('Inspect an anonymous node').selectOption(node.id);
  await expect(page.locator('#node-id')).toHaveText(node.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/real-topology-mobile-inspector.png', fullPage: true });
});
