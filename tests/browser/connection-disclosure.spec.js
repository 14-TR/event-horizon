// Copyright (c) 2026 TR Ingram
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateTopology, connectedPair } from '../topology.js';
import { openTools } from './tools.js';

const graph = validateTopology(JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url))));
const byId = new Map(graph.nodes.map(node => [node.id, node]));
const hub = byId.get(connectedPair(graph).id);
const neighbors = [...new Set(graph.edges.flatMap(([a, b]) => a === hub.id ? [b] : b === hub.id ? [a] : []))]
  .map(id => byId.get(id)).sort((a, b) => a.cluster - b.cluster || a.id.localeCompare(b.id));
const profiles = [
  { name: 'C320', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, quality: 'mobile' },
  { name: 'C390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, quality: 'mobile' },
  { name: 'L844-mobile', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, quality: 'mobile', override: true },
  { name: 'L844-default', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, quality: 'desktop' },
];

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }));
}

async function observe(page, testInfo, label) {
  // Observation only: no locator focus, click or scrolling can rescue the row.
  const result = await page.evaluate(() => {
    const body = document.querySelector('.neighbor-body'), tools = document.querySelector('#explore-tools');
    const scroller = getComputedStyle(body).overflowY === 'auto' ? body : tools;
    const rect = element => {
      const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    const hit = element => {
      const r = rect(element);
      return element.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2));
    };
    const first = document.querySelector('[data-neighbor]'), row = rect(first), port = rect(scroller);
    const top = Math.max(0, port.top + scroller.clientTop);
    const bottom = Math.min(innerHeight, port.bottom, port.top + scroller.clientTop + scroller.clientHeight);
    return { row, port, topMargin: row.top - top, bottomMargin: bottom - row.bottom, firstHit: hit(first),
      firstId: first.dataset.neighbor, selected: document.querySelector('#node-select').value,
      selectedHit: hit(document.querySelector('#node-select')), locateHit: hit(document.querySelector('#locate-button')),
      scroller: scroller.id || scroller.className, scrollTop: scroller.scrollTop, toolsScrollTop: tools.scrollTop,
      documentScrollTop: document.scrollingElement.scrollTop, focused: document.activeElement?.id || document.activeElement?.tagName,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      quality: document.querySelector('#quality-select').value, userAgent: navigator.userAgent,
      page: document.querySelector('#neighbor-page').value, scope: document.querySelector('#neighbor-filter').value };
  });
  writeFileSync(testInfo.outputPath(`${label}.json`), JSON.stringify(result, null, 2));
  await testInfo.attach(label, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
  return result;
}

function expectRevealed(result) {
  expect(result.topMargin, JSON.stringify(result)).toBeGreaterThanOrEqual(5);
  expect(result.bottomMargin, JSON.stringify(result)).toBeGreaterThanOrEqual(5);
  expect(result.firstHit).toBe(true);
  expect(result.documentScrollTop).toBe(0);
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, hasTouch: true, isMobile: true });
  const errorsByPage = new WeakMap();
  test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));
  test.beforeEach(async ({ page }) => {
    const errors = [];
    errorsByPage.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Each test has fresh storage. Default means no quality preference is set.
    if (profile.override) await page.addInitScript(() => localStorage.setItem('eh-render-quality', 'mobile'));
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
    await page.goto('./');
    expect(validateTopology(await (await response).json())).toEqual(graph);
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
    await openTools(page);
    await page.locator(`.sector-button[data-cluster="${hub.cluster}"]`).click();
    await page.locator('#node-select').focus();
    await page.locator('#node-select').selectOption(hub.id);
  });
  test('initial connection disclosure reveals the complete real first neighbor', async ({ page }, testInfo) => {
    const alreadyOpen = await page.locator('#neighbor-explorer').getAttribute('open') !== null;
    // At the wide breakpoint selection itself discloses the already-open list.
    // Otherwise use a real fixed-coordinate touch, not a post-action locator.
    if (!alreadyOpen) {
      const summary = await page.locator('#neighbor-explorer summary').boundingBox();
      await page.touchscreen.tap(summary.x + summary.width / 2, summary.y + summary.height / 2);
    }
    await settle(page);
    const result = await observe(page, testInfo, 'initial-disclosure');
    expect(result.viewport).toEqual({ ...profile.viewport, dpr: profile.deviceScaleFactor });
    expect(result.quality).toBe(profile.quality);
    expect(result.firstId).toBe(neighbors[0].id);
    expect(result.selected).toBe(hub.id);
    expectRevealed(result);
    // Disclosure does not steal native focus into a destination or follow it.
    await expect(page.locator(alreadyOpen ? '#node-select' : '#neighbor-explorer summary')).toBeFocused();
    if (profile.viewport.width <= 700) {
      expect(result.selectedHit).toBe(true);
      expect(result.locateHit).toBe(true);
      expect(result.toolsScrollTop).toBe(0);
    }
    // A separate subsequent action may scroll to the always-reachable Locate.
    await page.locator('#locate-button').click();
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('#locate-button')).toBeFocused();
    await expect(page.locator('#reticle-label')).toHaveText(hub.id);
  });
  test('keyboard redisclosure retains native focus and restored Back scope/page', async ({ page }, testInfo) => {
    const details = page.locator('#neighbor-explorer'), summary = details.locator('summary');
    // Reach the summary before activating it; observe without scrolling after.
    await summary.focus();
    if (await details.getAttribute('open') !== null) {
      await page.keyboard.press('Enter');
      await expect(details).not.toHaveAttribute('open');
    }
    await page.keyboard.press('Space');
    await settle(page);
    const opened = await observe(page, testInfo, 'keyboard-open');
    expectRevealed(opened);
    expect(opened.firstId).toBe(neighbors[0].id);
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute('aria-label', 'Hide connections');
    const cross = neighbors.filter(node => node.cluster !== hub.cluster);
    const pageSize = await page.locator('[data-neighbor]').count();
    expect(cross.length, 'Require a real second cross-sector page').toBeGreaterThan(pageSize);
    await page.locator('#neighbor-filter').selectOption('cross');
    await page.locator('#neighbor-page').fill('2');
    await page.locator('#neighbor-page').press('Enter');
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('[data-neighbor]').first()).toBeFocused();
    const paged = await observe(page, testInfo, 'page-enter');
    expectRevealed(paged);
    expect(paged.firstId).toBe(cross[pageSize].id);
    await page.keyboard.press('Enter');
    await expect(page.locator('#node-select')).toHaveValue(cross[pageSize].id);
    await expect(page.locator('#history-back')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#node-select')).toHaveValue(hub.id);
    await expect(page.locator('#history-back')).toBeDisabled();
    expect(await page.evaluate(() => document.activeElement?.matches('[data-neighbor]'))).toBe(false);
    if (profile.viewport.width <= 700) await expect(details).not.toHaveAttribute('open');
    // Even wide layouts must retain context across a deliberate close/reopen.
    await summary.focus();
    if (await details.getAttribute('open') !== null) {
      await page.keyboard.press('Space');
      await expect(details).not.toHaveAttribute('open');
    }
    await page.keyboard.press('Enter');
    await settle(page);
    const restored = await observe(page, testInfo, 'restored-disclosure');
    expectRevealed(restored);
    expect(restored.selected).toBe(hub.id);
    expect(restored.firstId).toBe(cross[pageSize].id);
    expect(restored.page).toBe('2');
    expect(restored.scope).toBe('cross');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open');
    await expect(summary).toHaveAttribute('aria-label', 'Show connections');
    await expect(summary).toBeFocused();
  });
});
