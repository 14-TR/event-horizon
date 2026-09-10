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
