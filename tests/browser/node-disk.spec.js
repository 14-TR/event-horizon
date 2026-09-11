import { test, expect } from '@playwright/test';
import { openTools } from './tools.js';
import { readFileSync, writeFileSync } from 'node:fs';

const graph = JSON.parse(readFileSync(new URL('../../public/graph.json', import.meta.url)));
const fmt = n => new Intl.NumberFormat('en-US').format(n);

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`all ${graph.nodes.length} actual nodes reach GPU draws and the complete inspector at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Observe real WebGL POINTS draw calls, not just the UI's claimed population.
    await page.addInitScript(() => {
      window.noteDraws = [];
      window.diskDraws = [];
      window.noteEnvelopes = [];
      window.diskEnvelopes = [];
      const instanced = WebGL2RenderingContext.prototype.drawElementsInstanced;
      WebGL2RenderingContext.prototype.drawElementsInstanced = function (mode, count, type, offset, instances) {
        if (mode === this.TRIANGLES) {
          const draws = this.getParameter(this.FRAMEBUFFER_BINDING) ? window.diskEnvelopes : window.noteEnvelopes;
          draws.push(instances);
          if (draws.length > 64) draws.shift();
        }
        return instanced.call(this, mode, count, type, offset, instances);
      };
      const original = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
        if (mode === this.POINTS) {
          const draws = this.getParameter(this.FRAMEBUFFER_BINDING) ? window.diskDraws : window.noteDraws;
          draws.push(count);
          if (draws.length > 64) draws.shift();
        }
        return original.call(this, mode, first, count);
      };
    });
    await page.goto('./');
    await openTools(page);
    const host = page.locator('#observatory');
    await expect(host).toHaveAttribute('data-renderer', 'webgl');
    const expectedCounts = graph.clusters.map(c => graph.nodes.filter(n => n.cluster === c.id).length).sort((a, b) => a - b);
    const draws = async count => page.evaluate(async count => {
      window.noteDraws.length = 0;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.noteDraws.slice(-count).sort((a, b) => a - b);
    }, count);
    const receipt = { viewport, qualities: [], sectors: [] };
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
      receipt.qualities.push({ quality, gpuPointCount: counts.reduce((sum, n) => sum + n, 0), draws: counts, diskSourceDraws: sourceCounts, envelopes });
    }
    const enumerated = [];
    for (const cluster of graph.clusters) {
      const nodes = graph.nodes.filter(n => n.cluster === cluster.id);
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
    expect(new Set(enumerated).size).toBe(1675);
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    expect(await draws(graph.clusters.length)).toEqual(expectedCounts);
    await expect(page.locator('#render-count')).toHaveText('1,675 / 1,675');
    receipt.uniqueNodeIds = new Set(enumerated).size;
    writeFileSync(`test-results/node-disk-${viewport.width}-coverage.json`, JSON.stringify(receipt, null, 2));
  });
}
