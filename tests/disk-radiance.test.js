import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { parseGraph } from '../src/graph.js';
import { buildLayout } from '../src/layout.js';
import { Observatory } from '../src/scene.js';
import { StarTrails } from '../src/star-trails.js';
const disk = await import('../src/disk-radiance.js');

const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));

test('disk radiance reuses every actual note buffer and exposure, never invents image nodes', () => {
  assert.equal(typeof disk.DiskRadiance, 'function', 'actual-note radiance capture must exist');
  for (const [quality, size] of [['mobile', 512], ['desktop', 768], ['cinematic', 1024]]) {
    const view = Object.create(Observatory.prototype);
    view.graph = graph; view.layout = buildLayout(graph); view.host = { dataset: {} };
    view.clusterObjects = new Map(); view.orbital = new Group();
    view.renderer = { getPixelRatio: () => 1 };
    view.addConstellations();
    const trails = new StarTrails(view.layout, quality); trails.update(0);
    const sources = [...view.clusterObjects.values()].map(({ points }) => points);
    const light = new disk.DiskRadiance(sources, trails.mesh, quality);
    assert.equal(light.target.width, size);
    assert.equal(light.target.height, size);
    assert.equal(light.noteCount, graph.nodes.length);
    const ids = [];
    for (const { source, image } of light.entries) {
      assert.ok(sources.includes(source), 'only real point objects are image sources');
      assert.equal(image.geometry, source.geometry, 'live positions/colors/sizes shared by reference');
      assert.equal(image.userData.nodes, undefined, 'light copies have no pickable identity');
      ids.push(...source.userData.nodes.map(node => node.id));
    }
    assert.deepEqual(ids.sort(), graph.nodes.map(node => node.id).sort());
    assert.equal(new Set(ids).size, 1675);
    assert.equal(light.trailImage.geometry, trails.mesh.geometry);
    let borrowedDisposed = false, targetDisposed = false;
    sources[0].geometry.addEventListener('dispose', () => { borrowedDisposed = true; });
    light.target.addEventListener('dispose', () => { targetDisposed = true; });
    light.dispose();
    assert.equal(borrowedDisposed, false, 'capture never owns graph geometry');
    assert.equal(targetDisposed, true);
    trails.dispose();
    for (const { points, line } of view.clusterObjects.values()) {
      points.geometry.dispose(); points.material.dispose(); line.geometry.dispose(); line.material.dispose();
    }
  }
});
