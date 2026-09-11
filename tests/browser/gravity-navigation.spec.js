import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Sprint Gravity UI contract (no scene mocks or test-only production hooks):
 * - list "Connected notes", buttons "Follow n######" + optional sector text;
 * - buttons "Next connections" / "Previous connections", disabled at ends;
 * - status "Connection page", visible "1–12 of 814" range (prefix allowed);
 * - optional "Show connections" button discloses the list;
 * - "Back to previous node", "Locate selected node", existing "Reset view".
 * At most 24 mounted neighbor buttons. Smaller pages are fine; no ID sampling.
 * These cases deliberately use REAL accessible fallback, not pretend WebGL.
 * WebGL framing/true-source picking is separately required by gravity-mobile.
 */
const publicGraph = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url), 'utf8'));
const fmt = n => new Intl.NumberFormat('en-US').format(n);
const MAX_MOUNTED_NEIGHBORS = 24;
const list = page => page.getByRole('list', { name: 'Connected notes', exact: true });
const followButtons = page => list(page).getByRole('button', { name: /^Follow n\d{6,12}\b/, includeHidden: true });
const next = page => page.getByRole('button', { name: 'Next connections', exact: true });
const previous = page => page.getByRole('button', { name: 'Previous connections', exact: true });
const back = page => page.getByRole('button', { name: 'Back to previous node', exact: true });
const locate = page => page.getByRole('button', { name: 'Locate selected node', exact: true });

function fixture() {
  const nodes = Array.from({ length: 66 }, (_, i) => ({ id: `n${String(i + 1).padStart(6, '0')}`, cluster: Math.floor(i / 22) }));
  // A real fixture hub spans all three sectors, with an isolated final node.
  const edges = nodes.slice(1, 62).map(node => [nodes[0].id, node.id]);
  edges.push([nodes[22].id, nodes[44].id]);
  return { version: 1, nodes, edges, clusters: [0, 1, 2].map(id => ({ id })) };
}

function topology(raw) {
  const byId = new Map(raw.nodes.map(node => [node.id, node]));
  const adjacency = new Map(raw.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of raw.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const sectors = [...raw.clusters].sort((a, b) => a.id - b.id).map((cluster, index) => ({
    id: cluster.id, label: `Sector ${String(index + 1).padStart(2, '0')}`,
    count: raw.nodes.filter(node => node.cluster === cluster.id).length,
  }));
  const hub = [...raw.nodes].sort((a, b) => adjacency.get(b.id).size - adjacency.get(a.id).size || a.id.localeCompare(b.id))[0];
  const crossId = [...adjacency.get(hub.id)].sort().find(id => byId.get(id).cluster !== hub.cluster);
  return { byId, adjacency, sectors, hub, cross: byId.get(crossId) };
}

async function loadFallback(page, raw, { published = false } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return /webgl/i.test(kind) ? null : getContext.call(this, kind, ...args);
    };
  });
  if (!published) await page.route('**/graph.json', route => route.fulfill({ json: raw }));
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
  await page.goto('./');
  // Published cases must consume the unchanged served graph, not the fixture.
  expect(await (await response).json()).toEqual(raw);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'fallback');
  await page.getByRole('button', { name: 'Explore the topology', exact: true }).click();
}

function sectorButton(page, graph, id) {
  const sector = graph.sectors.find(sector => sector.id === id);
  return page.getByRole('button', { name: `${sector.label}, ${fmt(sector.count)} notes`, exact: true });
}

async function inspect(page, graph, node) {
  const sector = sectorButton(page, graph, node.cluster);
  if (await sector.getAttribute('aria-pressed') !== 'true') await sector.click();
  await page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true }).selectOption(node.id);
  await expect(page.locator('#node-id')).toHaveText(node.id);
  await expect(page.locator('#node-degree')).toHaveText(fmt(graph.adjacency.get(node.id).size));
}

async function enter(locator) {
  await expect(locator).toBeEnabled();
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.press('Enter');
}

async function pageIds(page) {
  if (!await list(page).isVisible()) {
    const disclosure = page.getByRole('button', { name: 'Show connections', exact: true });
    if (await disclosure.count()) await enter(disclosure);
  }
  await expect(list(page), 'A degree counter alone does not provide access to connected notes').toBeVisible();
  const names = await followButtons(page).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent));
  return names.map(name => {
    const id = name.match(/^Follow (n\d{6,12})\b/)?.[1];
    expect(id, `Neighbor button must expose its anonymous ID: ${name}`).toBeTruthy();
    return id;
  });
}

