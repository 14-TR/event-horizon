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

test('the complete reviewed graph preserves all node identities, links and tiny sectors without a sampling API', async () => {
  const { readFileSync } = await import('node:fs');
  const api = await load();
  const raw = JSON.parse(readFileSync(new URL('../public/graph.json', import.meta.url)));
  const graph = api.parseGraph(raw);
  assert.ok(graph.nodes.length > 0, 'published coverage must not pass on an empty topology');
  assert.deepEqual(graph.nodes, raw.nodes.map(({ id, cluster }) => ({ id, cluster })));
  assert.deepEqual(graph.edges, raw.edges);
  assert.deepEqual(graph.totals, { nodes: raw.nodes.length, edges: raw.edges.length, clusters: raw.clusters.length });
  assert.deepEqual(graph.clusters.map(c => c.count), graph.clusters.map(c => raw.nodes.filter(n => n.cluster === c.id).length));
  assert.equal(api.sampleGraph, undefined, 'no obsolete sampling path remains to silently omit real notes');
});
