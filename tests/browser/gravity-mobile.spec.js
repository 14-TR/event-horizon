import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { makeFixture } from '../fixture.js';
import { openTools } from './tools.js';

/**
 * Real browser integration only: no replacement Observatory/locate API.
 * Navigation names share gravity-navigation's documented accessible contract.
 * Geometry IDs retained from the existing app: #node-reticle, #inspector,
 * #explore-tools. A compact selection may move the inspector outside tools.
 * The entire reticle must be in uncovered canvas; picking its source must
 * select the SAME ID. Moving an HTML reticle alone cannot satisfy this suite.
 * WebGL uniform observation is passive, verification-only and works in builds.
 * Run one worker; these are interaction checks, not GPU/performance gates.
 */
const raw = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url), 'utf8'));
const byId = new Map(raw.nodes.map(node => [node.id, node]));
const adjacency = new Map(raw.nodes.map(node => [node.id, new Set()]));
for (const [a, b] of raw.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
const hub = [...raw.nodes].sort((a, b) => adjacency.get(b.id).size - adjacency.get(a.id).size || a.id.localeCompare(b.id))[0];
const cross = byId.get([...adjacency.get(hub.id)].sort().find(id => byId.get(id).cluster !== hub.cluster));
const sectorIds = [...raw.clusters].map(cluster => cluster.id).sort((a, b) => a - b);
const fmt = n => new Intl.NumberFormat('en-US').format(n);
const locate = page => page.getByRole('button', { name: 'Locate selected node', exact: true });
const back = page => page.getByRole('button', { name: 'Back to previous node', exact: true });
const phones = [{ width: 320, height: 568 }, { width: 390, height: 844 }];

async function observeCamera(page) {
  await page.addInitScript(() => {
    const names = new WeakMap();
    const gl = WebGL2RenderingContext.prototype;
    const getUniformLocation = gl.getUniformLocation, uniformMatrix4fv = gl.uniformMatrix4fv;
    window.__gravityCamera = { matrix: null, uploads: 0 };
    gl.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    gl.uniformMatrix4fv = function (location, transpose, data, ...rest) {
      if (names.get(location) === 'uCameraToHole' && this.canvas.closest('#observatory')) {
        window.__gravityCamera.matrix = Array.from(data).slice(rest[0] || 0, (rest[0] || 0) + 16);
        window.__gravityCamera.uploads++;
      }
      return uniformMatrix4fv.call(this, location, transpose, data, ...rest);
    };
  });
}

async function settle(page, frames = 3) {
  await page.evaluate(count => new Promise(resolve => {
    const tick = () => --count > 0 ? requestAnimationFrame(tick) : resolve();
    requestAnimationFrame(tick);
  }), frames);
}

async function camera(page) {
  await settle(page);
  const value = await page.evaluate(() => window.__gravityCamera.matrix);
  expect(value, 'Observe the actual matrix submitted to the ray renderer').toHaveLength(16);
  expect(value.every(Number.isFinite)).toBe(true);
  return value;
}

async function load(page, { fixture = false } = {}) {
  await observeCamera(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Freeze motion, not controls. A smaller render budget does not sample IDs.
  await page.addInitScript(() => localStorage.setItem('eh-render-quality', 'mobile'));
  if (fixture) await page.route('**/graph.json', route => route.fulfill({ json: makeFixture({ sectors: 3, perSector: 12 }) }));
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
  await page.goto('./');
  if (!fixture) expect(await (await response).json()).toEqual(raw);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect.poll(() => page.evaluate(() => window.__gravityCamera.uploads)).toBeGreaterThan(0);
}

function sectorButton(page, clusterId) {
  const label = `Sector ${String(sectorIds.indexOf(clusterId) + 1).padStart(2, '0')}`;
  return page.getByRole('button', { name: `${label}, ${fmt(raw.nodes.filter(node => node.cluster === clusterId).length)} notes`, exact: true });
}

async function inspectHub(page) {
  await openTools(page);
  await sectorButton(page, hub.cluster).click();
  await page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true }).selectOption(hub.id);
  await expect(page.locator('#node-id')).toHaveText(hub.id);
  await expect(page.locator('#node-degree')).toHaveText(fmt(adjacency.get(hub.id).size));
  await settle(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = element => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const canvas = document.querySelector('#observatory canvas');
    const reticle = document.getElementById('node-reticle');
    const r = rect(reticle), label = rect(document.getElementById('reticle-label'));
    const blockers = [...document.querySelectorAll('.intro, #explore-tools, #inspector, [role="group"][aria-label="Flight thrust controls"]')]
      .filter(visible).map(element => ({ id: element.id || element.className, ...rect(element) }));
    const overlaps = blockers.filter(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
    const labelOverlaps = blockers.filter(b => label.left < b.right && label.right > b.left && label.top < b.bottom && label.bottom > b.top);
    return { viewport: { width: innerWidth, height: innerHeight }, canvas: rect(canvas), reticle: r, label, blockers, overlaps, labelOverlaps,
      centerHitsCanvas: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) === canvas,
      reticleVisible: visible(reticle), documentWidth: document.documentElement.scrollWidth };
  });
}

