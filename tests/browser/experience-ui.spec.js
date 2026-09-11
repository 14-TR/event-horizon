import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const graph = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url)));
const byId = new Map(graph.nodes.map(node => [node.id, node]));
const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]));
for (const [a, b] of graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
const hub = [...graph.nodes].sort((a, b) => adjacency.get(b.id).size - adjacency.get(a.id).size)[0];

async function topologyOnly(page) {
  // Exercise the actual UI and actual approved topology without competing GPU work.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Explore the topology', exact: true }).click();
  await page.locator(`.sector-button[data-cluster="${hub.cluster}"]`).click();
  await expect(page.getByLabel('Inspect an anonymous node')).toBeFocused();
  await page.getByLabel('Inspect an anonymous node').selectOption(hub.id);
}

async function openNeighbors(page) {
  if (!(await page.locator('#neighbor-explorer').getAttribute('open') !== null)) await page.locator('#neighbor-explorer summary').click();
}

test('real hub has bounded neighbors, last-page access and cross-sector Back history in fallback', async ({ page }) => {
  await topologyOnly(page);
  await expect(page.locator('#neighbor-explorer')).toBeVisible();
  await openNeighbors(page);
  await expect(page.locator('#node-degree')).toHaveText('814');
  await expect(page.locator('[data-neighbor]')).toHaveCount(6);
  const lastPage = Math.ceil(adjacency.get(hub.id).size / 6);
  await page.getByLabel('Go to connection page', { exact: true }).fill(String(lastPage));
  await page.getByLabel('Go to connection page', { exact: true }).press('Enter');
  await expect(page.locator('#neighbor-range')).toHaveText('811–814 of 814');
  await expect(page.locator('[data-neighbor]')).toHaveCount(4);
  await page.getByLabel('Connection scope', { exact: true }).selectOption('cross');
  await page.getByRole('button', { name: 'Next connections', exact: true }).click();
  const beforeRange = await page.locator('#neighbor-range').textContent();
  const destination = await page.locator('[data-neighbor]').first().getAttribute('data-neighbor');
  expect(adjacency.get(hub.id).has(destination)).toBe(true);
  expect(byId.get(destination).cluster).not.toBe(hub.cluster);
  await page.locator('[data-neighbor]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#node-id')).toHaveText(destination);
  await expect(page.locator(`.sector-button[data-cluster="${byId.get(destination).cluster}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Back to / }).click();
  await expect(page.locator('#node-id')).toHaveText(hub.id);
  await expect(page.getByLabel('Connection scope', { exact: true })).toHaveValue('cross');
  await expect(page.locator('#neighbor-range')).toHaveText(beforeRange);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('#node-details')).toBeHidden();
  await expect(page.locator('#history-back')).toBeDisabled();
});

test('all published IDs remain reachable through compact mobile stream browsing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await topologyOnly(page);
  const collected = [];
  for (const cluster of [...graph.clusters].sort((a, b) => a.id - b.id)) {
    await page.getByRole('button', { name: 'Browse streams', exact: true }).click();
    await page.locator(`.sector-button[data-cluster="${cluster.id}"]`).click();
    const ids = await page.locator('#node-select option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    expect(ids.sort()).toEqual(graph.nodes.filter(node => node.cluster === cluster.id).map(node => node.id).sort());
    collected.push(...ids);
  }
  expect(new Set(collected).size).toBe(graph.nodes.length);
  expect(collected.sort()).toEqual(graph.nodes.map(node => node.id).sort());
  await testInfo.attach('mobile-all-id-coverage', { body: JSON.stringify({ count: collected.length, ids: collected }), contentType: 'application/json' });
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`compact ${viewport.width}px inspection leaves scene space and fits controls`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await topologyOnly(page);
    const drawer = await page.locator('#explore-tools').boundingBox();
    expect(drawer.height).toBeLessThan(viewport.height * 0.49);
    const overflow = await page.locator('#explore-tools').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.locator('#neighbor-explorer')).not.toHaveAttribute('open');
    for (const id of ['node-select', 'history-back', 'locate-button', 'browse-button', 'reset-button', 'close-tools']) {
      await expect(page.locator(`#${id}`)).toBeInViewport();
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await openNeighbors(page);
    await page.getByRole('button', { name: 'Next connections', exact: true }).click();
    for (const id of ['node-select', 'locate-button', 'close-tools']) await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(await page.locator('#explore-tools').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    expect((await page.locator('#explore-tools').boundingBox()).height).toBeLessThanOrEqual(viewport.height * 0.53);
    await page.getByRole('button', { name: 'Browse streams', exact: true }).click();
    await expect(page.locator('#sector-list')).toBeVisible();
    await page.getByRole('button', { name: 'Return to selected note', exact: true }).click();
    await expect(page.locator('#node-id')).toHaveText(hub.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Skip to sector controls' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sector-list')).toBeFocused();
    await expect(page.locator('.sector-button').first()).toBeInViewport();
  });
}
