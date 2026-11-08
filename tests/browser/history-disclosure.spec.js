import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { connectedPair, validateTopology } from '../topology.js';
import { uncoveredRect } from '../../src/inspection-space.js';

test.use({ hasTouch: true });

const summary = 'Cumulative atlas · legacy may overlap current notes';
const disclosure = 'UNMAPPED legacy stars and connections are retained. Their original note mappings are unavailable and they may overlap currently tracked notes. Star totals are cumulative atlas records, not a unique current-note count.';

async function ready(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
}

async function noticeGeometry(page) {
  const geometry = await page.locator('#history-notice').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
      hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      inert: Boolean(el.closest('[inert]')), scroll: document.documentElement.scrollWidth, viewport: innerWidth, viewportHeight: innerHeight };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.hit).toBe(true);
  expect(geometry.inert).toBe(false);
  expect(geometry.scroll).toBe(geometry.viewport);
  return geometry;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`history disclosure remains reachable at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
    await info.attach('renderer', { body: JSON.stringify(await page.locator('#observatory canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    })), contentType: 'application/json' });
    const notice = page.getByRole('button', { name: summary, exact: true });
    await expect(notice).toBeVisible();
    await expect(page.locator('#explore-tools')).toBeHidden();
    await expect(page.locator('button:visible')).toHaveCount(2);
    await noticeGeometry(page);
    if (info.project.use.channel === 'chromium') await page.screenshot({ path: info.outputPath('opening.png') });
    // The normal Tab order reaches the notice without disclosing the tools.
    await page.locator('#title-toggle').focus();
    await page.keyboard.press('Tab');
    await expect(notice).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#about-dialog')).toBeVisible();
    await expect(page.locator('#close-about')).toBeFocused();
    expect(await page.locator('#about-dialog').evaluate(el => el.matches(':modal'))).toBe(true);
    await expect(page.locator('#about-history-disclosure')).toHaveText(disclosure);
    await page.locator('#about-history-disclosure').scrollIntoViewIfNeeded();
    await expect(page.locator('#about-history-disclosure')).toBeInViewport({ ratio: 1 });
    if (info.project.use.channel === 'chromium') await page.screenshot({ path: info.outputPath('about-history.png') });
    await page.keyboard.press('Escape');
    await expect(notice).toBeFocused();
    await expect(page.locator('#explore-tools')).toBeHidden();
    await page.locator('#title-toggle').click();
    await page.locator('#history-disclosure').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('#history-disclosure')).toHaveText(disclosure);
    await expect(page.locator('#history-disclosure')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.telemetry')).toContainText('CUMULATIVE STARS');
    await expect(page.locator('.telemetry')).toContainText('CUMULATIVE CONNECTIONS');
    expect(await page.locator('#history-disclosure').evaluate(el => el.previousElementSibling.classList.contains('telemetry'))).toBe(true);
    expect(await page.locator('#explore-tools').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    await noticeGeometry(page);
    if (info.project.use.channel === 'chromium') await page.screenshot({ path: info.outputPath('browse-history.png') });
    await info.attach('notice-geometry', { body: JSON.stringify(await noticeGeometry(page)), contentType: 'application/json' });
  });

  test(`history notice remains available during inspection at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await page.locator('#title-toggle').click();
    // Bound software-rendered interaction cost; the separate opening case
    // retains the default quality at every viewport, including desktop.
    await page.getByLabel('Render quality').selectOption('mobile');
    await page.locator('.sector-button').first().click();
    await page.locator('#node-select').selectOption({ index: 1 });
    await expect(page.locator('#history-disclosure')).toBeHidden();
    await expect(page.locator('#node-select')).toBeInViewport();
    await noticeGeometry(page);
    await page.locator('#history-notice').tap();
    await expect(page.locator('#about-dialog')).toBeVisible();
    await expect(page.locator('#about-history-disclosure')).toHaveText(disclosure);
    await page.locator('#close-about').click();
    await expect(page.locator('#history-notice')).toBeFocused();
  });
}

