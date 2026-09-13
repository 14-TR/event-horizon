import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateTopology, connectedPair } from '../topology.js';
import { openTools } from './tools.js';

const graph = validateTopology(JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url))));
const byId = new Map(graph.nodes.map(node => [node.id, node]));
const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]));
for (const [a, b] of graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
const hub = byId.get(connectedPair(graph).id);
const neighbors = [...adjacency.get(hub.id)].map(id => byId.get(id))
  .sort((a, b) => a.cluster - b.cluster || a.id.localeCompare(b.id));
const viewports = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];

const errorsByPage = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

async function inspectHub(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
  await page.goto('./');
  expect(validateTopology(await (await response).json())).toEqual(graph);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await openTools(page);
  await page.locator(`.sector-button[data-cluster="${hub.cluster}"]`).click();
  await page.locator('#node-select').selectOption(hub.id);
  if (await page.locator('#neighbor-explorer').getAttribute('open') === null) {
    await page.locator('#neighbor-explorer summary').click();
  }
}

async function resultGeometry(page) {
  // Pure observation: locator scrolling/focus here would conceal the regression.
  return page.evaluate(() => {
    const body = document.querySelector('.neighbor-body');
    const tools = document.querySelector('#explore-tools');
    const scroller = getComputedStyle(body).overflowY === 'auto' ? body : tools;
    const row = document.querySelector('[data-neighbor]');
    const rect = element => {
      const { top, right, bottom, left, height } = element.getBoundingClientRect();
      return { top, right, bottom, left, height };
    };
    const port = rect(scroller), first = rect(row);
    const visibleTop = Math.max(0, port.top + scroller.clientTop);
    const visibleBottom = Math.min(innerHeight, port.bottom, port.top + scroller.clientTop + scroller.clientHeight);
    return {
      port, first, visibleTop, visibleBottom, scrollTop: scroller.scrollTop,
      toolsScrollTop: tools.scrollTop, documentScrollTop: document.scrollingElement.scrollTop,
      firstFullyVisible: first.top >= visibleTop && first.bottom <= visibleBottom,
      firstHit: row.contains(document.elementFromPoint((first.left + first.right) / 2, (first.top + first.bottom) / 2)),
      focused: document.activeElement?.dataset.neighbor || document.activeElement?.id,
      ids: [...document.querySelectorAll('[data-neighbor]')].map(button => button.dataset.neighbor),
      page: document.querySelector('#neighbor-page').value,
      scope: document.querySelector('#neighbor-filter').value,
    };
  });
}

