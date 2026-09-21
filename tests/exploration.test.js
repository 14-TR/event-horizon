import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTopology as parseGraph, connectedPair } from './topology.js';

const { createExploration, connectionPreview } = await import('../src/exploration.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const graph = parseGraph(JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url))));
const neighborsOf = id => [...new Set(graph.edges.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []))];
const { id: hubId } = connectedPair(graph);
const hub = graph.nodes.find(node => node.id === hubId);

test('bounded neighbor pages provide every real neighbor of the published hub exactly once', () => {
  assert.equal(typeof createExploration, 'function', 'the real-neighbor explorer must exist');
  const explorer = createExploration(graph);
  explorer.visit({ clusterId: hub.cluster, nodeId: hub.id });
  const expected = neighborsOf(hub.id).sort();
  assert.ok(expected.length > 0, 'enumerate a real nonempty neighborhood');
  const seen = [];
  for (let page = 0; page < explorer.neighbors().pages; page++) {
    explorer.setPage(page);
    const result = explorer.neighbors();
    assert.ok(result.items.length <= 6, 'the rendered list is bounded to six rows');
    assert.equal(result.total, expected.length);
    seen.push(...result.items.map(node => node.id));
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual(seen.sort(), expected);
});

test('cross-sector and within-sector filters partition real adjacency with truthful ranges', () => {
  const explorer = createExploration(graph);
  explorer.visit({ clusterId: hub.cluster, nodeId: hub.id });
  const expected = neighborsOf(hub.id);
  const within = expected.filter(id => graph.nodes.find(node => node.id === id).cluster === hub.cluster);
  const cross = expected.filter(id => !within.includes(id));
  for (const [filter, ids] of [['within', within], ['cross', cross]]) {
    explorer.setFilter(filter);
    explorer.setPage(100000);
    const last = explorer.neighbors();
    assert.equal(last.total, expected.length);
    assert.equal(last.within, within.length);
    assert.equal(last.cross, cross.length);
    assert.equal(last.filtered, ids.length);
    assert.equal(last.end, ids.length);
    assert.ok(last.items.every(node => ids.includes(node.id)));
    assert.equal(last.page, last.pages - 1);
    explorer.setPage(-1);
    assert.equal(explorer.neighbors().page, 0);
  }
  explorer.setFilter('unknown');
  assert.equal(explorer.neighbors().filtered, expected.length);
  explorer.setPage(NaN);
  assert.equal(explorer.neighbors().page, 0);
});

test('first note inspection has no previous node, including after Home and sector browsing', () => {
  const explorer = createExploration(graph);
  for (let visit = 0; visit < 2; visit++) {
    explorer.visit({ clusterId: hub.cluster });
    explorer.visit({ nodeId: hub.id });
    assert.equal(explorer.previous, null, 'sector-only and home contexts are not previous notes');
    assert.equal(explorer.back(), false);
    explorer.reset();
  }
});

test('following a genuine cross-sector connection and Back restore the source, filter and page', () => {
  const explorer = createExploration(graph);
  explorer.visit({ clusterId: hub.cluster, nodeId: hub.id });
  explorer.setFilter('cross');
  explorer.setPage(2);
  const before = explorer.current;
  const neighbor = explorer.neighbors().items[0];
  assert.ok(neighbor.cluster !== hub.cluster);
  assert.equal(explorer.follow(neighbor.id), true);
  assert.equal(explorer.current.nodeId, neighbor.id);
  assert.equal(explorer.current.clusterId, neighbor.cluster);
  assert.equal(explorer.back(), true);
  assert.deepEqual(explorer.current, before);
  assert.equal(explorer.follow(hub.id), false, 'proximity and arbitrary IDs are not connections');
  assert.equal(explorer.visit({ clusterId: -1 }), false);
  assert.equal(explorer.visit({ nodeId: 'missing' }), false);
  assert.deepEqual(explorer.current, before);
  explorer.reset();
  assert.equal(explorer.current.nodeId, null);
  assert.equal(explorer.current.clusterId, null);
  assert.equal(explorer.back(), false, 'Reset clears the path rather than a hidden history');
});

test('isolated notes and duplicate edges never fabricate neighbors or empty page ranges', () => {
  const explorer = createExploration(parseGraph({ version: 1, clusters: [{ id: 0 }],
    nodes: [{ id: 'n000001', cluster: 0 }, { id: 'n000002', cluster: 0 }, { id: 'n000003', cluster: 0 }],
    edges: [['n000001', 'n000002'], ['n000002', 'n000001']],
  }));
  explorer.visit({ nodeId: 'n000001' });
  assert.equal(explorer.neighbors().total, 1);
  explorer.visit({ nodeId: 'n000003' });
  assert.deepEqual(explorer.neighbors(), { items: [], total: 0, within: 0, cross: 0, filtered: 0, pages: 1, page: 0, start: 0, end: 0 });
  assert.equal(explorer.follow('n000002'), false);
});

test('spatial preview counts never masquerade as total degree or paginated rows', () => {
  assert.equal(typeof connectionPreview, 'function');
  assert.equal(connectionPreview({ displayed: 32, total: 814 }), '32 of 814 connections drawn in space.');
  assert.equal(connectionPreview(undefined), '');
  assert.equal(connectionPreview({ displayed: 40, total: 3 }), '');
  assert.equal(connectionPreview({ displayed: -1, total: 0 }), '');
  assert.equal(connectionPreview({ displayed: 0, total: 0 }), '0 of 0 connections drawn in space.');
});
