import { test, expect } from '@playwright/test';
import { validateTopology } from '../topology.js';
const graph = validateTopology(JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url))));
import { openTools } from './tools.js';
import { readFileSync } from 'node:fs';

for (const failure of ['missing-float-extension', 'startup-shader', 'runtime-shader']) {
  test(`${failure} stops rendering and keeps the accessible topology index`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      const gl = WebGL2RenderingContext.prototype;
      if (mode === 'missing-float-extension') {
        const getExtension = gl.getExtension;
        gl.getExtension = function (name) { return name === 'EXT_color_buffer_float' ? null : getExtension.call(this, name); };
      } else {
        const shaderSource = gl.shaderSource;
        gl.shaderSource = function (shader, source) {
          if ((mode === 'startup-shader' || window.breakRayShader) && source.includes('uniform float uStepScale')) source += '\nINVALID_SHADER_TOKEN';
          shaderSource.call(this, shader, source);
        };
      }
    }, failure);
    await page.goto('./');
    await openTools(page);
    if (failure === 'runtime-shader') {
      await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
      await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
      await page.evaluate(() => {
        window.breakRayShader = true;
        const select = document.getElementById('quality-select');
        select.value = 'cinematic';
        select.dispatchEvent(new Event('change'));
      });
    }
    await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'fallback');
    await expect(page.locator('#app')).not.toHaveAttribute('data-cinematic', 'true');
    await expect(page.getByLabel('Render quality')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Fly mode', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Explore the topology' }).click();
    await page.locator('.sector-button').first().click();
    await expect(page.getByLabel('Inspect an anonymous node')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('all-node orbital exposures are bounded, pause exactly and rebuild coherently on quality/reset', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await openTools(page);
  const host = page.locator('#observatory');
  await expect(host).toHaveAttribute('data-renderer', 'webgl');
  await expect.poll(async () => Number(await host.getAttribute('data-trail-segments'))).toBeGreaterThan(graph.nodes.length);
  const notes = await page.locator('#render-count').textContent();
  await page.getByLabel('Render quality').selectOption('mobile');
  await expect(host).toHaveAttribute('data-trail-stars', String(graph.nodes.length));
  await expect.poll(async () => Number(await host.getAttribute('data-trail-segments'))).toBeGreaterThan(graph.nodes.length);
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await expect.poll(async () => Number(await host.getAttribute('data-trail-segments'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  const frame = () => host.locator('canvas').screenshot({ style: '.intro, #explore-tools, [data-hud], .vignette { visibility: hidden !important; }' });
  const stopped = await frame();
  await page.waitForTimeout(200);
  expect((await frame()).equals(stopped)).toBe(true);
  expect(Number(await host.getAttribute('data-trail-segments'))).toBeLessThanOrEqual(graph.nodes.length * 3);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  expect((await frame()).equals(stopped), 'home keeps the same frozen orbital exposure').toBe(true);
  await expect(page.locator('#render-count')).toHaveText(notes);
});

test('quality overrides and cinematic HUD hiding preserve a keyboard-accessible exit', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await openTools(page);
  const host = page.locator('#observatory');
  await expect(host).toHaveAttribute('data-renderer', 'webgl');
  const quality = page.getByLabel('Render quality');
  for (const [name, steps, pixels] of [['mobile', 96, 340000], ['desktop', 144, 1100000], ['cinematic', 192, 2100000]]) {
    await quality.selectOption(name);
    await expect(host).toHaveAttribute('data-quality', name);
    await expect(host).toHaveAttribute('data-ray-steps', String(steps));
    expect(Number(await host.getAttribute('data-ray-pixels'))).toBeLessThanOrEqual(pixels);
    await expect(host).toHaveAttribute('data-renderer', 'webgl');
  }
  await page.getByRole('button', { name: 'Cinematic view', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-cinematic', 'true');
  await expect(page.locator('#sectors-panel')).toBeHidden();
  const exit = page.getByRole('button', { name: 'Event Horizon — open exploration controls', exact: true });
  await expect(exit).toBeVisible();
  await expect(exit).toBeFocused();
  const box = await exit.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sectors-panel')).toBeVisible();
  await expect(page.locator('#title-toggle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sectors-panel')).toBeHidden();
  await expect(exit).toBeFocused();
  await page.reload();
  await openTools(page);
  await expect(quality).toHaveValue('cinematic');
});