async function assertUncoveredSource(page, id, testInfo, label, { pick = true } = {}) {
  await expect(page.locator('#node-reticle')).toBeVisible();
  await expect(page.locator('#reticle-label')).toHaveText(id);
  await settle(page);
  const result = await geometry(page);
  await testInfo.attach(`${label}-geometry`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const { reticle: r, canvas: c } = result;
  expect(result.reticleVisible).toBe(true);
  expect(r.width).toBeGreaterThan(0);
  expect(r.left).toBeGreaterThanOrEqual(Math.max(0, c.left));
  expect(r.top).toBeGreaterThanOrEqual(Math.max(0, c.top));
  expect(r.right).toBeLessThanOrEqual(Math.min(result.viewport.width, c.right));
  expect(r.bottom).toBeLessThanOrEqual(Math.min(result.viewport.height, c.bottom));
  expect(result.overlaps, 'Visible does not mean uncovered: the whole reticle must avoid UI').toEqual([]);
  expect(result.labelOverlaps, 'The anonymous ID caption must also avoid UI').toEqual([]);
  expect(result.label.left).toBeGreaterThanOrEqual(Math.max(0, c.left));
  expect(result.label.top).toBeGreaterThanOrEqual(Math.max(0, c.top));
  expect(result.label.right).toBeLessThanOrEqual(Math.min(result.viewport.width, c.right));
  expect(result.label.bottom).toBeLessThanOrEqual(Math.min(result.viewport.height, c.bottom));
  expect(result.centerHitsCanvas, 'The destination must be available to direct pointer interaction').toBe(true);
  if (!pick) return;
  // A fake HTML reticle or hidden/occluded source cannot pass this real pick.
  await page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true }).selectOption('');
  // Clearing a compact selection may redisclose the large tools. Dismiss it
  // before this separate pick, without moving the camera or faking selection.
  const closeTools = page.getByRole('button', { name: 'Event Horizon — close exploration controls', exact: true });
  if (await closeTools.count()) await closeTools.click();
  await settle(page);
  await page.mouse.click((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  await expect(page.locator('#node-id')).toHaveText(id);
  await expect(page.getByRole('combobox', { name: 'Inspect an anonymous node', exact: true })).toHaveValue(id);
}

async function followCross(page) {
  expect(cross.cluster).not.toBe(hub.cluster);
  expect(adjacency.get(hub.id).has(cross.id)).toBe(true);
  const list = page.getByRole('list', { name: 'Connected notes', exact: true });
  const target = list.getByRole('button', { name: new RegExp(`^Follow ${cross.id}\\b`) });
  if (!await list.isVisible()) {
    const disclosure = page.getByRole('button', { name: 'Show connections', exact: true });
    if (await disclosure.count()) await disclosure.click();
  }
  await expect(list).toBeVisible();
  for (let i = 0; i <= adjacency.get(hub.id).size; i++) {
    if (await target.count()) {
      await target.focus();
      await target.press('Enter');
      await expect(page.locator('#node-id')).toHaveText(cross.id);
      await expect(sectorButton(page, cross.cluster)).toHaveAttribute('aria-pressed', 'true');
      return;
    }
    const next = page.getByRole('button', { name: 'Next connections', exact: true });
    await expect(next).toBeEnabled();
    await next.press('Enter');
  }
  throw new Error(`The actual cross-sector edge ${hub.id} → ${cross.id} is unreachable`);
}

for (const viewport of phones) {
  test(`selected real hub leaves a compact inspector without horizontal clipping at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await load(page);
    await inspectHub(page);
    await expect(page.locator('#inspector')).toBeInViewport();
    const layout = await page.evaluate(() => {
      const inspector = document.getElementById('inspector');
      const tools = document.getElementById('explore-tools');
      const visible = element => element?.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const visibleRect = element => visible(element) ? element.getBoundingClientRect() : { height: 0 };
      const bad = [...inspector.querySelectorAll('button, select, [role="list"]'), inspector, tools].filter(visible)
        .filter(element => element.scrollWidth > element.clientWidth + 1)
        .map(element => ({ id: element.id, role: element.getAttribute('role'), width: element.clientWidth, scroll: element.scrollWidth }));
      return { inspectorHeight: visibleRect(inspector).height, toolsHeight: visibleRect(tools).height, viewportHeight: innerHeight,
        overflows: bad, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    await testInfo.attach('compact-selection-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
    await testInfo.attach('selected-source-before-locate', { body: JSON.stringify(await geometry(page), null, 2), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath(`selected-hub-${viewport.width}.png`) });
    expect(layout.overflows).toEqual([]);
    expect(layout.pageWidth).toBeLessThanOrEqual(viewport.width);
    // Explicit compact contract: selection leaves at least half the scene's
    // height, not the baseline 64svh dashboard. Internal vertical paging is OK.
    expect(Math.max(layout.toolsHeight, layout.inspectorHeight), 'Compact selected inspection must leave half the scene uncovered').toBeLessThanOrEqual(viewport.height * 0.5);
  });

  test(`real cross-sector follow, Back, Locate and Reset keep a pickable uncovered source at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await load(page);
    const home = await camera(page);
    await inspectHub(page);
    await expect(locate(page), 'The real UI must integrate the spatial locate API').toBeEnabled();
    await locate(page).click();
    const located = await camera(page);
    await settle(page, 8);
    expect(await camera(page), 'Reduced-motion Locate must already be settled, not keep tweening').toEqual(located);
    await assertUncoveredSource(page, hub.id, testInfo, 'located-hub');
    await followCross(page);
    // Follow itself must locate; do NOT call Locate to hide a missing flight.
    // Avoid clearing/re-picking mid-history: that is a separate user action.
    await assertUncoveredSource(page, cross.id, testInfo, 'followed-cross-sector', { pick: false });
    await back(page).click();
    await expect(page.locator('#node-id')).toHaveText(hub.id);
    await expect(sectorButton(page, hub.cluster)).toHaveAttribute('aria-pressed', 'true');
    await locate(page).click();
    await assertUncoveredSource(page, hub.id, testInfo, 'returned-hub', { pick: false });
    await followCross(page);
    await assertUncoveredSource(page, cross.id, testInfo, 'cross-sector-direct-pick');
    await openTools(page);
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(page.locator('#node-reticle')).toBeHidden();
    await expect(page.locator('#node-facts')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'orbit');
    await expect(page.locator('#render-count')).toHaveText(`${fmt(raw.nodes.length)} / ${fmt(raw.nodes.length)}`);
    await expect.poll(() => camera(page)).toEqual(home);
  });
}