async function recordResult(page, testInfo, label) {
  const result = await resultGeometry(page);
  const path = testInfo.outputPath(`${label}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  await testInfo.attach(label, { path, contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
  // Full-row visibility alone misses subpixel clipping of the focus outline.
  expect(result.first.top - result.visibleTop, JSON.stringify(result)).toBeGreaterThanOrEqual(5);
  expect(result.visibleBottom - result.first.bottom, JSON.stringify(result)).toBeGreaterThanOrEqual(5);
  expect(result.firstHit).toBe(true);
  return result;
}

for (const viewport of viewports) {
  test(`dirty page input then pointer Next commits before advancing at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await inspectHub(page);
    const pageSize = await page.locator('[data-neighbor]').count();
    expect(neighbors.length, 'Require a real third page').toBeGreaterThan(pageSize * 2);
    // Do not press Enter/Tab: pointer-down would blur and commit this edit.
    await page.locator('#neighbor-page').fill('2');
    await page.locator('#neighbor-next').click();
    const result = await recordResult(page, testInfo, `dirty-next-${viewport.width}`);
    expect(result.page).toBe('3');
    expect(result.ids).toEqual(neighbors.slice(pageSize * 2, pageSize * 3).map(node => node.id));
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
    expect(result.firstHit).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
    expect(result.documentScrollTop).toBe(0);
  });
  for (const [control, startPage, dirtyPage, expectedPage] of [
    ['neighbor-next', 1, 2, 3], ['neighbor-prev', 2, 3, 2],
  ]) {
    test(`dirty page input preserves held ${control} activation at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await inspectHub(page);
      const pageSize = await page.locator('[data-neighbor]').count();
      expect(neighbors.length, 'Require a real third page').toBeGreaterThan(pageSize * 2);
      await page.locator('#neighbor-page').fill(String(startPage));
      await page.locator('#neighbor-page').press('Enter');
      await page.locator('#neighbor-page').fill(String(dirtyPage));
      // Scroll only before pressing, then hold the real pointer at fixed coordinates.
      const button = page.locator(`#${control}`);
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      const before = await resultGeometry(page);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      let held;
      try {
        // A human-held press must not be masked by a delayed reveal.
        await page.waitForTimeout(400);
        held = await resultGeometry(page);
      } finally { await page.mouse.up(); }
      const result = await recordResult(page, testInfo, `dirty-held-${control}-${viewport.width}`);
      expect(held.ids).toEqual(before.ids);
      expect(held.focused).toBe('neighbor-page');
      expect(held.scrollTop).toBe(before.scrollTop);
      expect(result.page).toBe(String(expectedPage));
      expect(result.ids).toEqual(neighbors.slice((expectedPage - 1) * pageSize, expectedPage * pageSize).map(node => node.id));
      expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
      expect(result.firstHit).toBe(true);
      expect(result.focused).toBe(result.ids[0]);
      await expect(page.locator('#node-select')).toHaveValue(hub.id);
    });
    test(`dirty page input survives cancelled ${control} press at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await inspectHub(page);
      const pageSize = await page.locator('[data-neighbor]').count();
      expect(neighbors.length).toBeGreaterThan(pageSize * 2);
      await page.locator('#neighbor-page').fill(String(startPage));
      await page.locator('#neighbor-page').press('Enter');
      await page.locator('#neighbor-page').fill(String(dirtyPage));
      const button = page.locator(`#${control}`);
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      const before = await resultGeometry(page);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      try { await page.mouse.move(1, 1); } finally { await page.mouse.up(); }
      const cancelled = await resultGeometry(page);
      expect(cancelled.ids).toEqual(before.ids);
      expect(cancelled.page).toBe(String(dirtyPage));
      expect(cancelled.focused).toBe('neighbor-page');
      expect(cancelled.scrollTop).toBe(before.scrollTop);
      await expect(page.locator('#node-select')).toHaveValue(hub.id);
      // No pending-pointer state: a subsequent ordinary Tab still commits/reveals.
      await page.keyboard.press('Tab');
      const result = await recordResult(page, testInfo, `dirty-cancel-${control}-${viewport.width}`);
      expect(result.ids).toEqual(neighbors.slice((dirtyPage - 1) * pageSize, dirtyPage * pageSize).map(node => node.id));
      expect(result.firstFullyVisible).toBe(true);
      expect(result.focused).toBe(result.ids[0]);
    });
  }
  test(`dirty page input is clamped before pointer paging at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await inspectHub(page);
    const pageSize = await page.locator('[data-neighbor]').count();
    const lastPage = Math.ceil(neighbors.length / pageSize);
    expect(lastPage).toBeGreaterThan(2);
    for (const [control, value, expectedPage] of [
      ['neighbor-next', String(lastPage + 10), lastPage],
      ['neighbor-prev', String(lastPage + 10), lastPage - 1],
      ['neighbor-next', '', 2], ['neighbor-prev', '0', 1],
    ]) {
      await page.locator('#neighbor-page').fill('2');
      await page.locator('#neighbor-page').press('Enter');
      await page.locator('#neighbor-page').fill(value);
      await page.locator(`#${control}`).click();
      const result = await recordResult(page, testInfo, `dirty-bound-${control}-${value || 'empty'}-${viewport.width}`);
      expect(result.page).toBe(String(expectedPage));
      expect(result.ids).toEqual(neighbors.slice((expectedPage - 1) * pageSize, expectedPage * pageSize).map(node => node.id));
      expect(result.firstFullyVisible).toBe(true);
      expect(result.focused).toBe(result.ids[0]);
      expect(await page.locator('#neighbor-prev').isDisabled()).toBe(expectedPage === 1);
      expect(await page.locator('#neighbor-next').isDisabled()).toBe(expectedPage === lastPage);
      await expect(page.locator('#node-select')).toHaveValue(hub.id);
    }
  });
  test(`Next reveals the first actual neighbor at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await inspectHub(page);
    const pageSize = await page.locator('[data-neighbor]').count();
    expect(neighbors.length, 'Require a real second page; do not silently skip').toBeGreaterThan(pageSize);
    // Real pointer activation scrolls the footer into view BEFORE navigation.
    await page.getByRole('button', { name: 'Next connections', exact: true }).click();
    await expect(page.locator('#neighbor-page')).toHaveValue('2');
    const result = await recordResult(page, testInfo, `after-next-${viewport.width}`);
    expect(result.ids).toEqual(neighbors.slice(pageSize, pageSize * 2).map(node => node.id));
    expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
    expect(result.firstHit).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
    expect(result.documentScrollTop).toBe(0);
  });
  test(`keyboard paging, follow and Back preserve real scope/page at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await inspectHub(page);
    const pageSize = await page.locator('[data-neighbor]').count();
    const cross = neighbors.filter(node => node.cluster !== hub.cluster);
    expect(cross.length).toBeGreaterThan(pageSize);
    await page.locator('#neighbor-filter').focus();
    await page.locator('#neighbor-filter').selectOption('cross');
    await page.locator('#neighbor-next').focus();
    await page.keyboard.press('Enter');
    let result = await recordResult(page, testInfo, `keyboard-next-${viewport.width}`);
    expect(result.page).toBe('2');
    expect(result.ids).toEqual(cross.slice(pageSize, pageSize * 2).map(node => node.id));
    expect(result.firstFullyVisible).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
    await page.locator('#neighbor-prev').focus();
    await page.keyboard.press('Space');
    result = await recordResult(page, testInfo, `keyboard-previous-${viewport.width}`);
    expect(result.page).toBe('1');
    expect(result.firstFullyVisible).toBe(true);
    expect(result.focused).toBe(cross[0].id);
    await page.locator('#neighbor-page').fill('2');
    await page.locator('#neighbor-page').press('Enter');
    // The page-input Enter must ONLY reveal; a second Enter follows the row.
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('[data-neighbor]').first()).toBeFocused();
    const range = await page.locator('#neighbor-range').textContent();
    const destination = cross[pageSize];
    expect(adjacency.get(hub.id).has(destination.id)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#node-select')).toHaveValue(destination.id);
    await expect(page.locator('#history-back')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('#neighbor-page')).toHaveValue('2');
    await expect(page.locator('#neighbor-filter')).toHaveValue('cross');
    await expect(page.locator('#neighbor-range')).toHaveText(range);
    // Back exhausts history here, so the browser may blur its disabled button.
    // Context renders must not steal focus into results or reopen mobile details.
    await expect(page.locator('#history-back')).toBeDisabled();
    expect(await page.evaluate(() => document.activeElement?.matches('[data-neighbor]'))).toBe(false);
    if (viewport.width <= 700) await expect(page.locator('#neighbor-explorer')).not.toHaveAttribute('open');
    await page.locator('#locate-button').click();
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('#locate-button')).toBeFocused();
    await expect(page.locator('#reticle-label')).toHaveText(hub.id);
    await expect(page.locator('#neighbor-filter')).toHaveValue('cross');
    await expect(page.locator('#neighbor-page')).toHaveValue('2');
    await page.screenshot({ path: testInfo.outputPath(`back-locate-${viewport.width}.png`) });
  });
  test(`page bounds and empty-scope recovery stay usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await inspectHub(page);
    const pageSize = await page.locator('[data-neighbor]').count();
    const lastPage = Math.ceil(neighbors.length / pageSize);
    await page.locator('#neighbor-page').fill(String(lastPage + 10));
    await page.locator('#neighbor-page').press('Enter');
    let result = await recordResult(page, testInfo, `last-page-${viewport.width}`);
    expect(result.page).toBe(String(lastPage));
    expect(result.ids).toEqual(neighbors.slice((lastPage - 1) * pageSize).map(node => node.id));
    expect(result.firstFullyVisible).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
    await expect(page.locator('#neighbor-next')).toBeDisabled();
    await page.locator('#neighbor-page').fill('');
    await page.locator('#neighbor-page').press('Enter');
    result = await recordResult(page, testInfo, `first-page-${viewport.width}`);
    expect(result.page).toBe('1');
    expect(result.ids).toEqual(neighbors.slice(0, pageSize).map(node => node.id));
    expect(result.firstFullyVisible).toBe(true);
    await expect(page.locator('#neighbor-prev')).toBeDisabled();
    const crossOnly = graph.nodes.find(node => adjacency.get(node.id).size > 0 &&
      [...adjacency.get(node.id)].every(id => byId.get(id).cluster !== node.cluster));
    expect(crossOnly, 'Require a real empty within-stream scope').toBeTruthy();
    await page.locator('#browse-button').click();
    await page.locator(`.sector-button[data-cluster="${crossOnly.cluster}"]`).click();
    await page.locator('#node-select').selectOption(crossOnly.id);
    if (await page.locator('#neighbor-explorer').getAttribute('open') === null) await page.locator('#neighbor-explorer summary').click();
    await page.locator('#neighbor-filter').focus();
    await page.locator('#neighbor-filter').selectOption('within');
    await expect(page.locator('[data-neighbor]')).toHaveCount(0);
    await expect(page.locator('#neighbor-filter')).toBeFocused();
    await expect(page.locator('#neighbor-empty')).toHaveText('No connections in this scope. Try all connections.');
    await expect(page.locator('#neighbor-paging')).toBeHidden();
    await page.locator('#neighbor-filter').selectOption('all');
    result = await recordResult(page, testInfo, `scope-recovery-${viewport.width}`);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.every(id => adjacency.get(crossOnly.id).has(id))).toBe(true);
    expect(result.firstFullyVisible).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
  });
  for (const action of ['previous', 'page-enter', 'page-change', 'scope-cross', 'scope-within']) {
    test(`${action} reveals the first actual neighbor at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await inspectHub(page);
      const pageSize = await page.locator('[data-neighbor]').count();
      expect(neighbors.length).toBeGreaterThan(pageSize);
      let expected = neighbors.slice(pageSize, pageSize * 2);
      let expectedPage = '2';
      let scope = 'all';
      if (action === 'previous') {
        await page.locator('#neighbor-next').click();
        await page.locator('#neighbor-prev').click();
        expected = neighbors.slice(0, pageSize);
        expectedPage = '1';
      } else if (action.startsWith('scope-')) {
        scope = action.slice('scope-'.length);
        // Begin at the bottom, then reach the real native scope control.
        await page.locator('#neighbor-next').click();
        await page.locator('#neighbor-filter').focus();
        await page.locator('#neighbor-filter').selectOption(scope);
        expected = neighbors.filter(node => (node.cluster === hub.cluster) === (scope === 'within')).slice(0, pageSize);
        expect(expected.length, 'Require a nonempty real scope').toBeGreaterThan(0);
        expectedPage = '1';
      } else {
        await page.locator('#neighbor-page').fill('2');
        await page.locator('#neighbor-page').press(action === 'page-enter' ? 'Enter' : 'Tab');
      }
      const result = await recordResult(page, testInfo, `${action}-${viewport.width}`);
      expect(result.ids).toEqual(expected.map(node => node.id));
      expect(result.page).toBe(expectedPage);
      expect(result.scope).toBe(scope);
      expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
      expect(result.firstHit).toBe(true);
      expect(result.focused).toBe(result.ids[0]);
      expect(result.documentScrollTop).toBe(0);
      if (viewport.width <= 700) {
        expect(result.toolsScrollTop).toBe(0);
        for (const id of ['node-select', 'locate-button']) {
          expect(await page.locator(`#${id}`).evaluate(element => {
            const r = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          })).toBe(true);
        }
      }
    });
  }
}

