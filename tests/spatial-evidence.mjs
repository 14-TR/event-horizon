// Bounded, opt-in scene-only production probe. Not a substitute for integrated UI gates.
// Run sequentially with other GPU tests: EH_SPATIAL_DIR=/private/path node tests/spatial-evidence.mjs
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateTopology, connectedPair } from './topology.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.EH_SPATIAL_DIR || `${root}/test-results/spatial-probe`);
const bundle = `${directory}/bundle`;
await mkdir(bundle, { recursive: true });
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: { target: 'es2022', outDir: bundle, emptyOutDir: true, lib: { entry: `${root}/src/scene.js`, formats: ['es'], fileName: () => 'scene.js' } } });
const graph = validateTopology(JSON.parse(await readFile(`${root}/public/graph.json`, 'utf8')));
const { id: hubId, neighborId: crossId } = connectedPair(graph);
await writeFile(`${bundle}/graph.json`, JSON.stringify(graph));
const html = `<!doctype html><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body,#host{margin:0;width:100%;height:100%;overflow:hidden;background:#030407}#host{position:absolute;inset:0}canvas{display:block;width:100%;height:100%}
#reticle{position:absolute;width:26px;height:26px;border:1px solid #ffe4ae;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}#reticle span{position:absolute;top:30px;left:0;color:#ffe4ae;font:11px monospace}
#safe{position:absolute;border:1px dashed #7baba688;box-sizing:border-box;pointer-events:none}#label{position:absolute;bottom:12px;left:12px;color:#8d9d9b;font:11px monospace;pointer-events:none}
</style><div id="host"></div><div id="safe" hidden></div><div id="reticle" hidden><span></span></div><div id="label">SCENE API PROBE · dashed area is supplied safeRect, not application UI</div><script type="module">
import {Observatory} from './scene.js';
const raw=await (await fetch('./graph.json')).json();
const counts=new Map();raw.nodes.forEach(n=>counts.set(n.cluster,(counts.get(n.cluster)||0)+1));raw.clusters=raw.clusters.map(c=>({id:c.id,count:counts.get(c.id)||0}));
window.probe=new Observatory(document.querySelector('#host'),raw,{paused:true,quality:'mobile',onProject:(clusters,node)=>{const ring=document.querySelector('#reticle');ring.hidden=!node?.visible;if(node){ring.style.left=node.x+'px';ring.style.top=node.y+'px';ring.firstChild.textContent=window.probe?.selectedNode?.id||''}},onUnavailable:()=>{window.probeFailed=true}});
</script>`;
await writeFile(`${bundle}/index.html`, html);
const server = createServer(async (request, response) => {
  const files = { '/': ['index.html', 'text/html'], '/scene.js': ['scene.js', 'text/javascript'], '/graph.json': ['graph.json', 'application/json'] };
  const entry = files[new URL(request.url, 'http://localhost').pathname];
  if (!entry) { response.writeHead(404); response.end(); return; }
  try { response.writeHead(200, { 'Content-Type': entry[1] }); response.end(await readFile(`${bundle}/${entry[0]}`)); }
  catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] });