test('compact Fly Locate keeps the complete selected reticle and ID uncovered at 320x568', async ({ page }, info) => {
  const graph = validateTopology(JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url))));
  const { id } = connectedPair(graph);
  const hub = graph.nodes.find(node => node.id === id);
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page);
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('#title-toggle').click();
  await page.getByLabel('Render quality').selectOption('mobile');
  await page.locator(`.sector-button[data-cluster="${hub.cluster}"]`).click();
  await page.locator('#node-select').selectOption(hub.id);
  for (const mode of ['orbit', 'fly']) {
    if (mode === 'fly') {
      await page.locator('#browse-button').click();
      await page.getByRole('button', { name: 'Fly mode', exact: true }).click();
      await page.locator('#resume-inspection').click();
      await expect(page.locator('#flight-pad')).toBeVisible();
    }
    await page.locator('#locate-button').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const geometry = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const visible = el => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const reticle = document.querySelector('#node-reticle');
      const label = document.querySelector('#reticle-label');
      const blockers = [...document.querySelectorAll('.intro,#explore-tools,#flight-pad,#history-notice,#fallback')].filter(visible).map(el => ({ id: el.id || el.className, ...rect(el) }));
      const overlaps = r => blockers.filter(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
      const r = rect(reticle), l = rect(label);
      const controls = [...document.querySelectorAll('#flight-pad button,.inspection-actions button,#node-select,#history-notice')].filter(visible).map(el => {
        const r = rect(el); return { id: el.id || el.textContent.trim(), ...r, hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      });
      return { host: rect(document.querySelector('#observatory')), reticle: r, label: l, labelText: label.textContent, visible: visible(reticle), blockers, controls,
        overlaps: overlaps(r), labelOverlaps: overlaps(l), centerCanvas: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === document.querySelector('#observatory canvas'), announcement: document.querySelector('#announcement').textContent };
    });
    // Actual production region is diagnostic only: the independent oracle below
    // checks rendered boundaries, full caption occlusion and real canvas hit.
    geometry.safeRect = uncoveredRect(geometry.host, geometry.blockers);
    await info.attach(mode + '-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    if (info.project.use.channel === 'chromium') await page.screenshot({ path: info.outputPath(mode + '.png') });
    expect(geometry.announcement).toMatch(/^Locating /);
    expect(geometry.visible).toBe(true);
    expect(geometry.labelText).toBe(hub.id);
    expect(geometry.overlaps).toEqual([]);
    expect(geometry.labelOverlaps).toEqual([]);
    expect(geometry.centerCanvas).toBe(true);
    for (const r of [geometry.reticle, geometry.label]) {
      expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(320);
      expect(r.top).toBeGreaterThanOrEqual(0); expect(r.bottom).toBeLessThanOrEqual(568);
    }
    for (const control of geometry.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); expect(control.hit).toBe(true);
    }
    await noticeGeometry(page);
    await expect(page.locator('#history-notice')).toHaveText(summary);
  }
});

for (const mode of ['fallback', 'error']) {
  test(`history notice opens About in ${mode} state`, async ({ page }) => {
    if (mode === 'fallback') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return String(type).includes('webgl') ? null : original.call(this, type, ...args); };
    });
    else await page.route('**/graph.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto('./');
    await expect(page.locator('#app')).toHaveAttribute('data-state', mode === 'error' ? 'error' : 'ready');
    await expect(page.locator('#fallback')).toBeVisible();
    await noticeGeometry(page);
    await page.locator('#history-notice').click();
    await expect(page.locator('#about-history-disclosure')).toHaveText(disclosure);
    await page.keyboard.press('Escape');
    await expect(page.locator('#history-notice')).toBeFocused();
  });
}

test('history notice and full disclosure fit short landscape and 200 percent zoom', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await ready(page);
  await noticeGeometry(page);
  await page.locator('#history-notice').click();
  await page.locator('#about-history-disclosure').scrollIntoViewIfNeeded();
  await expect(page.locator('#about-history-disclosure')).toBeInViewport({ ratio: 1 });
  expect(await page.locator('#about-dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await page.keyboard.press('Escape');
  // CSS zoom exercises enlarged text/reflow; not a native-browser zoom claim.
  await page.evaluate(() => document.documentElement.style.zoom = '2');
  await page.setViewportSize({ width: 1280, height: 900 });
  await noticeGeometry(page);
  await page.locator('#history-notice').click();
  await page.locator('#about-history-disclosure').scrollIntoViewIfNeeded();
  await expect(page.locator('#about-history-disclosure')).toBeInViewport({ ratio: 1 });
  expect(await page.locator('#about-dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
});