async function exhaustNeighbors(page, graph, node, testInfo) {
  const expected = [...graph.adjacency.get(node.id)].sort();
  const pages = [], collected = [];
  await pageIds(page); // Open optional progressive disclosure before pagination.
  await expect(previous(page)).toBeDisabled();
  for (let pageIndex = 0; pageIndex <= expected.length; pageIndex++) {
    const ids = await pageIds(page);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length, 'Bound mounted DOM, not just visible CSS rows').toBeLessThanOrEqual(MAX_MOUNTED_NEIGHBORS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      expect(expected, `${id} must be an actual graph neighbor of ${node.id}`).toContain(id);
      expect(collected, 'Pagination must advance without duplicates').not.toContain(id);
      // Tab through every row, not just programmatic focus on the first/last.
      const matching = list(page).getByRole('button', { name: new RegExp(`^Follow ${id}\\b`) });
      if (index === 0) await matching.focus();
      else await page.keyboard.press('Tab');
      await expect(matching).toBeFocused();
    }
    const status = page.getByRole('status', { name: 'Connection page', exact: true });
    await expect(status).toBeVisible();
    const range = (await status.innerText()).replaceAll(',', '').match(/(\d+)\s*[–−-]\s*(\d+)\s+of\s+(\d+)/i);
    expect(range, 'Expose the displayed range and full degree, not a truncated total').not.toBeNull();
    expect(range.slice(1).map(Number)).toEqual([collected.length + 1, collected.length + ids.length, expected.length]);
    pages.push(ids); collected.push(...ids);
    if (await next(page).isDisabled()) break;
    await enter(next(page));
    await expect.poll(() => pageIds(page)).not.toEqual(ids);
  }
  expect(collected.slice().sort(), 'Every real neighbor is reachable, including the hub tail').toEqual(expected);
  await expect(next(page)).toBeDisabled();
  await testInfo.attach('exhaustive-neighbor-coverage', { body: JSON.stringify({ id: node.id, degree: expected.length, maxMounted: Math.max(...pages.map(ids => ids.length)), pages, collected }, null, 2), contentType: 'application/json' });
  for (let i = pages.length - 2; i >= 0; i--) {
    await enter(previous(page));
    await expect.poll(() => pageIds(page)).toEqual(pages[i]);
  }
  await expect(previous(page)).toBeDisabled();
}

async function follow(page, graph, from, target) {
  expect(graph.adjacency.get(from.id).has(target.id), 'Never infer a connection from spatial proximity').toBe(true);
  for (let i = 0; i <= graph.adjacency.get(from.id).size; i++) {
    const ids = await pageIds(page);
    if (ids.includes(target.id)) {
      await enter(list(page).getByRole('button', { name: new RegExp(`^Follow ${target.id}\\b`) }));
      await expect(page.locator('#node-id')).toHaveText(target.id);
      await expect(page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true })).toHaveValue(target.id);
      await expect(sectorButton(page, graph, target.cluster)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#node-degree')).toHaveText(fmt(graph.adjacency.get(target.id).size));
      return;
    }
    await enter(next(page));
    await expect.poll(() => pageIds(page)).not.toEqual(ids);
  }
  throw new Error(`No reachable follow control for real edge ${from.id} → ${target.id}`);
}

const cases = [{ label: 'deterministic fixture', raw: fixture(), published: false }, { label: 'actual public graph', raw: publicGraph, published: true }];
for (const { label, raw, published } of cases) {
  test(`${label}: bounded keyboard pagination reaches every hub neighbor in accessible fallback @no-gpu`, async ({ page }, testInfo) => {
    test.setTimeout(120_000); // 814 IDs are genuinely enumerated, not sampled.
    const graph = topology(raw);
    expect(graph.adjacency.get(graph.hub.id).size).toBeGreaterThan(published ? 800 : MAX_MOUNTED_NEIGHBORS);
    expect(graph.cross).toBeTruthy();
    await loadFallback(page, raw, { published });
    await inspect(page, graph, graph.hub);
    await exhaustNeighbors(page, graph, graph.hub, testInfo);
  });

  test(`${label}: cross-sector follow, Back, unavailable Locate and Reset preserve context @no-gpu`, async ({ page }) => {
    const graph = topology(raw);
    await loadFallback(page, raw, { published });
    await inspect(page, graph, graph.hub);
    await expect(back(page)).toBeDisabled();
    await follow(page, graph, graph.hub, graph.cross);
    await expect(locate(page), 'Fallback must not offer a pretend spatial locate').toBeDisabled();
    await enter(back(page));
    await expect(page.locator('#node-id')).toHaveText(graph.hub.id);
    await expect(sectorButton(page, graph, graph.hub.cluster)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true })).toHaveValue(graph.hub.id);
    await expect(back(page), 'Back must pop history, not append another navigation').toBeDisabled();
    await follow(page, graph, graph.hub, graph.cross);
    await enter(page.getByRole('button', { name: 'Reset view', exact: true }));
    await expect(page.locator('#node-facts')).toBeHidden();
    await expect(page.locator('#node-reticle')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'orbit');
    for (const sector of graph.sectors) await expect(sectorButton(page, graph, sector.id)).toHaveAttribute('aria-pressed', 'false');
    await inspect(page, graph, graph.hub);
    await expect(back(page), 'Reset clears stale history').toBeDisabled();
  });

  test(`${label}: an isolated node clears stale neighbors and explains the empty state @no-gpu`, async ({ page }) => {
    const graph = topology(raw);
    const isolate = raw.nodes.find(node => graph.adjacency.get(node.id).size === 0);
    expect(isolate).toBeTruthy();
    await loadFallback(page, raw, { published });
    await inspect(page, graph, graph.hub);
    expect((await pageIds(page)).length).toBeGreaterThan(0);
    await inspect(page, graph, isolate);
    const disclosure = page.getByRole('button', { name: 'Show connections', exact: true });
    if (await disclosure.count()) await enter(disclosure);
    await expect(page.locator('#node-degree')).toHaveText('0');
    await expect(followButtons(page)).toHaveCount(0);
    await expect(page.getByText(/no (?:direct |published )?connections/i)).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await expect(previous(page)).toBeDisabled();
  });
}
