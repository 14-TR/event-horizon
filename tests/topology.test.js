import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeFixture } from './fixture.js';

const helpers = await import('./topology.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('acceptance expectations come from complete validated topology, not export metadata or fixed totals', () => {
  assert.equal(typeof helpers.validateTopology, 'function', 'validated supplied-topology acceptance helper exists');
  for (const perSector of [1, 13, 81]) {
    const raw = makeFixture({ sectors: 3, perSector });
    raw.meta.notes = 999999;
    raw.clusters.forEach(cluster => { cluster.count = 999999; });
    const graph = helpers.validateTopology(raw);
    assert.equal(graph.nodes.length, 3 * perSector);
    assert.deepEqual(graph.nodes.map(node => node.id), raw.nodes.map(node => node.id));
    assert.deepEqual(graph.totals, { nodes: raw.nodes.length, edges: raw.edges.length, clusters: 3 });
    assert.deepEqual(graph.clusters.map(cluster => cluster.count), [perSector, perSector, perSector]);
  }
});

test('connected-pair selection derives IDs from real adjacency, not a historical hub', () => {
  assert.equal(typeof helpers.connectedPair, 'function');
  const raw = { version: 1, clusters: [{ id: 7 }, { id: 19 }],
    nodes: [{ id: 'n700000', cluster: 7 }, { id: 'n900000', cluster: 19 }, { id: 'n800000', cluster: 7 }],
    edges: [['n700000', 'n900000'], ['n700000', 'n800000']] };
  assert.deepEqual(helpers.connectedPair(helpers.validateTopology(raw)), { id: 'n700000', neighborId: 'n900000' });
  raw.edges = [];
  assert.throws(() => helpers.connectedPair(helpers.validateTopology(raw)), /cross-sector/);
});

test('fixed junction and layout fixture remains the exact reviewed anonymous snapshot', () => {
  const bytes = readFileSync(new URL('./fixtures/junction-topology.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '93fc70628b132b1a432db87a3fddf75e1d14fdb4cf274cbc6cb25ad886665cc7');
  helpers.validateTopology(JSON.parse(bytes));
});

test('nonempty acceptance fails closed for empty or invalid supplied graphs', () => {
  assert.throws(() => helpers.validateTopology(makeFixture({ sectors: 0 })), /nonempty/);
  const raw = makeFixture();
  raw.edges.push([raw.nodes[0].id, 'n999999']);
  assert.throws(() => helpers.validateTopology(raw), /Invalid topology/);
});
