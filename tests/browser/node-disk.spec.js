import { test, expect } from '@playwright/test';
import { openTools, browseStreams } from './tools.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeFixture } from '../fixture.js';
import { validateTopology } from '../topology.js';

const published = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url)));
const cases = [
  { label: 'published', raw: published },
  { label: 'synthetic-added', raw: makeFixture({ sectors: 9, perSector: 200 }) },
  { label: 'synthetic-removed', raw: makeFixture({ sectors: 2, perSector: 13 }) },
];
const fmt = n => new Intl.NumberFormat('en-US').format(n);
test.use({ deviceScaleFactor: 1.75 });

for (const { label, raw } of cases) for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const graph = validateTopology(raw);
  test(`${label}: all ${graph.nodes.length} actual nodes reach GPU draws and the complete inspector at ${viewport.width}px`, async ({ page }) => {
    if (label !== 'published') await page.route('**/graph.json', route => route.fulfill({ json: raw }));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Observe real WebGL POINTS draw calls, not just the UI's claimed population.
    await page.addInitScript(capacity => {
      window.noteDraws = [];
      window.diskDraws = [];
      window.noteEnvelopes = [];
      window.diskEnvelopes = [];
      window.volumeTargets = [];
      const instanced = WebGL2RenderingContext.prototype.drawElementsInstanced;
      WebGL2RenderingContext.prototype.drawElementsInstanced = function (mode, count, type, offset, instances) {
        if (mode === this.TRIANGLES) {
          const direct = this.getUniformLocation(this.getParameter(this.CURRENT_PROGRAM), 'uRayDepth') !== null;
          const draws = direct ? window.noteEnvelopes : window.diskEnvelopes;
          if (direct) {
            const viewport = this.getParameter(this.VIEWPORT);
            window.volumeTargets.push({ offscreen: !!this.getParameter(this.FRAMEBUFFER_BINDING), pixels: viewport[2] * viewport[3], samples: this.getParameter(this.SAMPLES) });
            if (window.volumeTargets.length > capacity) window.volumeTargets.shift();
          }
          draws.push(instances);
          if (draws.length > capacity) draws.shift();
        }
        return instanced.call(this, mode, count, type, offset, instances);
      };
      const original = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
        if (mode === this.POINTS) {
          const draws = this.getParameter(this.FRAMEBUFFER_BINDING) ? window.diskDraws : window.noteDraws;
          draws.push(count);
          if (draws.length > capacity) draws.shift();
        }
        return original.call(this, mode, first, count);
      };
    }, Math.max(64, graph.clusters.length * 2));
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
    await page.goto('./');
    expect(validateTopology(await (await response).json())).toEqual(graph);
    await openTools(page);
    const host = page.locator('#observatory');
    await expect(host).toHaveAttribute('data-renderer', 'webgl');
    const expectedCounts = graph.clusters.map(c => graph.nodes.filter(n => n.cluster === c.id).length).sort((a, b) => a - b);
    const draws = async count => page.evaluate(async count => {
      window.noteDraws.length = 0;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.noteDraws.slice(-count).sort((a, b) => a - b);
    }, count);
    const receipt = { label, viewport, expectedIds: graph.nodes.map(node => node.id).sort(), totals: graph.totals, qualities: [], sectors: [] };
    for (const quality of ['mobile', 'desktop', 'cinematic']) {
      await page.getByLabel('Render quality').selectOption(quality);
      await expect(host).toHaveAttribute('data-disk-source-stars', String(graph.nodes.length));
      await expect(host).toHaveAttribute('data-lensed-light', 'noninteractive');
      await expect(host).toHaveAttribute('data-disk-image-size', String({ mobile: 512, desktop: 768, cinematic: 1024 }[quality]));
      await expect(host).toHaveAttribute('data-note-stars', String(graph.nodes.length));
      await expect(host).toHaveAttribute('data-trail-stars', String(graph.nodes.length));
      await expect(page.locator('#render-count')).toHaveText(`${fmt(graph.nodes.length)} / ${fmt(graph.nodes.length)}`);
      const counts = await draws(graph.clusters.length);
      expect(counts).toEqual(expectedCounts);
      const sourceCounts = await page.evaluate(count => window.diskDraws.slice(-count).sort((a, b) => a - b), graph.clusters.length);
      expect(sourceCounts).toEqual(expectedCounts);
      const envelopes = await page.evaluate(count => ({
        direct: window.noteEnvelopes.slice(-count).sort((a, b) => a - b),
        captured: window.diskEnvelopes.slice(-count).sort((a, b) => a - b),
      }), graph.clusters.length);
      expect(envelopes.direct).toEqual(expectedCounts);
      expect(envelopes.captured).toEqual(expectedCounts);
      const volumeTargets = await page.evaluate(count => window.volumeTargets.slice(-count), graph.clusters.length);
      expect(volumeTargets).toHaveLength(graph.clusters.length);
      for (const target of volumeTargets) {
        expect(target.offscreen, 'soft volumes must not shade the unbounded MSAA canvas').toBe(true);
        expect(target.samples).toBe(0);
        expect(target.pixels).toBe(Number(await host.getAttribute('data-ray-pixels')));
      }
      receipt.qualities.push({ quality, gpuPointCount: counts.reduce((sum, n) => sum + n, 0), draws: counts, diskSourceDraws: sourceCounts, envelopes, volumeTargets });
    }
    const enumerated = [];
    for (const cluster of graph.clusters) {
      const nodes = graph.nodes.filter(n => n.cluster === cluster.id);
      await browseStreams(page);
      await page.locator(`.sector-button[data-cluster="${cluster.id}"]`).click();
      const listed = await page.locator('#node-select option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
      expect(listed.sort()).toEqual(nodes.map(n => n.id).sort());
      enumerated.push(...listed);
      await expect(page.locator('#sector-status')).toHaveText('ONE STREAM ISOLATED');
      await expect(page.locator('#render-count')).toHaveText(`${fmt(nodes.length)} / ${fmt(graph.nodes.length)}`);
      expect(await draws(1)).toEqual([nodes.length]);
      // Inspect a node at the END of the sector, beyond the obsolete per-sector cap.
      const node = nodes.at(-1), neighbors = new Set();
      for (const [a, b] of graph.edges) { if (a === node.id) neighbors.add(b); if (b === node.id) neighbors.add(a); }
      await page.getByLabel('Inspect an anonymous node').selectOption(node.id);
      await expect(page.locator('#node-id')).toHaveText(node.id);
      await expect(page.locator('#node-degree')).toHaveText(fmt(neighbors.size));
      receipt.sectors.push({ id: cluster.id, included: listed.length, inspected: node.id, neighbors: neighbors.size });
    }
    expect(enumerated.sort()).toEqual(graph.nodes.map(n => n.id).sort());
    expect(new Set(enumerated).size).toBe(graph.nodes.length);
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    expect(await draws(graph.clusters.length)).toEqual(expectedCounts);
    await expect(page.locator('#render-count')).toHaveText(`${fmt(graph.nodes.length)} / ${fmt(graph.nodes.length)}`);
    receipt.uniqueNodeIds = new Set(enumerated).size;
    writeFileSync(`test-results/node-disk-${label}-${viewport.width}-coverage.json`, JSON.stringify(receipt, null, 2));
  });
}