test('paging in the disclosed mobile stream browser uses its outer scroller', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await inspectHub(page);
  await page.locator('#browse-button').click();
  await expect(page.locator('#explore-tools')).toHaveAttribute('data-panel', 'browse');
  await page.locator('#neighbor-next').click();
  const result = await recordResult(page, testInfo, 'browse-next-320');
  expect(result.page).toBe('2');
  expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
  expect(result.firstHit).toBe(true);
  expect(result.focused).toBe(result.ids[0]);
  expect(result.documentScrollTop).toBe(0);
});

test('dirty page input preserves pointer paging in the outer mobile Browse scroller', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await inspectHub(page);
  await page.locator('#browse-button').click();
  await expect(page.locator('#explore-tools')).toHaveAttribute('data-panel', 'browse');
  const pageSize = await page.locator('[data-neighbor]').count();
  expect(neighbors.length).toBeGreaterThan(pageSize * 2);
  for (const [control, value, expectedPage] of [['neighbor-next', '2', 3], ['neighbor-prev', '2', 1]]) {
    await page.locator('#neighbor-page').fill(value);
    await page.locator(`#${control}`).click();
    const result = await recordResult(page, testInfo, `dirty-browse-${control}`);
    expect(result.page).toBe(String(expectedPage));
    expect(result.ids).toEqual(neighbors.slice((expectedPage - 1) * pageSize, expectedPage * pageSize).map(node => node.id));
    expect(result.firstFullyVisible, JSON.stringify(result)).toBe(true);
    expect(result.firstHit).toBe(true);
    expect(result.focused).toBe(result.ids[0]);
    expect(result.documentScrollTop).toBe(0);
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
  }
});