for (const viewport of [{ width: 960, height: 720 }, ...phones]) {
  test(`untouched opening has title only and no opt-in flight UI at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await load(page);
    const title = page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#explore-tools')).toBeHidden();
    await expect(page.getByRole('group', { name: 'Flight thrust controls', exact: true })).toBeHidden();
    await expect(page.locator('button:visible')).toHaveCount(1);
    await expect(page.locator('#inspector')).toBeHidden();
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(viewport);
    await page.screenshot({ path: testInfo.outputPath(`untouched-${viewport.width}.png`) });
  });
}

async function startThrust(page, session, direction = 'forward') {
  const button = page.getByRole('button', { name: `Fly ${direction}`, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  const before = await camera(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect.poll(() => camera(page), { timeout: 4000 }).not.toEqual(before);
  return button;
}

async function assertStopped(page) {
  const stopped = await camera(page);
  await settle(page, 8);
  expect(await camera(page), 'Thrust release must stop the actual camera, not just restyle a button').toEqual(stopped);
}

test.describe('immersive touch thrust', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('explicit Fly survives closing tools and every held direction cancels without drift', async ({ page }) => {
    await load(page, { fixture: true });
    await openTools(page);
    await page.getByRole('button', { name: 'Fly mode', exact: true }).tap();
    await page.getByRole('button', { name: 'Event Horizon — close exploration controls', exact: true }).tap();
    await expect(page.locator('#explore-tools')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-navigation', 'fly');
    const pad = page.getByRole('group', { name: 'Flight thrust controls', exact: true });
    await expect(pad, 'Opt-in flight must remain usable outside the large closed tools drawer').toBeVisible();
    expect(await pad.evaluate(element => Boolean(element.closest('[inert], #explore-tools')))).toBe(false);
    const session = await page.context().newCDPSession(page);
    for (const direction of ['forward', 'back', 'left', 'right', 'down', 'up']) {
      await startThrust(page, session, direction);
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await assertStopped(page);
    }
    await openTools(page);
    await page.getByRole('button', { name: 'Orbit mode', exact: true }).click();
    await expect(pad).toBeHidden();
  });

  // Independent cleanup cases also run with tools OPEN: a missing immersive pad
  // cannot mask a stuck-input bug in the existing flight controls.
  for (const release of ['pointercancel', 'lostpointercapture', 'window-blur', 'document-hidden']) {
    test(`${release} releases held touch thrust in the real renderer`, async ({ page }) => {
      await load(page, { fixture: true });
      await openTools(page);
      await page.getByRole('button', { name: 'Fly mode', exact: true }).tap();
      const session = await page.context().newCDPSession(page);
      await page.evaluate(() => {
        document.addEventListener('pointerdown', event => { window.__gravityPointerId = event.pointerId; }, { capture: true });
      });
      const button = await startThrust(page, session);
      if (release === 'pointercancel') await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      if (release === 'lostpointercapture') {
        // Pointer capture is pending until another pointer event. Establish it
        // before releasing, then flush the actual lostpointercapture event.
        // Releasing a pending request without this never tests the listener.
        const box = await button.boundingBox();
        await button.evaluate(element => element.addEventListener('lostpointercapture', () => { window.__gravityLostCapture = true; }, { once: true }));
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2 + 1, y: box.y + box.height / 2 }] });
        expect(await button.evaluate(element => element.hasPointerCapture(window.__gravityPointerId))).toBe(true);
        await button.evaluate(element => element.releasePointerCapture(window.__gravityPointerId));
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2 + 2, y: box.y + box.height / 2 }] });
        await expect.poll(() => page.evaluate(() => window.__gravityLostCapture)).toBe(true);
      }
      if (release === 'window-blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (release === 'document-hidden') {
        // Chromium headless does not background reliably via bringToFront.
        // Change only the platform visibility signal, never controls/camera.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
          delete document.hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      await assertStopped(page);
      // End AFTER asserting no drift; ending earlier would conceal failed cleanup.
      if (release !== 'pointercancel') await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    });
  }
});
