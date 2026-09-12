// Opt-in hardware timing of immutable production builds, never headless rAF FPS.
// EH_GPU_VARIANTS='[{"name":"base","url":"http://127.0.0.1:4191/event-horizon/","sha":"..."},{"name":"successor","url":"http://127.0.0.1:4193/event-horizon/","sha":"..."}]' \
// EH_GPU_DIR=/tmp/eh-gpu node tests/measure-gpu.mjs
// Optional release gate: EH_GPU_MAX_RATIO=1.25 (successor/base, median of rounds).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateTopology } from './topology.js';

const variants = JSON.parse(process.env.EH_GPU_VARIANTS || '[]');
assert.ok(variants.length >= 2, 'supply at least two immutable production URLs');
assert.equal(new Set(variants.map(v => v.name)).size, variants.length);
for (const variant of variants) {
  assert.match(variant.sha, /^[a-f0-9]{40}$/);
  assert.ok(['http:', 'https:'].includes(new URL(variant.url).protocol));
}
const directory = resolve(process.env.EH_GPU_DIR || 'test-results/gpu');
await mkdir(directory, { recursive: true });
const rounds = 5, sampleCount = 120, warmupFrames = 60;
const views = [
  { name: 'mobile', width: 390, height: 844, dpr: 3 },
  { name: 'desktop', width: 1440, height: 1000, dpr: 1.75 },
];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] });
const receipt = {
  browser: browser.version(), rounds, sampleCount, warmupFrames, variants,
  scope: 'EXT_disjoint_timer_query_webgl2 around the synchronous production animation callback: source capture, mipmaps, rays, direct volumes, composite, stellar cores/trails and buffer uploads. Frozen home camera/time. Excludes browser composition, presentation and CPU frame pacing.',
  runs: [],
};
try {
  for (let round = 0; round < rounds; round++) {
    for (const view of views) {
      // Rotate the order, rather than measuring every baseline first.
      const order = variants.map((_, i) => variants[(i + round) % variants.length]);
      for (const variant of order) {
        const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr, reducedMotion: 'reduce' });
        try {
          const page = await context.newPage(), errors = [], resources = [];
          page.on('pageerror', e => errors.push(e.message));
          page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
          page.on('response', response => {
            if (response.ok()) resources.push(response.body().then(bytes => ({ url: response.url(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })));
          });
          await page.addInitScript(() => {
            const proto = WebGL2RenderingContext.prototype;
            const getContext = HTMLCanvasElement.prototype.getContext;
            let gl, ext, active, draws = 0, rendered = 0, measuring = false, disjoint = false;
            const pending = [], samples = [], names = new WeakMap(), observed = {}, glErrors = [];
            HTMLCanvasElement.prototype.getContext = function (name, ...args) {
              const result = getContext.call(this, name, ...args);
              if (name === 'webgl2' && result && !gl) { gl = result; ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
              return result;
            };
            const location = proto.getUniformLocation, scalar = proto.uniform1f, matrix = proto.uniformMatrix4fv;
            proto.getUniformLocation = function (program, name) { const result = location.call(this, program, name); if (result) names.set(result, name); return result; };
            proto.uniform1f = function (location, value) { if (names.get(location) === 'uTime') observed.time = value; return scalar.call(this, location, value); };
            proto.uniformMatrix4fv = function (location, transpose, value, ...rest) {
              if (names.get(location) === 'uCameraToHole') observed.camera = Array.from(value);
              if (names.get(location) === 'uInverseProjection') observed.projection = Array.from(value);
              return matrix.call(this, location, transpose, value, ...rest);
            };
            for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
              const original = proto[name]; proto[name] = function (...args) { draws++; return original.apply(this, args); };
            }
            const raf = requestAnimationFrame.bind(window);
            window.requestAnimationFrame = callback => raf(time => {
              draws = 0;
              if (measuring && gl && ext) { active = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, active); }
              try { callback(time); } finally {
                if (draws) rendered++;
                if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query: active, draws }); active = null; }
                if (gl && ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true;
                while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
                  const { query, draws } = pending.shift();
                  const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
                  if (draws) samples.push({ ms, draws });
                  gl.deleteQuery(query);
                }
              }
            });
            window.__gpu = {
              ready: () => rendered,
              start() { if (!ext) throw new Error('Hardware GPU timer unavailable'); measuring = true; },
              count: () => samples.length,
              read() {
                const error = gl.getError(); if (error) glErrors.push(error);
                const debug = gl.getExtension('WEBGL_debug_renderer_info');
                return { samples, observed, disjoint, glErrors, gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), framebuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], antialias: gl.getContextAttributes().antialias };
              },
            };
          });
          const topologyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/graph.json'));
          await page.goto(variant.url);
          const graph = validateTopology(await (await topologyResponse).json());
          await page.waitForFunction(warm => document.querySelector('#observatory')?.dataset.renderer === 'webgl' && window.__gpu?.ready() >= warm, warmupFrames, { timeout: 60000 });
          await page.evaluate(() => window.__gpu.start());
          await page.waitForFunction(count => window.__gpu.count() >= count, sampleCount, { timeout: 60000 });
          const actual = await page.evaluate(() => ({ ...window.__gpu.read(), ...document.querySelector('#observatory').dataset }));
          // Four source draws per occupied sector, plus two trails, rays and composite.
          const samples = actual.samples.slice(0, sampleCount);
          assert.equal(samples.length, sampleCount);
          assert.equal(actual.disjoint, false, 'disjoint timer results are not valid evidence');
          assert.deepEqual(actual.glErrors, []); assert.deepEqual(errors, []);
          assert.equal(actual.noteStars, String(graph.nodes.length)); assert.equal(actual.diskSourceStars, String(graph.nodes.length));
          assert.equal(actual.observed.time, 0);
          assert.ok(!/swiftshader|llvmpipe|software/i.test(actual.gpuRenderer), 'hardware acceptance cannot use a software renderer');
          assert.ok(samples.every(s => s.draws === 4 * graph.clusters.filter(cluster => cluster.count > 0).length + 4), 'timer must contain every production source, volume, ray, composite and foreground draw');
          const previous = receipt.runs.find(r => r.view.name === view.name);
          if (previous) assert.deepEqual(actual.observed, previous.observed, 'all variants/rounds must use exactly the same frozen camera and time');
          const run = { round, variant: variant.name, sha: variant.sha, view, ...actual, samples, medianMs: median(samples.map(s => s.ms)), p95Ms: samples.map(s => s.ms).sort((a, b) => a - b)[Math.floor(sampleCount * 0.95)], resources: await Promise.all(resources), errors };
          receipt.runs.push(run);
          await writeFile(`${directory}/measurements.json`, JSON.stringify(receipt, null, 2));
          console.log(JSON.stringify({ round, variant: variant.name, view: view.name, medianMs: run.medianMs, p95Ms: run.p95Ms, gpuRenderer: run.gpuRenderer }));
        } finally { await context.close(); }
      }
    }
  }
  assert.equal(receipt.runs.length, rounds * views.length * variants.length);
  receipt.summary = views.map(view => ({ view: view.name, variants: variants.map(variant => {
    const runs = receipt.runs.filter(r => r.view.name === view.name && r.variant === variant.name);
    assert.equal(runs.length, rounds);
    const medians = runs.map(r => r.medianMs);
    const hashSets = runs.map(r => JSON.stringify(r.resources.map(({url,sha256}) => ({url,sha256})).sort((a,b)=>a.url.localeCompare(b.url))));
    assert.equal(new Set(hashSets).size, 1, 'served build must not change during measurement');
    return { name: variant.name, medianMs: median(medians), roundMediansMs: medians, minMs: Math.min(...medians), maxMs: Math.max(...medians), samples: runs.reduce((n,r)=>n+r.samples.length,0) };
  }) }));
  await writeFile(`${directory}/measurements.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.summary, null, 2));
  if (process.env.EH_GPU_MAX_RATIO) {
    const max = Number(process.env.EH_GPU_MAX_RATIO);
    assert.ok(Number.isFinite(max) && max > 0);
    for (const view of receipt.summary) {
      const base = view.variants.find(v => v.name === 'base'), successor = view.variants.find(v => v.name === 'successor');
      assert.ok(base && successor, 'relative gate needs variants named base and successor');
      assert.ok(successor.medianMs / base.medianMs <= max, `${view.view}: successor/base ${successor.medianMs / base.medianMs} exceeds ${max}`);
    }
  }
} finally { await browser.close(); }
