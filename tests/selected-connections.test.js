import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SelectedConnections, CONNECTION_LIMIT } from '../src/selected-connections.js';
import { buildLayout } from '../src/layout.js';
import { validateTopology as parseGraph } from './topology.js';
import { createInfall } from '../src/motion.js';

const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));

test('every published node receives truthful unique relationship totals without growing the draw allocation', () => {
  const layout = buildLayout(graph), overlay = new SelectedConnections(graph, layout);
  const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const positionBuffer = overlay.line.geometry.attributes.position.array;
  let checked = 0;
  for (const node of layout.nodes) {
    const neighbors = adjacency.get(node.id);
    const focus = [...neighbors].at(-1) ?? null;
    const result = overlay.select(node.id, focus);
    assert.equal(result.total, neighbors.size);
    assert.equal(result.rendered, Math.min(CONNECTION_LIMIT, neighbors.size));
    assert.equal(overlay.line.geometry.drawRange.count, result.rendered * 2);
    assert.equal(overlay.line.geometry.attributes.position.array, positionBuffer, 'fixed bounded storage');
    assert.equal(new Set(overlay.neighbors).size, overlay.neighbors.length);
    for (const neighbor of overlay.neighbors) assert.ok(neighbors.has(neighbor.id));
    if (focus) assert.ok(overlay.neighbors.some(node => node.id === focus), 'even the last neighbor can be emphasized');
    checked++;
  }
  assert.equal(checked, graph.nodes.length);
  assert.equal(positionBuffer.length, CONNECTION_LIMIT * 6);
  overlay.line.geometry.dispose(); overlay.line.material.dispose();
});

test('zero-degree, invalid emphasis and duplicate undirected edges never invent a relationship', () => {
  const fixture = { nodes: [{ id: 'n000001', cluster: 0 }, { id: 'n000002', cluster: 1 }, { id: 'n000003', cluster: 1 }], clusters: [{ id: 0, count: 1 }, { id: 1, count: 2 }], edges: [['n000001', 'n000002'], ['n000002', 'n000001']] };
  const layout = buildLayout(fixture), overlay = new SelectedConnections(fixture, layout);
  assert.deepEqual(overlay.select('n000001', 'n000003'), { id: 'n000001', neighborId: null, rendered: 1, total: 1 });
  assert.deepEqual(overlay.select('n000003'), { id: 'n000003', neighborId: null, rendered: 0, total: 0 });
  assert.equal(overlay.line.visible, false);
  assert.deepEqual(overlay.select(null), { id: null, neighborId: null, rendered: 0, total: 0 });
  assert.equal(overlay.line.geometry.drawRange.count, 0);
  overlay.select('n000001', 'n000002');
  createInfall(layout)(8);
  overlay.update();
  assert.deepEqual(overlay.line.geometry.attributes.position.array.slice(0, 6), new Float32Array([...layout.nodes[0].position, ...layout.nodes[1].position]));
  assert.equal(overlay.line.isPoints, undefined);
  assert.equal(overlay.line.material.depthTest, true, 'context cannot draw through the composited horizon');
  assert.equal(overlay.line.material.depthWrite, false);
  overlay.line.geometry.dispose(); overlay.line.material.dispose();
});