const receipts = [];
const sourceHash = createHash('sha256');
for (const file of ['src/scene.js', 'src/node-locate.js', 'src/selected-connections.js']) sourceHash.update(await readFile(`${root}/${file}`));
const viewports = [[960, 720], [390, 844], [320, 568]].filter(([width]) => !process.env.EH_SPATIAL_WIDTH || width === Number(process.env.EH_SPATIAL_WIDTH));
assert.ok(viewports.length > 0, 'EH_SPATIAL_WIDTH must select a supported viewport');
const snapshot = page => page.evaluate(() => ({ position: probe.camera.position.toArray(), target: probe.controls.target.toArray(), quaternion: probe.camera.quaternion.toArray(), projection: probe.camera.projectionMatrix.toArray(), time: probe.time, paused: probe.paused, stars: [...probe.clusterObjects.values()].map(({ points, group }) => ({ visible: group.visible, p: Array.from(points.geometry.attributes.position.array), c: Array.from(points.geometry.attributes.aColor.array), s: Array.from(points.geometry.attributes.aSize.array) })), trails: Array.from(probe.trails.mesh.geometry.attributes.position.array), trailCount: probe.trails.mesh.geometry.drawRange.count }));
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', recordVideo: { dir: directory, size: { width, height } } });
    const page = await context.newPage(), errors = [];
    const video = page.video();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.probe?.host.dataset.renderer === 'webgl');
    const gpu = await page.evaluate(() => { const gl = probe.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) }; });
    assert.match(gpu.renderer, /Metal/, 'this opt-in probe requires the actual Chromium Metal backend');
    const baseline = await page.locator('canvas').screenshot({ path: `${directory}/${width}-home.png` });
    const initialState = await snapshot(page);
    const safeRect = width > 700 ? { left: 32, top: 100, width: 570, height: 500 } : { left: 16, top: 100, width: width - 32, height: height - 330 };
    await page.evaluate(rect => {
      const box = document.querySelector('#safe'); box.hidden = false;
      for (const key of ['left', 'top', 'width', 'height']) box.style[key] = rect[key] + 'px';
      window.safeRect = rect;
      window.follow = (id, neighbor = null) => {
        const node = probe.layout.nodes.find(n => n.id === id);
        probe.selectCluster(node.cluster); probe.selectNode(id);
        const edges = probe.setConnectionContext(id, neighbor);
        const located = probe.locateNode(id, { safeRect: window.safeRect });
        probe.drawFrame();
        return { located, edges, point: probe.project(node.position, true), cluster: node.cluster, flight: Boolean(probe.flight) };
      };
    }, safeRect);
    const states = [];
    for (const [id, neighbor] of [[hubId, crossId], [crossId, hubId], [hubId, crossId]]) {
      const state = await page.evaluate(([id, neighbor]) => window.follow(id, neighbor), [id, neighbor]);
      assert.equal(state.located, true); assert.equal(state.flight, false); assert.equal(state.point.visible, true);
      assert.ok(state.point.x > safeRect.left && state.point.x < safeRect.left + safeRect.width);
      assert.ok(state.point.y > safeRect.top && state.point.y < safeRect.top + safeRect.height);
      assert.ok(graph.edges.some(([a, b]) => (a === id && b === neighbor) || (b === id && a === neighbor)));
      const visibleSource = await page.evaluate(({ id, point }) => {
        const node = probe.selectedNode, source = probe.clusterObjects.get(node.cluster).points;
        const index = source.userData.nodes.findIndex(n => n.id === id);
        const gl = probe.renderer.getContext(), scale = probe.renderer.getPixelRatio();
        const x = Math.floor(point.x * scale), y = gl.drawingBufferHeight - Math.floor(point.y * scale);
        const pixels = () => { probe.drawFrame(); const a = new Uint8Array(9 * 9 * 4); gl.readPixels(x - 4, y - 4, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
        const before = pixels(), sizes = source.geometry.attributes.aSize, size = sizes.getX(index);
        sizes.setX(index, 0); sizes.needsUpdate = true; const after = pixels();
        sizes.setX(index, size); sizes.needsUpdate = true; probe.drawFrame();
        return { pick: probe.pick(point.x, point.y)?.id, changedChannels: before.reduce((sum, value, i) => sum + Number(value !== after[i]), 0), gpuPosition: [0, 1, 2].map(axis => source.geometry.attributes.position.array[index * 3 + axis]), nodePosition: node.position };
      }, { id, point: state.point });
      assert.equal(visibleSource.pick, id, 'real depth-checked direct-star pick');
      assert.ok(visibleSource.changedChannels > 0, 'removing this source must change visible GPU pixels');
      const path = `${directory}/${width}-${states.length}-${id}.png`;
      await page.screenshot({ path });
      states.push({ id, neighbor, ...state, visibleSource, screenshot: path });
    }
    const provenance = await page.evaluate(crossId => {
      const id = probe.selectedNode.id;
      probe.setConnectionContext(null);
      const pixels = () => { probe.drawFrame(); const target = probe.diskRadiance.target, a = new Uint16Array(target.width * target.height * 4); probe.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, a); return a; };
      const before = pixels(), beforeCalls = probe.renderer.info.render.calls;
      const context = probe.setConnectionContext(id, crossId); const after = pixels();
      return { equal: before.every((value, i) => value === after[i]), foregroundDrawDelta: probe.renderer.info.render.calls - beforeCalls, context, noteStars: probe.host.dataset.noteStars, diskSourceStars: probe.host.dataset.diskSourceStars, sourceObjects: probe.diskRadiance.entries.length, overlayCaptured: probe.diskRadiance.entries.some(e => e.source === probe.connections.line) };
    }, crossId);
    assert.equal(provenance.equal, true, 'connection annotations never contaminate disk capture');
    assert.equal(provenance.foregroundDrawDelta, 1, 'selection adds only one bounded foreground line draw');
    assert.equal(provenance.noteStars, String(graph.nodes.length)); assert.equal(provenance.diskSourceStars, String(graph.nodes.length)); assert.equal(provenance.overlayCaptured, false);
    let motion = null;
    if (width === 390) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(([crossId, hubId]) => { probe.setPaused(false); window.follow(crossId, hubId); }, [crossId, hubId]);
      await page.waitForFunction(() => !probe.flight && probe.time > 0.15);
      motion = await page.evaluate(() => ({ time: probe.time, point: probe.project(probe.selectedNode.position, true), endpoints: Array.from(probe.connections.line.geometry.attributes.position.array.slice(0, 6)), expected: [...probe.connections.node.position, ...probe.connections.neighbors[0].position] }));
      assert.equal(motion.point.visible, true);
      motion.endpoints.forEach((value, i) => assert.ok(Math.abs(value - motion.expected[i]) < 1e-5));
      await page.screenshot({ path: `${directory}/390-moving-endpoint.png` });
      await page.evaluate(([hubId, crossId]) => window.follow(hubId, crossId), [hubId, crossId]);
      await page.mouse.move(120, 170); await page.mouse.down(); await page.mouse.move(140, 180); await page.mouse.up();
      assert.equal(await page.evaluate(() => Boolean(probe.locating || probe.flight)), false, 'real manual pointer input cancels');
      await page.evaluate(hubId => { probe.setNavigationMode('fly'); probe.locateNode(hubId, { safeRect: window.safeRect }); }, hubId);
      await page.keyboard.down('w'); await page.keyboard.up('w');
      assert.equal(await page.evaluate(() => Boolean(probe.locating || probe.flight)), false, 'real flight key cancels');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { probe.setPaused(true); probe.time = 0; probe.updateInfall(0); });
    }
    // A real keyboard cancellation focuses the canvas. Its browser focus ring
    // is DOM chrome, not rendered source light; exclude it from the reset image.
    await page.evaluate(() => { probe.selectCluster(null); probe.renderer.domElement.blur(); document.querySelector('#safe').hidden = true; probe.drawFrame(); });
    const reset = await page.locator('canvas').screenshot({ path: `${directory}/${width}-reset.png` });
    await writeFile(`${directory}/${width}-reset-state.json`, JSON.stringify({ initial: initialState, reset: await snapshot(page) }));
    await writeFile(`${directory}/${width}-pre-reset-receipt.json`, JSON.stringify({ width, states, provenance, motion, resetIdentical: baseline.equals(reset), errors }, null, 2));
    assert.ok(baseline.equals(reset), 'reset restores the identical source-only home frame');
    const disposal = await page.evaluate(() => { probe.dispose(); return { disposed: probe.disposed, canvas: Boolean(document.querySelector('canvas')), context: probe.host.dataset.connectionRendered, active: Boolean(probe.flight || probe.locating) }; });
    assert.deepEqual(disposal, { disposed: true, canvas: false, context: '0', active: false });
    assert.deepEqual(errors, []);
    receipts.push({ width, height, gpu, safeRect, states, provenance, motion, resetIdentical: true, disposal, errors });
    await context.close(); await video.saveAs(`${directory}/${width}-spatial.webm`); await video.delete();
    await writeFile(`${directory}/receipts.json`, JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify({ width, height, gpu, verifiedStates: states.length, provenance, motion, resetIdentical: true, errors }));
  }
  assert.equal(receipts.length, viewports.length);
  await writeFile(`${directory}/identity.json`, JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceSHA256: sourceHash.digest('hex'), viewCount: receipts.length, sceneProbeOnly: true }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
