const invalid = () => { throw new Error('Invalid topology.'); };
const isSectorId = id => Number.isSafeInteger(id) && id >= 0;
const isNodeId = id => typeof id === 'string' && /^n\d{6,12}$/.test(id);

/** Ignore supplied labels/metadata. Only anonymous allowlisted fields escape. */
export function parseGraph(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.clusters)) invalid();
  if (raw.nodes.length > 250_000 || raw.edges.length > 1_000_000 || raw.clusters.length > 10_000) invalid();
  const sectorIds = new Set();
  for (const cluster of raw.clusters) {
    if (!cluster || !isSectorId(cluster.id) || sectorIds.has(cluster.id)) invalid();
    sectorIds.add(cluster.id);
  }
  const ids = new Set();
  const counts = new Map();
  const nodes = raw.nodes.map(node => {
    if (!node || !isNodeId(node.id) || ids.has(node.id) || !sectorIds.has(node.cluster)) invalid();
    ids.add(node.id);
    counts.set(node.cluster, (counts.get(node.cluster) || 0) + 1);
    return { id: node.id, cluster: node.cluster };
  });
  const edges = raw.edges.map(edge => {
    if (!Array.isArray(edge) || edge.length !== 2 || !ids.has(edge[0]) || !ids.has(edge[1])) invalid();
    return [edge[0], edge[1]];
  });
  const clusters = [...sectorIds].sort((a, b) => a - b).map((id, index) => ({
    id, label: `Sector ${String(index + 1).padStart(2, '0')}`, count: counts.get(id) || 0,
  }));
  return { nodes, edges, clusters, totals: { nodes: nodes.length, edges: edges.length, clusters: clusters.length } };
}

/** Round-robin coverage, not a claim to be a statistical sample. */
export function sampleGraph(graph, cap = 1800, perSector = 260) {
  const limit = Math.max(0, Math.floor(cap));
  const sectorLimit = Math.max(0, Math.floor(perSector));
  const buckets = new Map(graph.clusters.map(cluster => [cluster.id, []]));
  for (const node of graph.nodes) buckets.get(node.cluster).push(node);
  for (const [id, bucket] of buckets) {
    bucket.sort((a, b) => a.id.localeCompare(b.id));
    buckets.set(id, bucket.slice(0, sectorLimit));
  }
  const available = [...buckets.values()].reduce((sum, bucket) => sum + bucket.length, 0);
  const nodes = [];
  let round = 0;
  while (nodes.length < Math.min(limit, available)) {
    for (const bucket of buckets.values()) {
      if (bucket[round]) nodes.push(bucket[round]);
      if (nodes.length === limit) break;
    }
    round++;
  }
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(([a, b]) => ids.has(a) && ids.has(b));
  return { ...graph, nodes, edges, sampled: nodes.length < graph.nodes.length };
}
