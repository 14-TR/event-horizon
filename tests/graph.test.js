import test from 'node:test';
import assert from 'node:assert/strict';

const fixture = () => ({
  version: 1,
  nodes: [{ id: 'n000001', cluster: 0, title: 'PRIVATE' }, { id: 'n000002', cluster: 0 }, { id: 'n000003', cluster: 1 }],
  edges: [['n000001', 'n000002'], ['n000002', 'n000003']],
  clusters: [{ id: 0, label: '<script>PRIVATE</script>', count: 2 }, { id: 1, label: 'Private topic', count: 1 }],
  meta: { source: 'anonymized-vault-topology', notes: 3, links: 2, clusters: 2 },
});

// Dynamic import lets the first RED name the missing behavior clearly.
const load = async () => import('../src/graph.js').catch(() => ({}));

test('validates topology and exposes anonymous fields only', async () => {
  const { parseGraph } = await load();
  assert.equal(typeof parseGraph, 'function', 'graph parser is implemented');
  const graph = parseGraph(fixture());
  assert.deepEqual(graph.nodes[0], { id: 'n000001', cluster: 0 });
  assert.deepEqual(graph.clusters.map(c => c.label), ['Sector 01', 'Sector 02']);
  assert.deepEqual(graph.totals, { nodes: 3, edges: 2, clusters: 2 });
  assert.equal(JSON.stringify(graph).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(graph).includes('Private topic'), false);
});

test('rejects malformed, duplicate or dangling topology without reflecting input', async () => {
  const { parseGraph } = await load();
  const mutations = [
    g => { g.version = 2; },
    g => { g.nodes[0].id = 'PRIVATE.html'; },
    g => { g.nodes[0].id = ' n000001'; },
    g => { g.nodes.push(g.nodes[0]); },
    g => { g.nodes[0].cluster = 99; },
    g => { g.clusters[0].id = -1; },
    g => { g.clusters.push(g.clusters[0]); },
    g => { g.edges.push(['n000001', 'n999999']); },
    g => { g.edges.push(['n000001', 'n000002', 'PRIVATE']); },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => parseGraph(input), /^Error: Invalid topology\.$/);
  }
  assert.throws(() => parseGraph(null), /^Error: Invalid topology\.$/);
});

test('samples deterministically across sectors and reports the exact visible subgraph', async () => {
  const { parseGraph, sampleGraph } = await load();
  assert.equal(typeof sampleGraph, 'function', 'bounded stratified sampling is implemented');
  const graph = parseGraph(fixture());
  const sampled = sampleGraph(graph, 2);
  assert.equal(sampled.nodes.length, 2);
  assert.equal(new Set(sampled.nodes.map(node => node.cluster)).size, 2);
  assert.deepEqual(sampled.totals, { nodes: 3, edges: 2, clusters: 2 });
  assert.equal(sampled.sampled, true);
  assert.deepEqual(sampleGraph(graph, 2), sampled);
  const ids = new Set(sampled.nodes.map(node => node.id));
  assert.ok(sampled.edges.every(([a, b]) => ids.has(a) && ids.has(b)));
  assert.equal(sampleGraph(graph, 100).sampled, false);
  assert.equal(sampleGraph(graph, 0).nodes.length, 0);
});

test('per-sector caps keep dominant populations legible without dropping tiny sectors', async () => {
  const { parseGraph, sampleGraph } = await load();
  const graph = parseGraph({
    version: 1,
    nodes: Array.from({ length: 22 }, (_, i) => ({ id: `n${String(i + 1).padStart(6, '0')}`, cluster: i < 20 ? 0 : i - 19 })),
    edges: [], clusters: [{ id: 0 }, { id: 1 }, { id: 2 }],
  });
  const sample = sampleGraph(graph, 100, 6);
  assert.equal(sample.nodes.length, 8);
  assert.deepEqual([0, 1, 2].map(id => sample.nodes.filter(node => node.cluster === id).length), [6, 1, 1]);
  assert.equal(sample.sampled, true);
  assert.equal(sample.totals.nodes, 22);
});