test.describe('touch paging', () => {
  test.use({ hasTouch: true });
  for (const viewport of viewports.filter(viewport => viewport.width <= 700)) {
    test(`dirty page input preserves touch Next and Previous at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await inspectHub(page);
      const pageSize = await page.locator('[data-neighbor]').count();
      expect(neighbors.length).toBeGreaterThan(pageSize * 2);
      for (const [control, value, expectedPage] of [['neighbor-next', '2', 3], ['neighbor-prev', '2', 1]]) {
        await page.locator('#neighbor-page').fill(value);
        await page.locator(`#${control}`).tap();
        const result = await recordResult(page, testInfo, `dirty-touch-${control}-${viewport.width}`);
        expect(result.page).toBe(String(expectedPage));
        expect(result.ids).toEqual(neighbors.slice((expectedPage - 1) * pageSize, expectedPage * pageSize).map(node => node.id));
        expect(result.firstFullyVisible).toBe(true);
        expect(result.firstHit).toBe(true);
        expect(result.focused).toBe(result.ids[0]);
        expect(result.toolsScrollTop).toBe(0);
        await expect(page.locator('#node-select')).toHaveValue(hub.id);
      }
    });
    test(`touch Next and Previous reveal complete rows at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await inspectHub(page);
      for (const [control, expectedPage] of [['neighbor-next', '2'], ['neighbor-prev', '1']]) {
        await page.locator(`#${control}`).tap();
        const result = await recordResult(page, testInfo, `touch-${control}-${viewport.width}`);
        expect(result.page).toBe(expectedPage);
        expect(result.firstFullyVisible).toBe(true);
        expect(result.firstHit).toBe(true);
        expect(result.focused).toBe(result.ids[0]);
        expect(result.toolsScrollTop).toBe(0);
      }
      await page.locator('#title-toggle').tap();
      await expect(page.locator('#explore-tools')).toBeHidden();
    });
  }
});
